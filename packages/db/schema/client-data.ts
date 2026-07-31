/**
 * Schema `client_data`. architecture.md Part I §2.5.
 *
 * Every table carries `tenant_id` — **no exceptions**, because a table without
 * it cannot be protected by RLS.
 *
 * Every table carries `expires_at` with **exactly one deliberate exception:
 * `mapping_profile`.** A mapping profile is configuration, not client data:
 * purging it would orphan the provenance of every historical run, leaving audit
 * reports whose field derivation can no longer be explained. It is therefore
 * excluded from `PURGE_TABLES` (Part IV §4 job 8) and has no `expires_at`
 * column. **If you add a second exception, you are almost certainly wrong** —
 * re-read this paragraph before doing it.
 *
 * Retention is column-driven, never hard-coded. Most rows carry
 * `expires_at = now() + 90 days`; `report`, `gl_entry`, `vat_return`,
 * `reconciliation_run` and `divergence` carry `now() + 7 years` because
 * audit-defence requires an evidentiary trail. The purge job reads the column.
 *
 * On the table-config callback form and the `CHECK` constraints, see the note at
 * the head of `app.ts`.
 */

import {
  bigint, boolean, index, integer, jsonb, numeric, pgSchema, text, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import {
  createdAt, DATASETS, FAILURE_CLASSES, FLOW_DIRECTIONS, inList, JURISDICTIONS,
  RESOLUTION_ACTIONS, SEVERITIES, SOURCE_SYSTEM_VENDORS, tsCol,
} from './_shared';
import type {
  Dataset, FailureClass, FlowDirection, Jurisdiction, ResolutionAction,
  SourceSystemVendor, ValueShape,
} from './_shared';

export const clientData = pgSchema('client_data');

export type IngestSource = 'sftp' | 'upload' | 'api_pull' | 'local_agent';
export const INGEST_SOURCES = ['sftp', 'upload', 'api_pull', 'local_agent'] as const satisfies readonly IngestSource[];

export type RunStatus = 'received' | 'normalising' | 'mapping' | 'validating'
                      | 'reporting' | 'complete' | 'failed';
export const RUN_STATUSES = [
  'received', 'normalising', 'mapping', 'validating', 'reporting', 'complete', 'failed',
] as const satisfies readonly RunStatus[];

export const ingestionRun = clientData.table('ingestion_run', {
  id:         uuid('id').primaryKey().defaultRandom(),
  /** Idempotency key. Re-running with the same runId is a no-op. Part IV §2. */
  runId:      uuid('run_id').notNull(),
  tenantId:   uuid('tenant_id').notNull(),
  entityId:   uuid('entity_id').notNull(),
  source:     text('source').$type<IngestSource>().notNull(),
  dataset:    text('dataset').$type<Dataset>().notNull().default('invoice'),
  status:     text('status').$type<RunStatus>().notNull().default('received'),
  checksum:   text('checksum').notNull(),
  storageKey: text('storage_key').notNull(),
  docCount:   integer('doc_count'),
  /** Audit-readiness score 0–100, deterministic. Part III §1.4. */
  readinessScore: integer('readiness_score'),
  error:      jsonb('error'),
  receivedAt:  tsCol('received_at').notNull().defaultNow(),
  completedAt: tsCol('completed_at'),
  expiresAt:   tsCol('expires_at').notNull(),
}, (t) => [
  index('ingestion_run_tenant_idx').on(t.tenantId),
  index('ingestion_run_runid_idx').on(t.runId),
  index('ingestion_run_expires_idx').on(t.expiresAt),
  inList('ingestion_run_source_chk', t.source, INGEST_SOURCES),
  inList('ingestion_run_dataset_chk', t.dataset, DATASETS),
  inList('ingestion_run_status_chk', t.status, RUN_STATUSES),
]);

/** Envelope-encrypted at rest (Part V §1.4) in addition to R2's own encryption. */
export const rawDocument = clientData.table('raw_document', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   uuid('tenant_id').notNull(),
  runId:      uuid('run_id').notNull(),
  storageKey: text('storage_key').notNull(),
  checksum:   text('checksum').notNull(),
  mimeType:   text('mime_type').notNull(),
  sizeBytes:  bigint('size_bytes', { mode: 'number' }).notNull(),
  /** AES-256-GCM data key, wrapped by the Doppler-held master key. */
  encryptedDataKey: text('encrypted_data_key').notNull(),
  iv:               text('iv').notNull(),
  expiresAt:  tsCol('expires_at').notNull(),
  createdAt:  createdAt(),
}, (t) => [
  index('raw_document_tenant_idx').on(t.tenantId),
  index('raw_document_dup_idx').on(t.tenantId, t.checksum),
]);

