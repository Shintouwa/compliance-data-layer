/**
 * Schema `app` — tenants, entities, users, subscriptions, partners, CRM and the
 * operational ledgers. architecture.md Part I §2.4.
 *
 * Retention: life of account. Mutable. RLS on tenant-scoped tables.
 *
 * NOTE ON THE TABLE-CONFIG CALLBACK. §2.4 is written against Drizzle's object
 * form (`(t) => ({ idx: … })`). That form is deprecated in drizzle-orm 0.39 and
 * `@typescript-eslint/no-deprecated` (part of `strictTypeChecked`) makes it a
 * lint error, which `--max-warnings 0` turns into a build failure. The array
 * form below declares exactly the same indexes under the current API. Index
 * names are unchanged, so the generated SQL matches §2.4 verbatim.
 *
 * The `CHECK` constraints are §2.3: `text()` + `$type<Union>()` is half a
 * constraint, because `$type` is erased at runtime. The database holds the
 * other half.
 */

import {
  bigint, boolean, date, index, integer, jsonb, pgSchema, primaryKey, text,
  uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import {
  createdAt, inList, JURISDICTIONS, SIZE_BANDS, SOURCE_SYSTEM_VENDORS, tsCol, updatedAt,
} from './_shared';
import type { Jurisdiction, SizeBand, SourceSystemVendor } from './_shared';

export const app = pgSchema('app');

export const tenant = app.table('tenant', {
  id:         uuid('id').primaryKey().defaultRandom(),
  name:       text('name').notNull(),
  slug:       text('slug').notNull(),
  sectorCode: text('sector_code'),
  sizeBand:   text('size_band').$type<SizeBand>(),
  country:    text('country').$type<Jurisdiction>().notNull(),
  timezone:   text('timezone').notNull().default('Asia/Dubai'),  // scheduled ingestion
  /** HMAC-SHA256(id, CORPUS_PEPPER). Deterministic, non-reversible. §2.8 */
  corpusHash: text('corpus_hash').notNull(),
  createdAt:  createdAt(),
  updatedAt:  updatedAt(),
}, (t) => [
  uniqueIndex('tenant_slug_idx').on(t.slug),
  uniqueIndex('tenant_corpus_hash_idx').on(t.corpusHash),
  inList('tenant_size_band_chk', t.sizeBand, SIZE_BANDS),
  inList('tenant_country_chk', t.country, JURISDICTIONS),
]);

export const entity = app.table('entity', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull().references(() => tenant.id),
  legalName:     text('legal_name').notNull(),
  /** Tax Registration Number. Lives in app. NEVER in corpus. */
  trn:           text('trn'),
  jurisdiction:  text('jurisdiction').$type<Jurisdiction>().notNull(),
  sourceSystem:  text('source_system').$type<SourceSystemVendor>().notNull(),
  sourceVersion: text('source_version'),
  isFreeZone:    boolean('is_free_zone').notNull().default(false),
  scenarioProfile: jsonb('scenario_profile').$type<{
    standard: boolean; zeroRated: boolean; exempt: boolean;
    reverseCharge: boolean; designatedZone: boolean;
    export: boolean; selfBilled: boolean;
  }>().notNull(),
  aspName:        text('asp_name'),
  aspAppointedAt: tsCol('asp_appointed_at'),
  goLiveAt:       tsCol('go_live_at'),
  corpusHash:     text('corpus_hash').notNull(),
  createdAt:      createdAt(),
  updatedAt:      updatedAt(),
}, (t) => [
  index('entity_tenant_idx').on(t.tenantId),
  uniqueIndex('entity_corpus_hash_idx').on(t.corpusHash),
  inList('entity_jurisdiction_chk', t.jurisdiction, JURISDICTIONS),
  inList('entity_source_system_chk', t.sourceSystem, SOURCE_SYSTEM_VENDORS),
]);

/**
 * Counterparties. Present from M1 (nullable on invoices) so that M6 AP
 * requires no backfill. corpusHash derives from jurisdiction+TRN — §2.8.
 */
