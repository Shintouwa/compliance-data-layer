/**
 * Queue and worker boot. architecture.md Part IV §1.
 *
 * **Boot registers every queue before any worker starts.** A missing
 * `createQueue` fails loudly at startup rather than silently dropping jobs at
 * 03:00.
 */

import type PgBoss from 'pg-boss';
import { logger } from '../lib/logger';
import { HANDLERS } from './handlers';
import { QUEUES } from './registry';
import type { JobName } from './registry';

export async function bootQueues(boss: PgBoss): Promise<void> {
  for (const [name, spec] of Object.entries(QUEUES) as [JobName, typeof QUEUES[JobName]][]) {
    await boss.createQueue(name, {
      name,
      retryLimit: spec.retryLimit,
      retryBackoff: spec.retryBackoff,
      retryDelay: spec.retryDelay,
      expireInSeconds: spec.expireInSeconds,
      policy: spec.policy ?? 'standard',
      ...(spec.deadLetter === undefined ? {} : { deadLetter: spec.deadLetter }),
    });
  }
}

/**
 * `batchSize: 1` throughout. `defineHandler` destructures a single job and the
 * lease in `idempotent()` is per `run_id`; a batch would give one lease to
 * several runs.
 */
export async function startWorkers(boss: PgBoss): Promise<void> {
  for (const handler of HANDLERS) {
    await boss.work(handler.name, { batchSize: 1 }, handler.work);
  }
  logger.info('workers started', { queues: HANDLERS.map((h) => h.name) });
}

/**
 * Boot the queue system: connect, register every queue, then start the workers.
 *
 * **This is the LONG-LIVED-PROCESS entrypoint, and Vercel is not one.**
 *
 * `startWorkers` calls `boss.work()`, which starts a polling loop. That is
 * correct on a host with a process — a container, a Heroku worker dyno, a local
 * `make dev` — and wrong on Vercel, where the loop dies with the response and
 * anything it had leased sits `active` until `expireInSeconds` elapses.
 *
 * On Vercel the runner is `jobs/drain.ts`, called by `GET /api/cron/work` on a
 * Vercel Cron Job (apps/web/README.md). It uses `boss.fetch()` and settles each
 * job explicitly, so a slice always ends between jobs. Retry and lease
 * semantics are unchanged either way: they are queue configuration in
 * `registry.ts`, not properties of the runner.
 *
 * The history, so it is not rediscovered: this was briefly wired through
 * `instrumentation.ts`. That does not work — Next compiles the instrumentation
 * hook for the EDGE runtime as well as for node, `pg` needs `fs` and `dns`, and
 * `next build` fails outright, with a `NEXT_RUNTIME === 'nodejs'` guard and a
 * dynamic import already in place, because webpack still traces the import.
 *
 * Nothing in the deployed app calls this. It stays because a worker host with a
 * real process is the better answer if one ever exists, and because `make dev`
 * can use it.
 */
export async function start(boss: PgBoss): Promise<void> {
  await boss.start();
  await bootQueues(boss);
  await startWorkers(boss);
}
