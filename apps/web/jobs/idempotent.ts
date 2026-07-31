/**
 * The `run_id` idempotency rule. architecture.md Part IV §2.
 *
 * **Every job takes a `run_id`. Re-running with the same `run_id` is a no-op** —
 * because agents retry things, and because pg-boss delivers at-least-once.
 *
 * Two mechanisms. **Neither is sufficient alone.**
 *   1. `singletonKey` prevents duplicate *enqueue* (see `enqueue.ts`).
 *   2. This lease-based execution ledger makes duplicate *execution* a no-op.
 *      `singletonKey` does not protect against a worker crashing mid-job and
 *      the job being redelivered. The ledger does.
 *
 * `app.job_execution` lives in `app`, not `client_data`, so it outlives the
 * 90-day raw-data TTL — otherwise you lose the ability to answer "did this
 * run?" about a period whose source data has been purged.
 */

import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@repo/db';
import { jobExecution } from '@repo/db/schema/app';
import { serialiseError } from '../lib/logger';
import type { JobName } from './registry';

/** Another worker holds a live lease. Throw so pg-boss retries later. */
export class LeaseHeld extends Error {
  public override readonly name = 'LeaseHeld';
}

/** Deterministic failure — do not consume retries. Routes straight to dead-letter. */
export class UnrecoverableError extends Error {
  public override readonly name = 'UnrecoverableError';
}

function hashOf(result: unknown): string | null {
  if (result === undefined) return null;
  return `sha256:${createHash('sha256').update(JSON.stringify(result)).digest('hex')}`;
}

export async function idempotent<T>(
  jobName: JobName,
  runId: string,
  tenantId: string | null,
  leaseSeconds: number,
  fn: () => Promise<T>,
): Promise<T | 'skipped'> {
  const leaseUntil = new Date(Date.now() + leaseSeconds * 1000);

  // Claim, or discover an existing claim, in one statement.
  //
  // **Read the ON CONFLICT clause carefully before changing it.** The WHERE
  // guard is what makes this correct: a `completed` row is never reclaimed, a
  // `failed` row is retried, and a `running` row is only stolen after its lease
  // expires. **Remove the guard and two workers process the same run
  // concurrently.**
  const claimed = await db.execute(sql`
    INSERT INTO app.job_execution (job_name, run_id, tenant_id, status, lease_until)
    VALUES (${jobName}, ${runId}, ${tenantId}, 'running', ${leaseUntil})
    ON CONFLICT (job_name, run_id) DO UPDATE
      SET status      = 'running',
          attempt     = app.job_execution.attempt + 1,
          lease_until = ${leaseUntil},
          started_at  = now()
      WHERE app.job_execution.status = 'failed'
         OR (app.job_execution.status = 'running'
             AND app.job_execution.lease_until < now())
    RETURNING id;
  `);

  if (claimed.rowCount === 0) {
    const [row] = await db.select().from(jobExecution)
      .where(and(eq(jobExecution.jobName, jobName), eq(jobExecution.runId, runId)));
    if (row?.status === 'completed') return 'skipped';          // the no-op path
    throw new LeaseHeld(`${jobName}:${runId} held until ${row?.leaseUntil.toISOString() ?? '?'}`);
  }

  try {
    const result = await fn();
    await db.update(jobExecution)
      .set({ status: 'completed', finishedAt: new Date(), outputHash: hashOf(result) })
      .where(and(eq(jobExecution.jobName, jobName), eq(jobExecution.runId, runId)));
    return result;
  } catch (err) {
    await db.update(jobExecution)
      .set({ status: 'failed', finishedAt: new Date(), error: serialiseError(err) })
      .where(and(eq(jobExecution.jobName, jobName), eq(jobExecution.runId, runId)));
    throw err;
  }
}