export const counterparty = app.table('counterparty', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenant.id),
  legalName:    text('legal_name').notNull(),
  trn:          text('trn'),
  jurisdiction: text('jurisdiction').$type<Jurisdiction>().notNull(),
  role:         text('role').$type<'customer' | 'supplier' | 'both'>().notNull(),
  corpusHash:   text('corpus_hash').notNull(),
  createdAt:    createdAt(),
}, (t) => [
  index('counterparty_tenant_idx').on(t.tenantId),
  index('counterparty_corpus_hash_idx').on(t.corpusHash),
  inList('counterparty_jurisdiction_chk', t.jurisdiction, JURISDICTIONS),
  inList('counterparty_role_chk', t.role, ['customer', 'supplier', 'both']),
]);

export const user = app.table('user', {
  id:          uuid('id').primaryKey().defaultRandom(),
  clerkUserId: text('clerk_user_id').notNull(),
  email:       text('email').notNull(),
  name:        text('name'),
  createdAt:   createdAt(),
}, (t) => [
  uniqueIndex('user_clerk_idx').on(t.clerkUserId),
  uniqueIndex('user_email_idx').on(t.email),
]);

export type MemberRole = 'owner' | 'admin' | 'operator' | 'viewer';
export const MEMBER_ROLES = ['owner', 'admin', 'operator', 'viewer'] as const satisfies readonly MemberRole[];

export const membership = app.table('membership', {
  tenantId:  uuid('tenant_id').notNull().references(() => tenant.id),
  userId:    uuid('user_id').notNull().references(() => user.id),
  role:      text('role').$type<MemberRole>().notNull(),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.userId] }),
  inList('membership_role_chk', t.role, MEMBER_ROLES),
]);

export type PlanTier = 'concierge_enterprise' | 'concierge_midmarket'
                     | 'asp_retainer' | 'self_serve' | 'trial';
export const PLAN_TIERS = [
  'concierge_enterprise', 'concierge_midmarket', 'asp_retainer', 'self_serve', 'trial',
] as const satisfies readonly PlanTier[];

export const subscription = app.table('subscription', {
  id:       uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  plan:     text('plan').$type<PlanTier>().notNull(),
  status:   text('status').$type<'active' | 'past_due' | 'cancelled' | 'trialing'>().notNull(),
  mrrMinor: integer('mrr_minor').notNull().default(0),
  currency: text('currency').notNull().default('USD'),
  entityCount: integer('entity_count').notNull().default(1),
  stripeCustomerId:     text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  /** R5 seal: every implementation contract carries a 12-month recurring attachment. */
  recurringAttachedAt: tsCol('recurring_attached_at'),
  commitmentEndsAt:    tsCol('commitment_ends_at'),
  /** Cohort anchor. Retention is measured by signup MONTH, never blended. */
  startedAt:   tsCol('started_at').notNull(),
  cancelledAt: tsCol('cancelled_at'),
  createdAt:   createdAt(),
}, (t) => [
  index('subscription_tenant_idx').on(t.tenantId),
  inList('subscription_plan_chk', t.plan, PLAN_TIERS),
  inList('subscription_status_chk', t.status, ['active', 'past_due', 'cancelled', 'trialing']),
]);

export type PartnerType = 'asp' | 'consultancy' | 'erp_reseller' | 'broker';
export const PARTNER_TYPES = ['asp', 'consultancy', 'erp_reseller', 'broker'] as const satisfies readonly PartnerType[];

export const partner = app.table('partner', {
  id:      uuid('id').primaryKey().defaultRandom(),
  name:    text('name').notNull(),
  type:    text('type').$type<PartnerType>().notNull(),
  country: text('country').$type<Jurisdiction>(),
  /** COVENANT: 100% coverage, audited quarterly. false blocks activation. */
  dataRightsClauseSigned: boolean('data_rights_clause_signed').notNull().default(false),
  dataRightsSignedAt:     tsCol('data_rights_signed_at'),
  revSharePct:            integer('rev_share_pct'),
  createdAt: createdAt(),
}, (t) => [
  inList('partner_type_chk', t.type, PARTNER_TYPES),
  inList('partner_country_chk', t.country, JURISDICTIONS),
]);

