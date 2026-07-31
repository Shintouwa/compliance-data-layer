/**
 * Draining the queues from a request. architecture.md Part I §1.7, §1.9.
 *
 * `boot.ts` describes the problem this file closes: pg-boss workers need a
 * process that outlives a request, and Vercel's serverless runtime does not
 * provide one. `startWorkers()` calls `boss.work()`, which starts a polling
 * loop — correct on a host with a process, wrong here, where the loop is
 * killed the moment the response is written and any job it had leased sits
 * `active` until its `expireInSeconds` elapses.
 *
 * **So this is `fetch` and not `work`.** One invocation claims jobs explicitly,
 * runs them to completion, and settles each one before taking the next. A slice
 * that ends does so between jobs, never inside one.
 *
 * The tradeoff, stated plainly: latency is now bounded by the cron interval
 * rather than by polling, so a job enqueued just after a slice waits up to a
 * minute. That is acceptable for an audit pipeline measured in minutes and it
 * is the price of the second deployable this product refuses to add
 * (CLAUDE.md §4.6). Nothing about retry or lease semantics changes — those are
 * queue configuration in `registry.ts`, not properties of the runner.
 *
 * ---
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 *
 * It does not call `boss.stop()`. Vercel freezes a function instance between
 * invocations and thaws it for the next, so the pg-boss instance and its pool
 * are reused; stopping would close the pool that the next invocation needs and
 * pay full connection setup every minute.
 *
 * It does not swallow a handler failure. `defineHandler` already logs, routes
 * `UnrecoverableError` to the dead-letter sink, and writes the `app.job_execution`
 * row. This layer only settles the pg-boss job accordingly — `fail()` so the
 * queue's own retry policy applies, rather than `complete()`, which would mark
 * a job that threw as done.
 */

import type PgBoss from 'pg-boss';
import { logger } from '../lib/logger';
import { serialiseError } from '../lib/logger';
import { bootQueues } from './boot';
import { HANDLERS } from './handlers';
import { LeaseHeld } from './idempotent';
import type { JobName } from './registry';

/** Default slice. Overridden by `CRON_WORK_BUDGET_MS`; see apps/web/README.md. */
export const DEFAULT_BUDGET_MS = 10_000;

/**
 * Left on the table so a slice returns before the platform kills it. A function
 * terminated mid-job leaves that job `active` until its lease expires, which is
 * up to 30 minutes for `validate.run`.
 */
const SETTLE_HEADROOM_MS = 1_500;

export interface DrainResult {
  readonly fetched: number;
  readonly completed: number;
  readonly failed: number;
  /** Jobs whose run was owned by another worker. Not failures — retried later. */
  readonly leaseHeld: number;
  /** Per queue, how many jobs were settled. Only non-zero queues appear. */
  readonly byQueue: Readonly<Record<string, number>>;
  readonly elapsedMs: number;
  /** True when the budget ran out with work still queued. */
  readonly budgetExhausted: boolean;
}

export interface DrainOptions {
  readonly budgetMs?: number;
  /** Injected in tests. Defaults to `Date.now`. */
  readonly now?: () => number;
}

export function budgetFromEnv(): number {
  const raw = process.env.CRON_WORK_BUDGET_MS;
  if (raw === undefined || raw === '') return DEFAULT_BUDGET_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `CRON_WORK_BUDGET_MS is ${JSON.stringify(raw)}, which is not a positive number of ` +
        'milliseconds. Refusing to guess a drain budget.',
    );
  }
  return parsed;
}

/**
 * Started once per function instance. `boss.start()` is idempotent in pg-boss
 * but not free — it runs the schema migration check — and `bootQueues` issues
 * one `createQueue` per declared queue. Doing both on every request would add
 * ~20 round trips to a slice that is meant to be spending its time on jobs.
 */
let ready: Promise<void> | undefined;