export type DocType  = 'invoice' | 'credit_note' | 'debit_note' | 'self_billed';
export const DOC_TYPES = ['invoice', 'credit_note', 'debit_note', 'self_billed'] as const satisfies readonly DocType[];

export type Scenario = 'standard' | 'zero_rated' | 'exempt' | 'reverse_charge'
                     | 'designated_zone' | 'export';
export const SCENARIOS = [
  'standard', 'zero_rated', 'exempt', 'reverse_charge', 'designated_zone', 'export',
] as const satisfies readonly Scenario[];

/** Canonical invoice — EN 16931 semantic model, source-system agnostic. */
export const invoice = clientData.table('invoice', {
  id:       uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  entityId: uuid('entity_id').notNull(),
  runId:    uuid('run_id').notNull(),
  /** 'ar' from M1; 'ap' from M6. Present from the first migration — no backfill. */
  direction: text('direction').$type<FlowDirection>().notNull().default('ar'),
  /** Nullable until M6. Enables the trading graph without a rewrite. */
  counterpartyId: uuid('counterparty_id'),
  /** sha256 of canonical form. Becomes corpus.document.doc_hash. */
  docHash:  text('doc_hash').notNull(),
  docType:  text('doc_type').$type<DocType>().notNull(),
  scenario: text('scenario').$type<Scenario>().notNull(),
  invoiceNumber:  text('invoice_number').notNull(),   // BT-1
  issueDate:      tsCol('issue_date').notNull(),      // BT-2
  currency:       text('currency').notNull(),         // BT-5, ISO 4217
  buyerName:      text('buyer_name'),                 // BT-44
  buyerTrn:       text('buyer_trn'),                  // BT-48
  sellerTrn:      text('seller_trn'),                 // BT-31
  /** BT-25. Credit-note lineage — a top-8 rejection cause when absent. */
  predecessorRef: text('predecessor_ref'),
  lineExtensionMinor: bigint('line_extension_minor', { mode: 'number' }),  // BT-106
  taxAmountMinor:     bigint('tax_amount_minor', { mode: 'number' }),      // BT-110
  payableMinor:       bigint('payable_minor', { mode: 'number' }),         // BT-115
  hasAllowanceCharge: boolean('has_allowance_charge').notNull().default(false),
  hasMultiTaxRate:    boolean('has_multi_tax_rate').notNull().default(false),
  lineCount:          integer('line_count').notNull().default(0),
  mappedPayload:      jsonb('mapped_payload'),
  expiresAt: tsCol('expires_at').notNull(),
  createdAt: createdAt(),
}, (t) => [
  index('invoice_tenant_idx').on(t.tenantId),
  index('invoice_run_idx').on(t.runId),
  index('invoice_dochash_idx').on(t.docHash),
  index('invoice_direction_idx').on(t.tenantId, t.direction),
  inList('invoice_direction_chk', t.direction, FLOW_DIRECTIONS),
  inList('invoice_doc_type_chk', t.docType, DOC_TYPES),
  inList('invoice_scenario_chk', t.scenario, SCENARIOS),
]);