export const partnerAccount = app.table('partner_account', {
  partnerId: uuid('partner_id').notNull().references(() => partner.id),
  tenantId:  uuid('tenant_id').notNull().references(() => tenant.id),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.partnerId, t.tenantId] })]);

// ---------------- CRM (in-product; never a third-party CRM) ----------------

export type Icp = 'icp1_asp' | 'icp2_consultancy' | 'icp3_midmarket' | 'icp4_sme';
export const ICPS = ['icp1_asp', 'icp2_consultancy', 'icp3_midmarket', 'icp4_sme'] as const satisfies readonly Icp[];

export const crmContact = app.table('crm_contact', {
  id:          uuid('id').primaryKey().defaultRandom(),
  companyName: text('company_name').notNull(),
  personName:  text('person_name'),
  role:        text('role'),
  email:       text('email'),
  linkedinUrl: text('linkedin_url'),
  icp:         text('icp').$type<Icp>(),
  country:     text('country').$type<Jurisdiction>(),
  /** Publicly identified in the UAE voluntary pilot (live since 1 Jul 2026). */
  pilotParticipant: boolean('pilot_participant').notNull().default(false),
  createdAt:   createdAt(),
}, (t) => [
  inList('crm_contact_icp_chk', t.icp, ICPS),
  inList('crm_contact_country_chk', t.country, JURISDICTIONS),
]);

export type OpportunityStage = 'researched' | 'contacted' | 'engaged' | 'call_booked'
                             | 'qualified' | 'proposal' | 'won' | 'lost';
export const OPPORTUNITY_STAGES = [
  'researched', 'contacted', 'engaged', 'call_booked',
  'qualified', 'proposal', 'won', 'lost',
] as const satisfies readonly OpportunityStage[];