export function ensureStarted(boss: PgBoss): Promise<void> {
  ready ??= (async () => {
    await boss.start();
    await bootQueues(boss);
    logger.info('queues booted for cron drain', { queues: HANDLERS.map((h) => h.name) });
  })().catch((err: unknown) => {
    // A failed start must not be memoised, or every later invocation on this
    // instance returns the same rejected promise and the queue stops for the
    // life of the instance.
    ready = undefined;
    throw err;
  });
  return ready;
}

/** Test seam. Not used in application code. */
export function __resetDrainStateForTesting(): void {
  ready = undefined;
}

/**
 * Claim and run jobs until the budget is spent or every queue comes back empty.
 *
 * Queues are visited in `HANDLERS` order, which is pipeline order, so a slice
 * tends to advance one run through several stages rather than starting many.
 */
export async function drainQueues(boss: PgBoss, options: DrainOptions = {}): Promise<DrainResult> {
  const now = options.now ?? Date.now;
  const budgetMs = options.budgetMs ?? budgetFromEnv();
  const startedAt = now();
  const deadline = startedAt + budgetMs - SETTLE_HEADROOM_MS;

  const byQueue: Record<string, number> = {};
  let fetched = 0;
  let completed = 0;
  let failed = 0;
  let leaseHeld = 0;
  let budgetExhausted = false;

  await ensureStarted(boss);

  // Round-robin. One pass that finds nothing anywhere ends the slice early —
  // the common case, and it keeps an idle minute cheap.
  let progressed = true;
  while (progressed) {
    progressed = false;

    for (const handler of HANDLERS) {
      if (now() >= deadline) {
        budgetExhausted = true;
        break;
      }

      const [job] = await boss.fetch<unknown>(handler.name, { batchSize: 1 });
      if (job === undefined) continue;

      fetched += 1;
      progressed = true;
      const outcome = await runOne(boss, handler.name, handler.work, job);
      if (outcome === 'completed') completed += 1;
      else if (outcome === 'lease-held') leaseHeld += 1;
      else failed += 1;
      byQueue[handler.name] = (byQueue[handler.name] ?? 0) + 1;
    }

    if (budgetExhausted) break;
  }

  const result: DrainResult = {
    fetched,
    completed,
    failed,
    leaseHeld,
    byQueue,
    elapsedMs: now() - startedAt,
    budgetExhausted,
  };
  logger.info('cron drain finished', { ...result });
  return result;
}

type Outcome = 'completed' | 'failed' | 'lease-held';

/**
 * `batchSize: 1` throughout, matching `startWorkers`. `defineHandler`
 * destructures a single job and the lease in `idempotent()` is per `run_id`; a
 * batch would give one lease to several runs.
 */
async function runOne(
  boss: PgBoss,
  name: JobName,
  work: PgBoss.WorkHandler<unknown>,
  job: PgBoss.Job<unknown>,
): Promise<Outcome> {
  try {
    // `PgBoss.WorkHandler` is declared as returning `Promise<any>`. Naming the
    // type `unknown` here is what stops that `any` spreading into `asOutput`.
    const output: unknown = await work([job]);
    await boss.complete(name, job.id, asOutput(output));
    return 'completed';
  } catch (err) {
    // Not a failure: another worker owns this run, so the job goes back for a
    // later slice under the queue's normal retry policy. Counted separately
    // because a slice full of these means overlapping invocations, not bugs.
    const outcome: Outcome = err instanceof LeaseHeld ? 'lease-held' : 'failed';
    if (outcome === 'failed') {
      logger.error('job failed during cron drain', {
        job: name,
        pgboss_job_id: job.id,
        ...serialiseError(err),
      });
    }
    await boss.fail(name, job.id, serialiseError(err));
    return outcome;
  }
}

/** `complete` takes an object; a handler may return anything, including void. */
function asOutput(value: unknown): object {
  if (value === undefined || value === null) return {};
  return typeof value === 'object' ? value : { value };
}
