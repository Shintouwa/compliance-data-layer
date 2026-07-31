/**
 * pg-boss. architecture.md Part I §1.7.
 *
 * - Jobs are **rows in Postgres** — `SELECT * FROM pgboss.job WHERE state =
 *   'failed'`. No new tooling, dashboard, or credentials.
 * - **Transactional enqueue**: a job inserted in the same transaction as its
 *   domain write cannot orphan. This eliminates the entire "record exists but
 *   the job never ran" class of bug.
 * - One fewer service to deploy, monitor, secure, and pay for.
 *
 * Redis, Celery, RabbitMQ and SQS are forbidden (CLAUDE.md §4.6).
 */

import PgBoss from 'pg-boss';

let instance: PgBoss | undefined;

/**
 * Lazily constructed for the same reason as the database pools: importing a
 * handler module in a unit test must not require `DATABASE_URL`.
 */
export function getBoss(): PgBoss {
  if (instance) return instance;
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === '') {
    throw new Error(
      'DATABASE_URL is not set. pg-boss connects as app_user. architecture.md Part I §2.2.',
    );
  }
  instance = new PgBoss({
    connectionString,
    schema: 'pgboss',
    archiveCompletedAfterSeconds: 60 * 60 * 24 * 7,
    deleteAfterDays: 30,
  });
  return instance;
}

/** Test seam. Not used in application code. */
export function __setBossForTesting(boss: PgBoss | undefined): void {
  instance = boss;
}