export const crmOpportunity = app.table('crm_opportunity', {
  id:         uuid('id').primaryKey().defaultRandom(),
  contactId:  uuid('contact_id').notNull().references(() => crmContact.id),
  stage:      text('stage').$type<OpportunityStage>().notNull(),
  valueMinor: integer('value_minor'),
  currency:   text('currency').notNull().default('USD'),
  /** KPI: zero declines in a month means you are not filtering. */
  declinedOnQuality: boolean('declined_on_quality').notNull().default(false),
  declineReason:     text('decline_reason'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [inList('crm_opportunity_stage_chk', t.stage, OPPORTUNITY_STAGES)]);

export const crmActivity = app.table('crm_activity', {
  id:         uuid('id').primaryKey().defaultRandom(),
  contactId:  uuid('contact_id').notNull().references(() => crmContact.id),
  channel:    text('channel').$type<'linkedin' | 'email' | 'whatsapp' | 'call' | 'meeting'>().notNull(),
  direction:  text('direction').$type<'out' | 'in'>().notNull(),
  note:       text('note'),
  occurredAt: tsCol('occurred_at').notNull().defaultNow(),
}, (t) => [
  inList('crm_activity_channel_chk', t.channel,
    ['linkedin', 'email', 'whatsapp', 'call', 'meeting']),
  inList('crm_activity_direction_chk', t.direction, ['out', 'in']),
]);

// ---------------- Operational ledgers ----------------

export type JobExecutionStatus = 'running' | 'completed' | 'failed';
export const JOB_EXECUTION_STATUSES = ['running', 'completed', 'failed'] as const satisfies readonly JobExecutionStatus[];

/**
 * Job idempotency ledger. In `app`, NOT client_data — it must outlive the
 * 90-day raw-data TTL, or you lose the ability to answer "did this run?"
 * about a period whose source data has been purged. Part IV §2.
 */
export const jobExecution = app.table('job_execution', {
  id:         uuid('id').primaryKey().defaultRandom(),
  jobName:    text('job_name').notNull(),
  runId:      uuid('run_id').notNull(),
  tenantId:   uuid('tenant_id'),
  status:     text('status').$type<JobExecutionStatus>().notNull(),
  attempt:    integer('attempt').notNull().default(1),
  /** Lease expiry. A 'running' row past this is reclaimable (crashed worker). */
  leaseUntil: tsCol('lease_until').notNull(),
  outputHash: text('output_hash'),
  error:      jsonb('error'),
  startedAt:  tsCol('started_at').notNull().defaultNow(),
  finishedAt: tsCol('finished_at'),
}, (t) => [
  uniqueIndex('job_execution_unique').on(t.jobName, t.runId),
  inList('job_execution_status_chk', t.status, JOB_EXECUTION_STATUSES),
]);

export type AccessReason =
  | 'audit_delivery' | 'exception_triage' | 'client_support'
  | 'scheduled_job'  | 'report_generation' | 'incident_investigation';

/**
 * A closed union deliberately — a free-text reason field degrades to `"work"`
 * within a fortnight. §2.6.
 */
export const ACCESS_REASONS = [
  'audit_delivery', 'exception_triage', 'client_support',
  'scheduled_job', 'report_generation', 'incident_investigation',
] as const satisfies readonly AccessReason[];

/** Roadmap §9.5: every read of client data logged with actor and reason. */
export const clientDataAccessLog = app.table('client_data_access_log', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   uuid('tenant_id').notNull(),
  actorId:    uuid('actor_id').notNull(),
  reason:     text('reason').$type<AccessReason>().notNull(),
  traceId:    text('trace_id'),
  occurredAt: tsCol('occurred_at').notNull().defaultNow(),
}, (t) => [
  index('cdal_tenant_idx').on(t.tenantId, t.occurredAt),
  inList('cdal_reason_chk', t.reason, ACCESS_REASONS),
]);

/** Stripe webhook idempotency. Subscription state derives from webhooks only. */
export const processedStripeEvent = app.table('processed_stripe_event', {
  eventId:     text('event_id').primaryKey(),
  type:        text('type').notNull(),
  processedAt: createdAt(),
});

/**
 * Revenue ledger. The `category` split is what makes the recurring-mix
 * covenant computable — MRR and recurring mix must never be viewable
 * independently of each other. Dashboard CASH block.
 */
export const revenueEvent = app.table('revenue_event', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull().references(() => tenant.id),
  kind:        text('kind').$type<'billed' | 'collected'>().notNull(),
  category:    text('category').$type<'recurring' | 'project' | 'setup' | 'usage'>().notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  currency:    text('currency').notNull(),
  invoiceRef:  text('invoice_ref'),
  occurredAt:  tsCol('occurred_at').notNull(),
  createdAt:   createdAt(),
}, (t) => [
  index('revenue_kind_idx').on(t.kind, t.occurredAt),
  index('revenue_tenant_idx').on(t.tenantId),
  inList('revenue_kind_chk', t.kind, ['billed', 'collected']),
  inList('revenue_category_chk', t.category, ['recurring', 'project', 'setup', 'usage']),
]);

export type DeliveryActivity = 'audit' | 'remediation' | 'exception'
                             | 'sales' | 'product' | 'admin';
export const DELIVERY_ACTIVITIES = [
  'audit', 'remediation', 'exception', 'sales', 'product', 'admin',
] as const satisfies readonly DeliveryActivity[];

/**
 * Founder + team delivery time. Feeds the CAPACITY block, whose only job is
 * to fire the stop-selling trigger at >70% for three consecutive weeks.
 */
export const deliveryTimeLog = app.table('delivery_time_log', {
  id:         uuid('id').primaryKey().defaultRandom(),
  actorId:    uuid('actor_id').notNull().references(() => user.id),
  tenantId:   uuid('tenant_id'),
  activity:   text('activity').$type<DeliveryActivity>().notNull(),
  minutes:    integer('minutes').notNull(),
  occurredOn: date('occurred_on').notNull(),
  createdAt:  createdAt(),
}, (t) => [
  index('dtl_day_idx').on(t.occurredOn),
  inList('dtl_activity_chk', t.activity, DELIVERY_ACTIVITIES),
]);