export const invoiceLine = clientData.table('invoice_line', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull(),
  invoiceId:   uuid('invoice_id').notNull()
                 .references(() => invoice.id, { onDelete: 'cascade' }),
  lineNumber:  integer('line_number').notNull(),
  description: text('description'),                                 // BT-153
  quantity:    numeric('quantity', { precision: 18, scale: 6 }),    // BT-129
  /** BT-130. Must exist in UNECE Rec 20 — top-8 rejection cause. */
  unitCode:    text('unit_code'),
  netAmountMinor: bigint('net_amount_minor', { mode: 'number' }),   // BT-131
  /** BT-151. UNTDID 5305. Second-most-common rejection cause. */
  taxCategoryCode: text('tax_category_code'),
  taxRate:     numeric('tax_rate', { precision: 6, scale: 3 }),     // BT-152
  expiresAt:   tsCol('expires_at').notNull(),
}, (t) => [
  index('invoice_line_tenant_idx').on(t.tenantId),
  index('invoice_line_invoice_idx').on(t.invoiceId),
]);

/** Versioned. Never edited in place. NOT purged — configuration, not data. */
export const mappingProfile = clientData.table('mapping_profile', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull(),
  entityId:     uuid('entity_id'),
  sourceSystem: text('source_system').$type<SourceSystemVendor>().notNull(),
  jurisdiction: text('jurisdiction').$type<Jurisdiction>().notNull(),
  version:      integer('version').notNull().default(1),
  /** { "BT-48": { path: "Ledger.Notes", transform: "extract_trn" }, … } */
  mapping:      jsonb('mapping').notNull(),
  /** map.apply HARD-FAILS if either is null. AI suggests; a human confirms. */
  confirmedBy:  uuid('confirmed_by'),
  confirmedAt:  tsCol('confirmed_at'),
  createdAt:    createdAt(),
}, (t) => [
  index('mapping_profile_tenant_idx').on(t.tenantId),
  inList('mapping_profile_source_system_chk', t.sourceSystem, SOURCE_SYSTEM_VENDORS),
  inList('mapping_profile_jurisdiction_chk', t.jurisdiction, JURISDICTIONS),
]);

export type DefectClass = 'trn_invalid' | 'trn_missing' | 'trn_unstructured'
  | 'duplicate_customer' | 'address_incomplete' | 'identifier_inconsistent'
  | 'unit_code_freetext' | 'tax_category_unmapped' | 'currency_inconsistent'
  | 'parse_error';
export const DEFECT_CLASSES = [
  'trn_invalid', 'trn_missing', 'trn_unstructured',
  'duplicate_customer', 'address_incomplete', 'identifier_inconsistent',
  'unit_code_freetext', 'tax_category_unmapped', 'currency_inconsistent',
  'parse_error',
] as const satisfies readonly DefectClass[];

export const masterDataDefect = clientData.table('master_data_defect', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull(),
  entityId:      uuid('entity_id').notNull(),
  runId:         uuid('run_id').notNull(),
  defectClass:   text('defect_class').$type<DefectClass>().notNull(),
  affectedCount: integer('affected_count').notNull(),
  effortMinutes: integer('effort_minutes'),
  /** value_shape only — never raw values. */
  sampleShape:   jsonb('sample_shape').$type<ValueShape>(),
  expiresAt:     tsCol('expires_at').notNull(),
  createdAt:     createdAt(),
}, (t) => [
  index('mdd_tenant_idx').on(t.tenantId),
  inList('mdd_defect_class_chk', t.defectClass, DEFECT_CLASSES),
]);

/**
 * OPERATIONAL findings — what the UI reads. Tenant-scoped, RLS-protected,
 * 90-day TTL. Deliberately distinct from corpus.validation_event, which is
 * the permanent ANONYMISED record. Same facts, different lifecycle and
 * different trust boundary. DO NOT MERGE THEM.
 *
 * `message` is templated by the sidecar WITHOUT interpolating the offending
 * value — otherwise a raw TRN reaches this table through the message string
 * and the redaction guarantee leaks. §2.9.
 */
