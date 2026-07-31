/**
 * Creating an ingestion run. architecture.md Part III §1.1 — `/audits/new`.
 *
 * > **Action:** `createIngestionRun()` → inserts `ingestion_run`
 * > (`status='received'`, `dataset='invoice'`, `expiresAt = now() + 90d`) →
 * > enqueues `ingest.receive` **in the same transaction**. Redirect to
 * > `/audits/[runId]`.
 */

import { ingestionRun } from '@repo/db/schema/client-data';
import type { Dataset } from '@repo/db/schema/_shared';
import type { IngestSource } from '@repo/db/schema/client-data';
import type { TxContext } from '@repo/db/transaction';
import { withTenantAccess } from '../tenancy';
import { expiresInNinetyDays } from './retention';

export interface CreateIngestionRunInput {
  readonly runId: string;
  readonly tenantId: string;
  readonly entityId: string;
  readonly actorId: string;
  readonly source: IngestSource;
  readonly dataset?: Dataset;
  /** Checksum the browser computed. The server recomputes and rejects on mismatch. */
  readonly checksum: string;
  readonly stagingKey: string;
  readonly traceId?: string;
}

export async function createIngestionRun(
  input: CreateIngestionRunInput,
  enqueue: (tx: TxContext) => Promise<void>,
): Promise<{ runId: string; id: string }> {
  return withTenantAccess(
    {
      tenantId: input.tenantId,
      actorId: input.actorId,
      reason: 'audit_delivery',
      ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
    },
    async (ctx) => {
      const [row] = await ctx.tx.insert(ingestionRun).values({
        runId: input.runId,
        tenantId: input.tenantId,
        entityId: input.entityId,
        source: input.source,
        dataset: input.dataset ?? 'invoice',
        status: 'received',
        checksum: input.checksum,
        storageKey: input.stagingKey,
        expiresAt: expiresInNinetyDays(),
      }).returning({ id: ingestionRun.id });

      if (row === undefined) {
        throw new Error('ingestion_run insert returned no row — RLS context is missing.');
      }

      // In the same transaction. An enqueue outside it can orphan, which is the
      // entire reason pg-boss was chosen over an external queue (Part IV §7).
      await enqueue(ctx);
      return { runId: input.runId, id: row.id };
    },
  );
}
