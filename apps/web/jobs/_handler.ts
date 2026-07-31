/**
 * Handler shape — every job, without variation. architecture.md Part IV §3.
 *
 * `traceId` is the pg-boss job id of the FIRST job in the chain and is
 * propagated through every downstream enqueue. One trace id from ingestion to
 * report delivery — because you will be debugging a client's rejected invoice
 * from four weeks ago, on a phone, during an exam.
 *
 * **Rule for every handler:** the first line of the body is `idempotent(...)`.
 * No exceptions, including for jobs that "look" naturally idempotent. That is
 * what this wrapper guarantees — a handler cannot opt out, because it never
 * sees the raw pg-boss job.
 *
 * §3 shows `defineHandler` returning the work function alone. It returns
 * `{ name, work }` here so that `boot.ts` can register queues and handlers from
 * one list and `assert-queue-coverage.sh` can enumerate what is actually
 * registered rather than trusting a second, hand-maintained list.
 */

import type PgBoss from 'pg-boss';
import type { z } from 'zod';
import { getBoss } from '../lib/queue';
import { createLogger, serialiseError } from '../lib/logger';
import type { Logger } from '../lib/logger';
import { idempotent, LeaseHeld, UnrecoverableError } from './idempotent';
import { queueSpec } from './registry';
import type { JobName } from './registry';

export interface JobCtx {
  readonly log: Logger;
  readonly traceId: string;
  readonly boss: PgBoss;
}

/**
 * The minimum every job payload carries. Part IV §2.
 *
 * The `| undefined` on the optional members is required by
 * `exactOptionalPropertyTypes` (§3.6): Zod's `.optional()` produces
 * `string | undefined`, and without it no schema would satisfy this interface.
 */
export interface BaseJobPayload {
  runId: string;
  tenantId?: string | undefined;
  traceId?: string | undefined;
}

export interface RegisteredHandler {
  readonly name: JobName;
  readonly work: PgBoss.WorkHandler<unknown>;
}

export function defineHandler<P extends BaseJobPayload>(
  name: JobName,
  // `z.ZodType<P>` defaults its Input parameter to `P`, which no schema with a
  // `.default()` or a coercion satisfies. Declaring the input as `unknown` is
  // what it actually is: whatever pg-boss stored in `job.data`.
  schema: z.ZodType<P, z.ZodTypeDef, unknown>,
  body: (payload: P, ctx: JobCtx) => Promise<unknown>,
): RegisteredHandler {
  const work: PgBoss.WorkHandler<unknown> = async ([job]) => {
    if (job === undefined) {
      // batchSize is 1, so pg-boss never delivers an empty array. If it ever
      // does, saying so beats silently returning success.
      throw new Error(`${name}: pg-boss delivered an empty batch.`);
    }

    const payload = schema.parse(job.data);               // Zod at every boundary
    const traceId = payload.traceId ?? job.id;
    const log = createLogger({
      job: name,
      run_id: payload.runId,
      tenant_id: payload.tenantId ?? null,
      trace_id: traceId,
    });
    const boss = getBoss();

    try {
      const result = await idempotent(
        name, payload.runId, payload.tenantId ?? null,
        queueSpec(name).expireInSeconds,
        () => body(payload, { log, traceId, boss }),
      );

      if (result === 'skipped') log.info('idempotent skip');
      return result;
    } catch (err) {
      if (err instanceof LeaseHeld) {
        // Not a failure: another worker owns this run. Retry later.
        log.info('lease held by another worker', serialiseError(err));
        throw err;
      }
      if (err instanceof UnrecoverableError) {
        await routeToDeadLetter(boss, name, job, err, log);
        return undefined;
      }
      log.error('job failed', serialiseError(err));
      throw err;
    }
  };

  return { name, work };
}

/**
 * `UnrecoverableError` is a deterministic failure — the same input will fail
 * the same way on every attempt, so spending five retries on it only delays the
 * moment a human finds out. Part IV §4 jobs 3 and 7 raise it deliberately, and
 * it is the enforcement point for the AI boundary (CLAUDE.md §4.4): the rule
 * lives in code, not in a review checklist.
 *
 * pg-boss has no "fail without retrying": `fail()` re-queues while
 * `retry_count < retry_limit`. So the payload is pushed to the dead-letter sink
 * immediately, and the original job is cancelled — a terminal state that stops
 * redelivery, and one that reads differently from `completed` in
 * `SELECT * FROM pgboss.job`. The authoritative record of *why* is the
 * `app.job_execution` row, which `idempotent()` has already set to `failed`
 * with the serialised error.
 */
async function routeToDeadLetter(
  boss: PgBoss,
  name: JobName,
  job: PgBoss.Job<unknown>,
  err: UnrecoverableError,
  log: Logger,
): Promise<void> {
  const sink = queueSpec(name).deadLetter;
  log.error('unrecoverable failure — not retrying', {
    ...serialiseError(err),
    dead_letter: sink ?? null,
    pgboss_job_id: job.id,
  });
  if (sink !== undefined) {
    await boss.send(sink, {
      ...(job.data as Record<string, unknown>),
      unrecoverable: serialiseError(err),
    });
  }
  await boss.cancel(name, job.id);
}