export const finding = clientData.table('finding', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull(),
  entityId:     uuid('entity_id').notNull(),
  runId:        uuid('run_id').notNull(),
  invoiceId:    uuid('invoice_id'),
  docHash:      text('doc_hash').notNull(),
  direction:    text('direction').$type<FlowDirection>().notNull().default('ar'),
  specId:       text('spec_id').notNull(),
  specVersion:  text('spec_version').notNull(),
  rulesetHash:  text('ruleset_hash').notNull(),
  stage:        text('stage').notNull(),
  validator:    text('validator').notNull(),
  outcome:      text('outcome').$type<'pass' | 'fail' | 'warn'>().notNull(),
  ruleId:       text('rule_id'),
  nativeRuleCode: text('native_rule_code'),
  severity:     text('severity').$type<'fatal' | 'error' | 'warning'>(),
  businessTerm: text('business_term'),
  xpath:        text('xpath'),
  failureClass: text('failure_class').$type<FailureClass>(),
  valueShape:   jsonb('value_shape').$type<ValueShape>(),
  message:      text('message'),
  recurrenceKey: text('recurrence_key').notNull(),
  expiresAt:    tsCol('expires_at').notNull(),
  createdAt:    createdAt(),
}, (t) => [
  index('finding_tenant_idx').on(t.tenantId),
  index('finding_run_idx').on(t.runId),
  index('finding_rule_idx').on(t.tenantId, t.ruleId),
  index('finding_recurrence_idx').on(t.recurrenceKey),
  inList('finding_direction_chk', t.direction, FLOW_DIRECTIONS),
  inList('finding_outcome_chk', t.outcome, ['pass', 'fail', 'warn']),
  inList('finding_severity_chk', t.severity, SEVERITIES),
  inList('finding_failure_class_chk', t.failureClass, FAILURE_CLASSES),
]);

// ---------------- M2: exceptions and reports ----------------

export type ExceptionStatus = 'open' | 'assigned' | 'in_progress'
                            | 'awaiting_client' | 'resolved' | 'wontfix';
export const EXCEPTION_STATUSES = [
  'open', 'assigned', 'in_progress', 'awaiting_client', 'resolved', 'wontfix',
] as const satisfies readonly ExceptionStatus[];

export const exception = clientData.table('exception', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull(),
  entityId:      uuid('entity_id').notNull(),
  runId:         uuid('run_id').notNull(),
  direction:     text('direction').$type<FlowDirection>().notNull().default('ar'),
  recurrenceKey: text('recurrence_key').notNull(),
  ruleId:        text('rule_id').notNull(),
  failureClass:  text('failure_class').$type<FailureClass>().notNull(),
  affectedCount: integer('affected_count').notNull().default(1),
  status:        text('status').$type<ExceptionStatus>().notNull().default('open'),
  /** app.user.id. No cross-schema FK — keeps RLS reasoning to one schema. */
  assignedTo:    uuid('assigned_to'),
  slaDueAt:      tsCol('sla_due_at'),
  firstSeenAt:   tsCol('first_seen_at').notNull().defaultNow(),
  resolvedAt:    tsCol('resolved_at'),
  resolutionAction: text('resolution_action').$type<ResolutionAction>(),
  effortMinutes: integer('effort_minutes'),
  expiresAt:     tsCol('expires_at').notNull(),
}, (t) => [
  index('exception_tenant_idx').on(t.tenantId),
  index('exception_status_idx').on(t.tenantId, t.status),
  index('exception_recurrence_idx').on(t.recurrenceKey),
  index('exception_sla_idx').on(t.slaDueAt, t.status),
  inList('exception_direction_chk', t.direction, FLOW_DIRECTIONS),
  inList('exception_failure_class_chk', t.failureClass, FAILURE_CLASSES),
  inList('exception_status_chk', t.status, EXCEPTION_STATUSES),
  inList('exception_resolution_action_chk', t.resolutionAction, RESOLUTION_ACTIONS),
]);

