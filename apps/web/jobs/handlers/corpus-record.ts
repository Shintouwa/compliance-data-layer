/**
 * 5 · `corpus.record`. architecture.md Part IV §4.
 *
 * | Writes | `corpus.*` appends |
 * | Retry  | **Infinite**, exponential, dead-letter to `corpus.record.dlq` |
 *
 * **The only job connecting as `corpus_writer` via `CORPUS_DATABASE_URL`.**
 * Every other job uses `app_user`, which has no `INSERT` on `corpus`.
 *
 * **Dead-letter handling is operational, not optional.** DLQ depth is a
 * monitored metric with a page-on-nonzero alert. A row sitting in
 * `corpus.record.dlq` is corpus data that does not exist — and the corpus is
 * the asset being sold in 2029.
 */

import { z } from 'zod';
import { recordCorpus } from '../../modules/corpus';
import { resolveEntity } from '../../modules/tenancy';
import { defineHandler } from '../_handler';
import { JOB } from '../registry';

const valueShape = z.object({
  len: z.number().nullable(),
  charset: z.enum(['numeric', 'alpha', 'alnum', 'mixed', 'empty']).nullable(),
  regexClass: z.string().nullable(),
  expected: z.string().nullable(),
});

const schema = z.object({
  runId: z.string().uuid(),
  tenantId: z.string().uuid(),
  entityId: z.string().uuid(),
  specId: z.string().min(1),
  specName: z.string().min(1),
  specVersion: z.string().min(1),
  rulesetHash: z.string().min(1),
  direction: z.enum(['ar', 'ap']).default('ar'),
  counterpartyHash: z.string().optional(),
  documents: z.array(z.object({
    docHash: z.string().min(1),
    docType: z.string().min(1),
    scenario: z.string().min(1),
    currency: z.string().min(1),
    lineCount: z.number().int().nonnegative(),
    hasAllowanceCharge: z.boolean(),
    hasMultiTaxRate: z.boolean(),
    counterpartyHash: z.string().optional(),
  })),
  findings: z.array(z.object({
    docHash: z.string().min(1),
    stage: z.enum(['pre_map', 'post_map', 'pre_submit', 'asp_response', 'authority_response']),
    outcome: z.enum(['pass', 'fail', 'warn']),
    rule_id: z.string().nullable(),
    business_term: z.string().nullable(),
    xpath: z.string().nullable(),
    failure_class: z.enum([
      'missing_mandatory', 'invalid_code', 'format_mismatch', 'arithmetic_mismatch',
      'identifier_invalid', 'cardinality', 'cross_field_dependency', 'encoding',
      'date_logic', 'rounding',
    ]).nullable(),
    value_shape: valueShape.nullable(),
    message: z.string().optional(),
    attempt: z.number().int().positive().optional(),
  })),
  traceId: z.string().optional(),
});

export const handler = defineHandler(JOB.CORPUS_RECORD, schema, async (p, ctx) => {
  const entity = await resolveEntity(p.entityId);

  const result = await recordCorpus({
    tenantHash: entity.tenantCorpusHash,
    entityHash: entity.entityCorpusHash,
    jurisdiction: entity.jurisdiction,
    country: entity.country,
    sectorCode: entity.sectorCode,
    sizeBand: entity.sizeBand,
    scenarioProfile: entity.scenarioProfile,
    sysId: entity.sourceSystem,
    direction: p.direction,
    specId: p.specId,
    specName: p.specName,
    specVersion: p.specVersion,
    rulesetHash: p.rulesetHash,
    documents: p.documents,
    findings: p.findings,
    ...(p.counterpartyHash === undefined ? {} : { counterpartyHash: p.counterpartyHash }),
  });

  // `corpus_rows_written` is the moat accruing. It belongs on a dashboard next
  // to revenue. Part V §2.
  ctx.log.info('corpus_rows_written', {
    events: result.eventsWritten,
    documents: result.documentsWritten,
    ruleset_hash: p.rulesetHash,
    spec_version: p.specVersion,
  });

  return result;
});
