/**
 * `ingest.receive` — the domain half. architecture.md Part IV §4 job 1.
 *
 * Fetches the uploaded bytes, computes `sha256`, **envelope-encrypts**
 * (Part V §1.4), writes `raw_document` with `expiresAt = now() + 90 days`, sets
 * `ingestion_run.status='normalising'`, and enqueues `ingest.normalise` **in the
 * same transaction**.
 *
 * DUPLICATE-CHECKSUM RULE. If a `raw_document` with the same
 * `(tenantId, checksum)` exists inside its TTL, do not re-ingest — link the new
 * run to the existing document and log `duplicate_source_detected`. Clients
 * re-send the same export constantly; re-processing it inflates the corpus with
 * phantom repeat failures and **corrupts the `recurrence_key` statistics the
 * whole moat depends on.**
 */

import { and, eq, gt } from 'drizzle-orm';
import { ingestionRun, rawDocument } from '@repo/db/schema/client-data';
import type { TxContext } from '@repo/db/transaction';
import { withTenantAccess } from '../tenancy';
import { sha256Bytes } from './canonical';
import { sealBlob } from './crypto';
import { expiresInNinetyDays } from './retention';
import { getSealed, putSealed, storageKeyFor } from './storage';

export interface ReceiveInput {
  readonly runId: string;
  readonly tenantId: string;
  readonly entityId: string;
  readonly actorId: string;
  /** Where the signed upload landed. Unsealed, and deleted once sealed. */
  readonly stagingKey: string;
  readonly mimeType: string;
  readonly traceId?: string;
}

export interface ReceiveResult {
  readonly rawDocumentId: string;
  readonly checksum: string;
  readonly storageKey: string;
  readonly sizeBytes: number;
  /** Set when the duplicate-checksum rule fired. No new bytes were stored. */
  readonly duplicateOf: string | null;
}

/**
 * `enqueue` runs inside the transaction that wrote the rows, so the job cannot
 * orphan (Part IV §7). It is passed in rather than imported because
 * `modules/` never reaches into `jobs/` — the dependency runs one way.
 */
export async function receiveDocument(
  input: ReceiveInput,
  enqueue: (tx: TxContext, result: ReceiveResult) => Promise<void>,
): Promise<ReceiveResult> {
  const sealedBytes = await getSealed(input.stagingKey);
  const checksum = sha256Bytes(sealedBytes);

  return withTenantAccess(
    {
      tenantId: input.tenantId,
      actorId: input.actorId,
      reason: 'scheduled_job',
      ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
    },
    async (ctx) => {
      const [existing] = await ctx.tx
        .select({ id: rawDocument.id, storageKey: rawDocument.storageKey,
                  sizeBytes: rawDocument.sizeBytes })
        .from(rawDocument)
        .where(and(
          eq(rawDocument.tenantId, input.tenantId),
          eq(rawDocument.checksum, checksum),
          gt(rawDocument.expiresAt, new Date()),
        ));

      if (existing !== undefined) {
        const result: ReceiveResult = {
          rawDocumentId: existing.id,
          checksum,
          storageKey: existing.storageKey,
          sizeBytes: existing.sizeBytes,
          duplicateOf: existing.id,
        };
        await advanceRun(ctx, input, checksum, existing.storageKey);
        await enqueue(ctx, result);
        return result;
      }

      const sealed = sealBlob(input.tenantId, sealedBytes);
      const storageKey = storageKeyFor(input.tenantId, input.runId, checksum);
      await putSealed(storageKey, sealed.ciphertext);

      const [inserted] = await ctx.tx.insert(rawDocument).values({
        tenantId: input.tenantId,
        runId: input.runId,
        storageKey,
        checksum,
        mimeType: input.mimeType,
        sizeBytes: sealedBytes.byteLength,
        encryptedDataKey: sealed.encryptedDataKey,
        iv: sealed.iv,
        expiresAt: expiresInNinetyDays(),
      }).returning({ id: rawDocument.id });

      if (inserted === undefined) {
        throw new Error('raw_document insert returned no row — RLS context is missing.');
      }

      const result: ReceiveResult = {
        rawDocumentId: inserted.id,
        checksum,
        storageKey,
        sizeBytes: sealedBytes.byteLength,
        duplicateOf: null,
      };
      await advanceRun(ctx, input, checksum, storageKey);
      await enqueue(ctx, result);
      return result;
    },
  );
}

async function advanceRun(
  ctx: TxContext,
  input: ReceiveInput,
  checksum: string,
  storageKey: string,
): Promise<void> {
  await ctx.tx.update(ingestionRun)
    .set({ status: 'normalising', checksum, storageKey })
    .where(and(
      eq(ingestionRun.runId, input.runId),
      eq(ingestionRun.tenantId, input.tenantId),
    ));
}
