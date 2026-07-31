/**
 * Tenant context acquisition. architecture.md Part I §2.6, Part V §1.2.
 *
 * **Every `client_data` access goes inside `withTenantAccess`. There is no
 * second way in.**
 *
 * Access logging is not a bolt-on — it is part of how tenant context is
 * acquired, so it cannot be forgotten. There is no code path that reads
 * `client_data` without producing a log row, because RLS returns zero rows if
 * the context was never set.
 *
 * ---
 *
 * ONE CORRECTION TO THE §2.6 SNIPPET, and it matters.
 *
 * §2.6 shows the callback as `fn: () => Promise<T>`, closing over the
 * module-level `db`. `set_config(…, true)` is TRANSACTION-local, so it applies
 * to the transaction's connection and to nothing else — a query issued through
 * the outer `db` inside that callback checks out a DIFFERENT pooled connection,
 * where `app.tenant_id` was never set. RLS then returns **zero rows** rather
 * than raising, because `current_setting(…, true)` yields NULL by design.
 *
 * That is the precise failure mode §1.1 calls company-ending: not a crash, a
 * wrong answer. An audit report that says "0 findings" because the context did
 * not reach the connection is worse than one that fails to render.
 *
 * So the transaction handle is PASSED IN, and it is the only handle in scope
 * that can see client data. Use `ctx.tx`, never the imported `db`, inside.
 */

import { sql } from 'drizzle-orm';
import { clientDataAccessLog } from '@repo/db/schema/app';
import type { AccessReason } from '@repo/db/schema/app';
import { transaction } from '@repo/db/transaction';
import type { TxContext } from '@repo/db/transaction';

export interface TenantAccess {
  readonly tenantId: string;
  readonly actorId: string;
  /**
   * A closed union deliberately — a free-text reason field degrades to `"work"`
   * within a fortnight. §2.6.
   */
  readonly reason: AccessReason;
  readonly traceId?: string;
}

export async function withTenantAccess<T>(
  ctx: TenantAccess,
  fn: (tx: TxContext) => Promise<T>,
): Promise<T> {
  return transaction(async (txCtx) => {
    // set_config(..., true) = transaction-local. Never plain SET: a pooled
    // connection would leak the tenant to the next request. CLAUDE.md §4.6.
    await txCtx.tx.execute(sql`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`);
    await txCtx.tx.insert(clientDataAccessLog).values({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      reason: ctx.reason,
      traceId: ctx.traceId ?? null,
    });
    return fn(txCtx);
  });
}
