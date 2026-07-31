/**
 * 3 · `map.apply`. architecture.md Part IV §4.
 *
 * | Writes | `invoice.mappedPayload` |
 * | Retry  | 2× — a mapping failure is nearly always deterministic; retrying wastes time |
 *
 * **This is the enforcement point for the AI boundary** (CLAUDE.md §4.4): AI
 * suggests mappings, a human confirms them, and the rule lives in code rather
 * than in a review checklist. `UnrecoverableError` routes straight to
 * dead-letter without consuming retries.
 */

import { z } from 'zod';
import { applyMapping, UnconfirmedMappingProfile } from '../../modules/mapping';
import { defineHandler } from '../_handler';
import { enqueueInTransaction } from '../enqueue';
import { UnrecoverableError } from '../idempotent';
import { JOB } from '../registry';

const schema = z.object({
  runId: z.string().uuid(),
  tenantId: z.string().uuid(),
  entityId: z.string().uuid(),
  actorId: z.string().uuid(),
  mappingProfileId: z.string().uuid(),
  profile: z.string().min(1).optional(),
  specVersion: z.string().min(1).optional(),
  traceId: z.string().optional(),
});

export const handler = defineHandler(JOB.MAP_APPLY, schema, async (p, ctx) => {
  try {
    const result = await applyMapping(
      {
        runId: p.runId,
        tenantId: p.tenantId,
        actorId: p.actorId,
        mappingProfileId: p.mappingProfileId,
        ...(p.traceId === undefined ? {} : { traceId: p.traceId }),
      },
      (tx, mapped) => {
        if (p.profile === undefined || p.specVersion === undefined) {
          // Which profile and version to validate against is a decision, not a
          // default. §4.7(1): do not invent an external identifier.
          ctx.log.info('mapped; awaiting an explicit profile and spec version', {
            invoices: mapped.invoiceIds.length,
          });
          return Promise.resolve();
        }
        return enqueueInTransaction(tx, JOB.VALIDATE_RUN, {
          runId: p.runId,
          tenantId: p.tenantId,
          entityId: p.entityId,
          actorId: p.actorId,
          invoiceIds: mapped.invoiceIds,
          profile: p.profile,
          specVersion: p.specVersion,
          direction: 'ar' as const,
          traceId: ctx.traceId,
        });
      },
    );

    return { invoices: result.invoiceIds.length, profileVersion: result.profileVersion };
  } catch (err) {
    if (err instanceof UnconfirmedMappingProfile) {
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
});