export const exceptionComment = clientData.table('exception_comment', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull(),
  exceptionId: uuid('exception_id').notNull()
                 .references(() => exception.id, { onDelete: 'cascade' }),
  authorId:    uuid('author_id').notNull(),
  body:        text('body').notNull(),
  visibility:  text('visibility').$type<'internal' | 'client_visible'>().notNull(),
  expiresAt:   tsCol('expires_at').notNull(),
  createdAt:   createdAt(),
}, (t) => [
  inList('exception_comment_visibility_chk', t.visibility, ['internal', 'client_visible']),
]);

/**
 * Generated reports. 7-YEAR retention — expires_at = now() + 7 years, NOT 90 days.
 * reviewRequired gates notify.deliver: an LLM-drafted narrative cannot be sent
 * to a client until a human clears it. Part IV §4 job 7.
 */
export const report = clientData.table('report', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   uuid('tenant_id').notNull(),
  entityId:   uuid('entity_id').notNull(),
  runId:      uuid('run_id').notNull(),
  reportType: text('report_type').$type<'audit' | 'monthly' | 'evidence'>().notNull(),
  storageKey: text('storage_key').notNull(),
  sha256:     text('sha256').notNull(),
  reviewRequired: boolean('review_required').notNull().default(true),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: tsCol('reviewed_at'),
  specVersion: text('spec_version').notNull(),
  rulesetHash: text('ruleset_hash').notNull(),
  expiresAt:  tsCol('expires_at').notNull(),
  createdAt:  createdAt(),
}, (t) => [
  index('report_tenant_idx').on(t.tenantId),
  inList('report_type_chk', t.reportType, ['audit', 'monthly', 'evidence']),
]);

export const notificationDelivery = clientData.table('notification_delivery', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').notNull(),
  runId:     uuid('run_id').notNull(),
  reportId:  uuid('report_id').references(() => report.id),
  channel:   text('channel').$type<'email' | 'webhook' | 'in_app'>().notNull(),
  recipient: text('recipient').notNull(),
  status:    text('status').$type<'queued' | 'sent' | 'failed' | 'bounced'>().notNull(),
  providerMessageId: text('provider_message_id'),
  error:     jsonb('error'),
  sentAt:    tsCol('sent_at'),
  expiresAt: tsCol('expires_at').notNull(),
  createdAt: createdAt(),
}, (t) => [
  index('notif_tenant_idx').on(t.tenantId),
  inList('notif_channel_chk', t.channel, ['email', 'webhook', 'in_app']),
  inList('notif_status_chk', t.status, ['queued', 'sent', 'failed', 'bounced']),
]);

// ---------------- M6: AP compliance ----------------

export const purchaseOrder = clientData.table('purchase_order', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull(),
  entityId:       uuid('entity_id').notNull(),
  counterpartyId: uuid('counterparty_id').notNull(),
  poNumber:       text('po_number').notNull(),
  currency:       text('currency').notNull(),
  totalMinor:     bigint('total_minor', { mode: 'number' }).notNull(),
  issuedAt:       tsCol('issued_at').notNull(),
  expiresAt:      tsCol('expires_at').notNull(),
}, (t) => [index('po_tenant_idx').on(t.tenantId)]);

export const goodsReceipt = clientData.table('goods_receipt', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   uuid('tenant_id').notNull(),
  poId:       uuid('po_id').notNull().references(() => purchaseOrder.id),
  receivedAt: tsCol('received_at').notNull(),
  linesJson:  jsonb('lines_json').notNull(),
  expiresAt:  tsCol('expires_at').notNull(),
});

export type MatchState = 'unmatched' | 'matched_2way' | 'matched_3way'
                       | 'price_variance' | 'qty_variance' | 'no_po' | 'duplicate';
export const MATCH_STATES = [
  'unmatched', 'matched_2way', 'matched_3way',
  'price_variance', 'qty_variance', 'no_po', 'duplicate',
] as const satisfies readonly MatchState[];

