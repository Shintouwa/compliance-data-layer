/**
 * A transaction that also exposes the underlying connection.
 *
 * architecture.md Part IV §7: **every enqueue happens inside the same
 * transaction as the domain write that justifies it. This is the single reason
 * pg-boss was chosen over an external queue.** An agent that moves an enqueue
 * outside its transaction has reintroduced the orphaned-job class of bug.
 *
 * Drizzle's own `db.transaction()` hides the connection, and pg-boss needs it —
 * `boss.send(name, data, { db })` routes the INSERT through a caller-supplied
 * executor, and that executor has to be *this* transaction's connection or the
 * enqueue commits independently of the row it belongs to.
 *
 * `withTenantAccess` (apps/web/modules/tenancy) is built on this, so the tenant
 * context, the access-log row, the domain write and the enqueue are all one
 * atomic unit.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import { poolFor } from './pool';
import type { ConnectionRole } from './pool';

export interface TxContext {
  /** Drizzle bound to the transaction's connection. */
  readonly tx: NodePgDatabase;
  /**
   * The same connection, raw. Used to build the pg-boss `Db` executor so an
   * enqueue lands in this transaction. Do not use it to bypass Drizzle for
   * ordinary queries.
   */
  readonly client: PoolClient;
}

export async function transaction<T>(
  fn: (ctx: TxContext) => Promise<T>,
  role: ConnectionRole = 'app_user',
): Promise<T> {
  const client = await poolFor(role).connect();
  try {
    await client.query('BEGIN');
    const result = await fn({ tx: drizzle(client), client });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // A failed ROLLBACK must not mask the error that caused it.
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection is already broken; the original error is the useful one */
    }
    throw err;
  } finally {
    client.release();
  }
}
