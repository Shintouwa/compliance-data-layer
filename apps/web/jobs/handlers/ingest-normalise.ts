/**
 * 2 · `ingest.normalise`. architecture.md Part IV §4.
 *
 * | Writes | `client_data.invoice`, `invoice_line`, `master_data_defect` |
 * | Retry  | 3× |
 *
 * **Partial failure is permitted and expected. Never fail the whole run for a
 * subset of bad rows — the bad rows *are* the product.**
 */

import { z } from 'zod';
import { SOURCE_SYSTEM_VENDORS } from '@repo/db/schema/_shared';
import type { SourceSystemVendor } from '@repo/db/schema/_shared';
import { normaliseRun, UnsupportedSource } from '../../modules/ingestion';
import { defineHandler } from '../_handler';
import { enqueueInTransaction } from '../enqueue';
import { UnrecoverableError } from '../idempotent';
import { JOB } from '../registry';

const schema = z.object({
  runId: z.string().uuid(),
  tenantId: z.string().uuid(),
  entityId: z.string().uuid(),
  actorId: z.string().uuid(),
  rawDocumentId: z.string().uuid(),
  sourceSystem: z.enum(SOURCE_SYSTEM_VENDORS),
  defaultCurrency: z.string().length(3),
  mappingProfileId: z.string().uuid().optional(),
  traceId: z.string().optional(),
});

export const handler = defineHandler(JOB.INGEST_NORMALISE, schema, async (p, ctx) => {
  try {
    const result = await normaliseRun(
      {
        runId: p.runId,
        tenantId: p.tenantId,
        entityId: p.entityId,
        actorId: p.actorId,
        rawDocumentId: p.rawDocumentId,
        sourceSystem: p.sourceSystem satisfies SourceSystemVendor,
        defaultCurrency: p.defaultCurrency,
        ...(p.traceId === undefined ? {} : { traceId: p.traceId }),
      },
      (tx) => {
        if (p.mappingProfileId === undefined) {
          // No profile means the run stops at the mapping-review screen
          // (Part III §1.2) until a human confirms one. That is the designed
          // path, not a failure — so nothing is enqueued.
          ctx.log.info('awaiting mapping confirmation');
          return Promise.resolve();
        }
        return enqueueInTransaction(tx, JOB.MAP_APPLY, {
          runId: p.runId,
          tenantId: p.tenantId,
          actorId: p.actorId,
          entityId: p.entityId,
          mappingProfileId: p.mappingProfileId,
          traceId: ctx.traceId,
        });
      },
    );

    ctx.log.info('normalised', {
      documents: result.documentsWritten,
      defects: result.defectsWritten,
    });
    return {
      documentsWritten: result.documentsWritten,
      defectsWritten: result.defectsWritten,
    };
  } catch (err) {
    if (err instanceof UnsupportedSource) {
      // Deterministic: the same bytes from the same vendor will not become
      // supported on the third attempt.
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
});