export const apMatch = clientData.table('ap_match', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull(),
  invoiceId:        uuid('invoice_id').notNull().references(() => invoice.id),
  poId:             uuid('po_id'),
  goodsReceiptId:   uuid('goods_receipt_id'),
  state:            text('state').$type<MatchState>().notNull(),
  varianceMinor:    bigint('variance_minor', { mode: 'number' }),
  toleranceBreached: boolean('tolerance_breached').notNull().default(false),
  expiresAt:        tsCol('expires_at').notNull(),
}, (t) => [
  index('ap_match_tenant_idx').on(t.tenantId),
  inList('ap_match_state_chk', t.state, MATCH_STATES),
]);

/**
 * Statutory response obligation. This table has a clock; breaching it is a
 * compliance event, not a missed SLA. The only place in the system where
 * NOT running a job is itself a violation.
 */
export const lifecycleResponse = clientData.table('lifecycle_response', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull(),
  invoiceId:    uuid('invoice_id').notNull().references(() => invoice.id),
  responseType: text('response_type').$type<'MLR' | 'INVOICE_RESPONSE'>().notNull(),
  statusCode:   text('status_code').notNull(),
  reasonCode:   text('reason_code'),
  dueAt:        tsCol('due_at').notNull(),
  sentAt:       tsCol('sent_at'),
  breached:     boolean('breached').notNull().default(false),
  expiresAt:    tsCol('expires_at').notNull(),
}, (t) => [
  index('lifecycle_due_idx').on(t.dueAt, t.sentAt),
  index('lifecycle_tenant_idx').on(t.tenantId),
  inList('lifecycle_response_type_chk', t.responseType, ['MLR', 'INVOICE_RESPONSE']),
]);

export const supplierReadiness = clientData.table('supplier_readiness', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull(),
  entityId:       uuid('entity_id').notNull(),
  counterpartyId: uuid('counterparty_id').notNull(),
  score:          integer('score'),
  docsReceived:   integer('docs_received').notNull().default(0),
  failRate:       numeric('fail_rate', { precision: 6, scale: 4 }),
  topFailingRuleId: text('top_failing_rule_id'),
  lastBreachAt:   tsCol('last_breach_at'),
  computedAt:     tsCol('computed_at').notNull().defaultNow(),
  expiresAt:      tsCol('expires_at').notNull(),
}, (t) => [index('supplier_readiness_tenant_idx').on(t.tenantId)]);

// ---------------- M7: continuous tax assurance ----------------
// gl_entry, vat_return, reconciliation_run and divergence carry
// expires_at = filedAt + 7 YEARS. The purge job reads the column.

export const glEntry = clientData.table('gl_entry', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull(),
  entityId:    uuid('entity_id').notNull(),
  runId:       uuid('run_id').notNull(),
  periodYm:    text('period_ym').notNull(),           // '2029-03'
  accountCode: text('account_code').notNull(),
  documentRef: text('document_ref'),
  debitMinor:  bigint('debit_minor', { mode: 'number' }).notNull().default(0),
  creditMinor: bigint('credit_minor', { mode: 'number' }).notNull().default(0),
  taxCode:     text('tax_code'),
  currency:    text('currency').notNull(),
  postedAt:    tsCol('posted_at').notNull(),
  expiresAt:   tsCol('expires_at').notNull(),
}, (t) => [
  index('gl_period_idx').on(t.tenantId, t.entityId, t.periodYm),
  index('gl_docref_idx').on(t.documentRef),
]);

export const vatReturn = clientData.table('vat_return', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull(),
  entityId:     uuid('entity_id').notNull(),
  jurisdiction: text('jurisdiction').$type<Jurisdiction>().notNull(),
  periodYm:     text('period_ym').notNull(),
  filedAt:      tsCol('filed_at'),
  status:       text('status').$type<'draft' | 'filed' | 'amended'>().notNull(),
  boxes:        jsonb('boxes').notNull(),
  expiresAt:    tsCol('expires_at').notNull(),
}, (t) => [
  uniqueIndex('vat_return_period_idx').on(t.tenantId, t.entityId, t.periodYm),
  inList('vat_return_jurisdiction_chk', t.jurisdiction, JURISDICTIONS),
  inList('vat_return_status_chk', t.status, ['draft', 'filed', 'amended']),
]);

