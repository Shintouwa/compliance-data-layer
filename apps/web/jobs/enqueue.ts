/**
 * Transactional enqueue. architecture.md Part IV §2 and §7.
 *
 * > **Every enqueue happens inside the same transaction as the domain write
 * > that justifies it. This is the single reason pg-boss was chosen over an
 * > external queue.** An agent that moves an enqueue outside its transaction
 * > has reintroduced the orphaned-job class of bug.
 *
 * And mechanism 1 of the idempotency rule:
 *
 * > `singletonKey` prevents duplicate *enqueue*.
 *
 * Both are applied here, in one place, so neither can be forgotten at a call
 * site. `idempotent()` is mechanism 2; **neither is sufficient alone.**
 */

import type { PoolClient } from 'pg';
import type PgBoss from 'pg-boss';
import type { TxContext } from '@repo/db/transaction';
import { getBoss } from '../lib/queue';
import type { BaseJobPayload } from './_handler';
import type { JobName } from './registry';

/**
 * A pg-boss executor bound to an open transaction's connection, so the INSERT
 * into `pgboss.job` commits with the rows it belongs to — or with neither.
 */
export function txExecutor(client: PoolClient): PgBoss.Db {
  return {
    executeSql: async (text: string, values: unknown[]) => client.query(text, values),
  };
}

export async function enqueueInTransaction(
  ctx: TxContext,
  name: JobName,
  payload: BaseJobPayload & Record<string, unknown>,
): Promise<void> {
  await getBoss().send(name, payload, {
    // Duplicate enqueue of the same run is a no-op at the queue level.
    singletonKey: `${name}:${payload.runId}`,
    db: txExecutor(ctx.client),
  });
}
