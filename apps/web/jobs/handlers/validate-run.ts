/**
 * 4 · `validate.run`. architecture.md Part IV §4.
 *
 * The only caller of the sidecar. Every request and response shape comes from
 * `@repo/contracts` (§1.6) — nothing here hand-writes one.
 */

import { z } from 'zod';
import { runValidation } from '../../modules/audit';
import { SpecIdentifiersUnresolved, ublSpecIdentifiers } from '../../modules/mapping';
import { resolveEntity } from '../../modules/tenancy';
import { defineHandler } from '../_handler';
import { enqueueInTransaction } from '../enqueue';
import { UnrecoverableError } from '../idempotent';
import { JOB } from '../registry';

const schema = z.object({
  runId: z.string().uuid(),
  tenantId: z.string().uuid(),
  entityId: z.string().uuid(),
  actorId: z.string().uuid(),
  invoiceIds: z.array(z.string().uuid()),
  profile: z.enum(['pint-ae', 'en16931', 'peppol-bis-3.0', 'factur-x', 'xrechnung', 'ksef-fa3']),
  specVersion: z.string().min(1),
  direction: z.enum(['ar', 'ap']).default('ar'),
  /** ⚠️ Published by the specification. Never defaulted — CLAUDE.md §4.7(1). */
  customizationId: z.string().min(1).optional(),
  profileId: z.string().min(1).optional(),
  traceId: z.string().optional(),
});

export const handler = defineHandler(JOB.VALIDATE_RUN, schema, async (p, ctx) => {
  // `cbc:CustomizationID` and `cbc:ProfileID` identify the specification the
  // document claims conformance to. They are published values; guessing one
  // produces a document that validates against a ruleset nobody agreed to.
  //
  // For `pint-ae` they are now resolved — quoted from the vendored PINT AE
  // Schematron and pinned to its bytes by a test (modules/mapping/
  // spec-identifiers.ts). They are derived PER DOCUMENT inside `runValidation`,
  // because a self-billed invoice is a different Peppol business process.
  //
  // An explicit pair on the payload still overrides, for a profile that has
  // none. Absent both, the job stops here rather than partway through a batch.
  const override = p.customizationId !== undefined && p.profileId !== undefined
    ? { customizationId: p.customizationId, profileId: p.profileId }
    : undefined;

  if (override === undefined) {
    try {
      ublSpecIdentifiers(p.profile, 'invoice');
    } catch (err) {
      if (err instanceof SpecIdentifiersUnresolved) throw new UnrecoverableError(err.message);
      throw err;
    }
  }

  const entity = await resolveEntity(p.entityId);

  const result = await runValidation(
    {
      runId: p.runId,
      tenantId: p.tenantId,
      entityId: p.entityId,
      actorId: p.actorId,
      entityHash: entity.entityCorpusHash,
      invoiceIds: p.invoiceIds,
      profile: p.profile,
      specVersion: p.specVersion,
      direction: p.direction,
      ubl: {
        sellerName: null,
        sellerCountry: entity.jurisdiction,
        buyerCountry: null,
      },
      ...(override === undefined ? {} : { ublIdentifiers: override }),
      ...(p.traceId === undefined ? {} : { traceId: p.traceId }),
    },
    ctx.log,
    async (tx, validated) => {
      if (validated.rulesetHash === null) {
        // Nothing validated, so there is nothing to record. Enqueuing an empty
        // corpus write would burn an infinite-retry queue slot on a no-op.
        ctx.log.warn('no documents validated; corpus.record not enqueued');
        return;
      }

      // corpus.record and report.generate are enqueued in parallel and are
      // independent (Part IV §7). report.generate has no handler until M2 — see
      // `plannedFor` in jobs/registry.ts — so it is not enqueued yet; sending to
      // a queue nobody consumes accumulates work that looks scheduled and is not.
      await enqueueInTransaction(tx, JOB.CORPUS_RECORD, {
        runId: p.runId,
        tenantId: p.tenantId,
        entityId: p.entityId,
        specId: p.profile,
        specName: p.profile,
        specVersion: p.specVersion,
        rulesetHash: validated.rulesetHash,
        direction: p.direction,
        documents: validated.documents,
        findings: validated.findings,
        traceId: ctx.traceId,
      });
    },
  );

  ctx.log.info('validated', {
    documents: result.documents.length,
    findings: result.findings.length,
    parse_errors: result.parseErrors,
    ruleset_hash: result.rulesetHash,
    spec_version: p.specVersion,
  });

  return {
    documents: result.documents.length,
    findings: result.findings.length,
    parseErrors: result.parseErrors,
  };
});