export type DivergenceClass =
  | 'invoice_not_in_ledger'    | 'ledger_not_in_invoice'
  | 'invoice_not_in_return'    | 'return_exceeds_invoices'
  | 'counterparty_mismatch'    | 'credit_note_timing'
  | 'cancellation_unreflected' | 'fx_rate_variance'
  | 'partial_delivery_timing'  | 'intercompany_unreconciled'
  | 'rounding_drift';
export const DIVERGENCE_CLASSES = [
  'invoice_not_in_ledger', 'ledger_not_in_invoice',
  'invoice_not_in_return', 'return_exceeds_invoices',
  'counterparty_mismatch', 'credit_note_timing',
  'cancellation_unreflected', 'fx_rate_variance',
  'partial_delivery_timing', 'intercompany_unreconciled',
  'rounding_drift',
] as const satisfies readonly DivergenceClass[];

export const reconciliationRun = clientData.table('reconciliation_run', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull(),
  entityId:       uuid('entity_id').notNull(),
  periodYm:       text('period_ym').notNull(),
  datasets:       jsonb('datasets').$type<Dataset[]>().notNull(),
  assuranceScore: integer('assurance_score'),
  ranAt:          tsCol('ran_at').notNull().defaultNow(),
  expiresAt:      tsCol('expires_at').notNull(),
}, (t) => [
  uniqueIndex('recon_period_idx').on(t.tenantId, t.entityId, t.periodYm),
]);

export const divergence = clientData.table('divergence', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull(),
  reconciliationRunId: uuid('reconciliation_run_id').notNull()
                         .references(() => reconciliationRun.id),
  divergenceClass: text('divergence_class').$type<DivergenceClass>().notNull(),
  severity:        text('severity').$type<'info' | 'warn' | 'material'>().notNull(),
  amountMinor:     bigint('amount_minor', { mode: 'number' }),
  currency:        text('currency'),
  leftDataset:     text('left_dataset').$type<Dataset>().notNull(),
  rightDataset:    text('right_dataset').$type<Dataset>().notNull(),
  documentRef:     text('document_ref'),
  explanation:     text('explanation'),
  status:          text('status').$type<'open' | 'explained' | 'corrected' | 'accepted'>()
                     .notNull().default('open'),
  expiresAt:       tsCol('expires_at').notNull(),
}, (t) => [
  index('divergence_run_idx').on(t.reconciliationRunId),
  inList('divergence_class_chk', t.divergenceClass, DIVERGENCE_CLASSES),
  inList('divergence_severity_chk', t.severity, ['info', 'warn', 'material']),
  inList('divergence_left_dataset_chk', t.leftDataset, DATASETS),
  inList('divergence_right_dataset_chk', t.rightDataset, DATASETS),
  inList('divergence_status_chk', t.status, ['open', 'explained', 'corrected', 'accepted']),
]);

/**
 * The purge target list — Part IV §4 job 8. `mapping_profile` is deliberately
 * absent; it is configuration, and deleting it orphans every historical run's
 * provenance. Kept here, next to the tables, so the exception is visible at the
 * point where a new table gets added.
 */
export const PURGE_TABLES = [
  'ingestion_run', 'raw_document', 'invoice', 'invoice_line',
  'master_data_defect', 'finding', 'exception', 'exception_comment',
  'report', 'notification_delivery',
  'purchase_order', 'goods_receipt', 'ap_match',
  'lifecycle_response', 'supplier_readiness',
  'gl_entry', 'vat_return', 'reconciliation_run', 'divergence',
] as const;
