/**
 * 1 · `ingest.receive`. architecture.md Part IV §4.
 *
 * | Writes | `client_data.ingestion_run`, `client_data.raw_document`; encrypted bytes to R2 |
 * | Retry  | 3×, exponential |
 */

import { z } from 'zod';
import { receiveDocument } from '../../modules/ingestion';
import { defineHandler } from '../_handler';
import { enqueueInTransaction } from '../enqueue';
import { UnrecoverableError } from '../idempotent';
import { JOB } from '../registry';

const schema = z.object({
  runId: z.string().uuid(),
  tenantId: z.string().uuid(),
  entityId: z.string().uuid(),
  actorId: z.string().uuid(),
  source: z.enum(['sftp', 'upload', 'api_pull', 'local_agent']),
  dataset: z.enum(['invoice', 'gl_ledger', 'vat_return', 'asp_response']).default('invoice'),
  stagingKey: z.string().min(1),
  mimeType: z.string().min(1),
  sourceSystem: z.string().min(1),
  defaultCurrency: z.string().length(3),
  traceId: z.string().optional(),
});

export const handler = defineHandler(JOB.INGEST_RECEIVE, schema, async (p, ctx) => {
  if (p.source !== 'upload') {
    // SFTP, ASP portal polling and the local agent are M2+ (Part IV §4 job 1,
    // Part I §1.10 — the local agent's own architecture is explicitly NOT
    // specified and must not be invented). Refusing loudly beats a handler that
    // silently ingests nothing.
    throw new UnrecoverableError(
      `ingest.receive source "${p.source}" is not implemented. M1 ships the signed-upload ` +
        'path only; SFTP and API pull land with M2 scheduling, and the local agent needs ' +
        'its own section before M2 spec closes. architecture.md Part I §1.10, Part IV §4.',
    );
  }

  const result = await receiveDocument(
    {
      runId: p.runId,
      tenantId: p.tenantId,
      entityId: p.entityId,
      actorId: p.actorId,
      stagingKey: p.stagingKey,
      mimeType: p.mimeType,
      ...(p.traceId === undefined ? {} : { traceId: p.traceId }),
    },
    (tx, received) => enqueueInTransaction(tx, JOB.INGEST_NORMALISE, {
      runId: p.runId,
      tenantId: p.tenantId,
      entityId: p.entityId,
      actorId: p.actorId,
      rawDocumentId: received.rawDocumentId,
      sourceSystem: p.sourceSystem,
      defaultCurrency: p.defaultCurrency,
      traceId: ctx.traceId,
    }),
  );

  if (result.duplicateOf !== null) {
    // Clients re-send the same export constantly. Re-processing it inflates the
    // corpus with phantom repeat failures and corrupts the recurrence_key
    // statistics the whole moat depends on.
    ctx.log.info('duplicate_source_detected', {
      raw_document_id: result.duplicateOf,
      checksum: result.checksum,
    });
  }

  return { rawDocumentId: result.rawDocumentId, duplicate: result.duplicateOf !== null };
});
