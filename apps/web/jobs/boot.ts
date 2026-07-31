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
 * ⚠️ OPEN DEPLOYMENT QUESTION, flagged rather than invented.
 *
 * Nothing calls this yet. pg-boss workers need a process that outlives a
 * request, and §1.9 hosts the web app on Vercel, whose serverless runtime does
 * not provide one. Where the worker process runs is not specified in
 * architecture.md, and the options are not equivalent — a Heroku worker dyno
 * beside the sidecar, a cron-triggered route that drains a batch per
 * invocation, and a separate always-on host all change the retry and lease
 * semantics that Part IV §2 depends on.
 *
 * This was briefly wired through `instrumentation.ts`. That does not work:
 * Next compiles the instrumentation hook for the EDGE runtime as well as for
 * node, `pg` needs `fs` and `dns`, and `next build` fails outright — with a
 * `NEXT_RUNTIME === 'nodejs'` guard and a dynamic import already in place,
 * because webpack still traces the import. Removed rather than worked around,
 * so that the gap stays visible instead of looking solved.
 *
 * Until the host is chosen, jobs accumulate in `pgboss.job`, which is visible
 * in SQL — the reason pg-boss was chosen in the first place (§1.7).
 */
export async function start(boss: PgBoss): Promise<void> {
  await boss.start();
  await bootQueues(boss);
  await startWorkers(boss);
}
