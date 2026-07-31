/**
 * Schema `corpus`. architecture.md Part I §2.9.
 *
 * **Rule 1 — never store commercial content.** No amounts, names, addresses,
 * line descriptions, or TRNs. Only `value_shape`. This is the difference
 * between a dataset you can legally aggregate, share and sell, and a liability
 * that makes the company unacquirable. **Diligence will kill a deal over this.
 * Retrofitting is impossible.**
 *
 * Structural enforcement, three layers:
 *   1. `value_shape` is derived INSIDE the sidecar, in `redaction.py` 🔒,
 *      before the value crosses the HTTP boundary.
 *   2. The sidecar's `message` field is templated WITHOUT interpolating the
 *      offending value.
 *   3. `assertRedacted()` runs at the corpus write boundary as a runtime
 *      backstop (Part IV §6).
 *
 * Retention: forever. Append-only, DB-enforced (§2.7). No RLS — not
 * tenant-scoped; role-gated instead (§2.2).
 *
 * On the table-config callback form and the `CHECK` constraints, see the note at
 * the head of `app.ts`.
 */

import { boolean, index, integer, jsonb, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import {
  createdAt, FAILURE_CLASSES, FLOW_DIRECTIONS, inList, RESOLUTION_ACTIONS, SEVERITIES,
  tsCol,
} from './_shared';
import type {
  FailureClass, FlowDirection, ResolutionAction, ValueShape,
} from './_shared';

export const corpus = pgSchema('corpus');

export const specification = corpus.table('specification', {
  specId:        text('spec_id').primaryKey(),   // 'pint-ae'
  jurisdiction:  text('jurisdiction').notNull(),
  name:          text('name').notNull(),
  version:       text('version').notNull(),      // ⚠️ RESOLVE IN WEEK 1
  effectiveFrom: tsCol('effective_from').notNull(),
  retiredOn:     tsCol('retired_on'),
});

export const rule = corpus.table('rule', {
  ruleId:         text('rule_id').primaryKey(),
  specId:         text('spec_id').notNull().references(() => specification.specId),
  nativeRuleCode: text('native_rule_code').notNull(),   // 'BR-AE-08'
  severity:       text('severity').$type<'fatal' | 'error' | 'warning'>().notNull(),
  businessTerm:   text('business_term'),                // 'BT-48'
  xpathContext:   text('xpath_context'),
  failureClass:   text('failure_class').$type<FailureClass>().notNull(),
  /** Published specification assert text. NOT client data — safe to store,
   *  and required by the Exception Inbox detail pane (Part III §2.1). */
  assertText:     text('assert_text'),
  /** sha256 of assertText. Detects silent upstream rule edits between versions. */
  canonicalTextHash: text('canonical_text_hash').notNull(),
}, (t) => [
  index('rule_spec_idx').on(t.specId),
  inList('rule_severity_chk', t.severity, SEVERITIES),
  inList('rule_failure_class_chk', t.failureClass, FAILURE_CLASSES),
]);

export const sourceSystem = corpus.table('source_system', {
  sysId:          text('sys_id').primaryKey(),
  vendor:         text('vendor').notNull(),
  product:        text('product').notNull(),
  version:        text('version'),
  deploymentType: text('deployment_type').$type<'cloud' | 'on_prem' | 'hybrid'>(),
}, (t) => [
  inList('source_system_deployment_type_chk', t.deploymentType,
    ['cloud', 'on_prem', 'hybrid']),
]);

export const corpusTenant = corpus.table('tenant', {
  tenantHash:  text('tenant_hash').primaryKey(),
  sectorCode:  text('sector_code'),
  sizeBand:    text('size_band'),
  country:     text('country').notNull(),
  firstSeenAt: tsCol('first_seen_at').notNull().defaultNow(),
});

export const corpusEntity = corpus.table('entity', {
  entityHash:      text('entity_hash').primaryKey(),
  tenantHash:      text('tenant_hash').notNull().references(() => corpusTenant.tenantHash),
  jurisdiction:    text('jurisdiction').notNull(),
  sysId:           text('sys_id').references(() => sourceSystem.sysId),
  entitySizeBand:  text('entity_size_band'),
  scenarioProfile: jsonb('scenario_profile'),
});

/** Cross-tenant stable. Populated from M6; optionally backfilled for AR from Wk 15. */
export const corpusCounterparty = corpus.table('counterparty', {
  counterpartyHash: text('counterparty_hash').primaryKey(),
  jurisdiction:     text('jurisdiction').notNull(),
  sizeBand:         text('size_band'),
  sectorCode:       text('sector_code'),
  firstSeenAt:      tsCol('first_seen_at').notNull().defaultNow(),
});

export type LineCountBucket = '1' | '2-5' | '6-20' | '21-100' | '100+';
export const LINE_COUNT_BUCKETS = ['1', '2-5', '6-20', '21-100', '100+'] as const satisfies readonly LineCountBucket[];

export const corpusDocument = corpus.table('document', {
  docHash:    text('doc_hash').primaryKey(),
  entityHash: text('entity_hash').notNull().references(() => corpusEntity.entityHash),
  /** Nullable until M6. No backfill required. */
  counterpartyHash: text('counterparty_hash')
                      .references(() => corpusCounterparty.counterpartyHash),
  direction:  text('direction').$type<FlowDirection>().notNull().default('ar'),
  docType:    text('doc_type').notNull(),
  scenario:   text('scenario').notNull(),
  currency:   text('currency').notNull(),
  /** Bucketed, never exact — an exact line count is weakly identifying. */
  lineCountBucket: text('line_count_bucket').$type<LineCountBucket>().notNull(),
  hasAllowanceCharge: boolean('has_allowance_charge').notNull(),
  hasMultiTaxRate:    boolean('has_multi_tax_rate').notNull(),
  createdAt:  createdAt(),
}, (t) => [
  index('corpus_document_entity_idx').on(t.entityHash),
  inList('corpus_document_direction_chk', t.direction, FLOW_DIRECTIONS),
]);

export type ValidationStage = 'pre_map' | 'post_map' | 'pre_submit'
                            | 'asp_response' | 'authority_response';
export const VALIDATION_STAGES = [
  'pre_map', 'post_map', 'pre_submit', 'asp_response', 'authority_response',
] as const satisfies readonly ValidationStage[];

export const validationEvent = corpus.table('validation_event', {
  eventId:     uuid('event_id').primaryKey().defaultRandom(),
  occurredAt:  tsCol('occurred_at').notNull().defaultNow(),
  docHash:     text('doc_hash').notNull().references(() => corpusDocument.docHash),
  entityHash:  text('entity_hash').notNull().references(() => corpusEntity.entityHash),
  /** Denormalised deliberately: at 25M rows, joining to document for every
   *  AR/AP split costs more than the column. */
  direction:   text('direction').$type<FlowDirection>().notNull().default('ar'),
  specId:      text('spec_id').notNull().references(() => specification.specId),
  specVersion: text('spec_version').notNull(),
  /** sha256 of the compiled ruleset. Makes every result reproducible. */
  rulesetHash: text('ruleset_hash').notNull(),
  stage:       text('stage').$type<ValidationStage>().notNull(),
  validator:   text('validator').$type<'own_schematron' | 'asp' | 'authority'>().notNull(),
  outcome:     text('outcome').$type<'pass' | 'fail' | 'warn'>().notNull(),
  ruleId:      text('rule_id').references(() => rule.ruleId),
  businessTerm: text('business_term'),
  xpath:       text('xpath'),
  failureClass: text('failure_class').$type<FailureClass>(),
  valueShape:  jsonb('value_shape').$type<ValueShape>(),
  attemptNumber: integer('attempt_number').notNull().default(1),
  /** hash(entity_hash, rule_id, xpath, value_shape). Joins failures to fixes. */
  recurrenceKey: text('recurrence_key').notNull(),
}, (t) => [
  index('ve_recurrence_idx').on(t.recurrenceKey),
  index('ve_rule_idx').on(t.ruleId),
  index('ve_entity_idx').on(t.entityHash),
  index('ve_occurred_idx').on(t.occurredAt),
  inList('ve_direction_chk', t.direction, FLOW_DIRECTIONS),
  inList('ve_stage_chk', t.stage, VALIDATION_STAGES),
  inList('ve_validator_chk', t.validator, ['own_schematron', 'asp', 'authority']),
  inList('ve_outcome_chk', t.outcome, ['pass', 'fail', 'warn']),
  inList('ve_failure_class_chk', t.failureClass, FAILURE_CLASSES),
]);

/**
 * THE MORE VALUABLE TABLE. Failures are commodity — anyone with the Schematron
 * knows what CAN fail. What actually fixes it, in what ERP, in how many minutes,
 * and whether it recurred, is knowledge nobody else has.
 */
export const resolutionEvent = corpus.table('resolution_event', {
  resolutionId:  uuid('resolution_id').primaryKey().defaultRandom(),
  recurrenceKey: text('recurrence_key').notNull(),
  resolvedAt:    tsCol('resolved_at').notNull().defaultNow(),
  action:        text('action').$type<ResolutionAction>().notNull(),
  actionDetailCode: text('action_detail_code'),
  effortMinutes:    integer('effort_minutes'),
  timeToResolveSeconds: integer('time_to_resolve_seconds'),
  recurredAfter: boolean('recurred_after').notNull().default(false),
  resolvedBy:    text('resolved_by').$type<'automated' | 'engineer' | 'client'>().notNull(),
}, (t) => [
  index('re_recurrence_idx').on(t.recurrenceKey),
  inList('re_action_chk', t.action, RESOLUTION_ACTIONS),
  inList('re_resolved_by_chk', t.resolvedBy, ['automated', 'engineer', 'client']),
]);

/** M6. The two-sided edge — a trading graph holding no identity. */
export const tradingEdge = corpus.table('trading_edge', {
  edgeId:           uuid('edge_id').primaryKey().defaultRandom(),
  issuerHash:       text('issuer_hash').notNull(),
  receiverHash:     text('receiver_hash').notNull(),
  jurisdictionPair: text('jurisdiction_pair').notNull(),   // 'AE>AE', 'AE>OM'
  observedAt:       tsCol('observed_at').notNull().defaultNow(),
  outcome:          text('outcome').$type<'pass' | 'fail'>().notNull(),
  ruleId:           text('rule_id'),
}, (t) => [
  index('edge_issuer_idx').on(t.issuerHash),
  index('edge_receiver_idx').on(t.receiverHash),
  inList('edge_outcome_chk', t.outcome, ['pass', 'fail']),
]);

export type MagnitudeBucket = '<0.1%' | '0.1-1%' | '1-5%' | '>5%';

/** M7. Magnitude bucketed — Rule 1 still applies. */
export const divergencePattern = corpus.table('divergence_pattern', {
  patternId:       uuid('pattern_id').primaryKey().defaultRandom(),
  entityHash:      text('entity_hash').notNull(),
  jurisdiction:    text('jurisdiction').notNull(),
  sysId:           text('sys_id'),
  divergenceClass: text('divergence_class').notNull(),
  periodYm:        text('period_ym').notNull(),
  magnitudeBucket: text('magnitude_bucket').$type<MagnitudeBucket>().notNull(),
  resolvedAs:      text('resolved_as'),
  observedAt:      tsCol('observed_at').notNull().defaultNow(),
});
