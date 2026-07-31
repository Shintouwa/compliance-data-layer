CREATE SCHEMA "app";
--> statement-breakpoint
CREATE SCHEMA "client_data";
--> statement-breakpoint
CREATE SCHEMA "corpus";
--> statement-breakpoint
CREATE TABLE "app"."client_data_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"trace_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cdal_reason_chk" CHECK ("reason" IN ('audit_delivery', 'exception_triage', 'client_support', 'scheduled_job', 'report_generation', 'incident_investigation'))
);
--> statement-breakpoint
CREATE TABLE "app"."counterparty" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"trn" text,
	"jurisdiction" text NOT NULL,
	"role" text NOT NULL,
	"corpus_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counterparty_jurisdiction_chk" CHECK ("jurisdiction" IN ('AE', 'OM', 'BH', 'SA', 'FR', 'DE', 'PL', 'ES', 'BE', 'IN')),
	CONSTRAINT "counterparty_role_chk" CHECK ("role" IN ('customer', 'supplier', 'both'))
);
--> statement-breakpoint
CREATE TABLE "app"."crm_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_activity_channel_chk" CHECK ("channel" IN ('linkedin', 'email', 'whatsapp', 'call', 'meeting')),
	CONSTRAINT "crm_activity_direction_chk" CHECK ("direction" IN ('out', 'in'))
);
--> statement-breakpoint
CREATE TABLE "app"."crm_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"person_name" text,
	"role" text,
	"email" text,
	"linkedin_url" text,
	"icp" text,
	"country" text,
	"pilot_participant" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_contact_icp_chk" CHECK ("icp" IN ('icp1_asp', 'icp2_consultancy', 'icp3_midmarket', 'icp4_sme')),
	CONSTRAINT "crm_contact_country_chk" CHECK ("country" IN ('AE', 'OM', 'BH', 'SA', 'FR', 'DE', 'PL', 'ES', 'BE', 'IN'))
);
--> statement-breakpoint
CREATE TABLE "app"."crm_opportunity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"value_minor" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"declined_on_quality" boolean DEFAULT false NOT NULL,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_opportunity_stage_chk" CHECK ("stage" IN ('researched', 'contacted', 'engaged', 'call_booked', 'qualified', 'proposal', 'won', 'lost'))
);
--> statement-breakpoint
CREATE TABLE "app"."delivery_time_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"tenant_id" uuid,
	"activity" text NOT NULL,
	"minutes" integer NOT NULL,
	"occurred_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dtl_activity_chk" CHECK ("activity" IN ('audit', 'remediation', 'exception', 'sales', 'product', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "app"."entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"trn" text,
	"jurisdiction" text NOT NULL,
	"source_system" text NOT NULL,
	"source_version" text,
	"is_free_zone" boolean DEFAULT false NOT NULL,
	"scenario_profile" jsonb NOT NULL,
	"asp_name" text,
	"asp_appointed_at" timestamp with time zone,
	"go_live_at" timestamp with time zone,
	"corpus_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_jurisdiction_chk" CHECK ("jurisdiction" IN ('AE', 'OM', 'BH', 'SA', 'FR', 'DE', 'PL', 'ES', 'BE', 'IN')),
	CONSTRAINT "entity_source_system_chk" CHECK ("source_system" IN ('tally', 'sap', 'netsuite', 'dynamics_bc', 'odoo', 'zoho_books', 'quickbooks', 'focus', 'sage_300', 'csv', 'other'))
);
--> statement-breakpoint
CREATE TABLE "app"."job_execution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"run_id" uuid NOT NULL,
	"tenant_id" uuid,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"output_hash" text,
	"error" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "job_execution_status_chk" CHECK ("status" IN ('running', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "app"."membership" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id"),
	CONSTRAINT "membership_role_chk" CHECK ("role" IN ('owner', 'admin', 'operator', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "app"."partner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"country" text,
	"data_rights_clause_signed" boolean DEFAULT false NOT NULL,
	"data_rights_signed_at" timestamp with time zone,
	"rev_share_pct" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_type_chk" CHECK ("type" IN ('asp', 'consultancy', 'erp_reseller', 'broker')),
	CONSTRAINT "partner_country_chk" CHECK ("country" IN ('AE', 'OM', 'BH', 'SA', 'FR', 'DE', 'PL', 'ES', 'BE', 'IN'))
);
--> statement-breakpoint
CREATE TABLE "app"."partner_account" (
	"partner_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_account_partner_id_tenant_id_pk" PRIMARY KEY("partner_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "app"."processed_stripe_event" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."revenue_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"invoice_ref" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revenue_kind_chk" CHECK ("kind" IN ('billed', 'collected')),
	CONSTRAINT "revenue_category_chk" CHECK ("category" IN ('recurring', 'project', 'setup', 'usage'))
);
--> statement-breakpoint
CREATE TABLE "app"."subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"mrr_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"entity_count" integer DEFAULT 1 NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"recurring_attached_at" timestamp with time zone,
	"commitment_ends_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plan_chk" CHECK ("plan" IN ('concierge_enterprise', 'concierge_midmarket', 'asp_retainer', 'self_serve', 'trial')),
	CONSTRAINT "subscription_status_chk" CHECK ("status" IN ('active', 'past_due', 'cancelled', 'trialing'))
);
--> statement-breakpoint
CREATE TABLE "app"."tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sector_code" text,
	"size_band" text,
	"country" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Dubai' NOT NULL,
	"corpus_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_size_band_chk" CHECK ("size_band" IN ('lt_10', '10_49', '50_249', '250_999', 'gte_1000')),
	CONSTRAINT "tenant_country_chk" CHECK ("country" IN ('AE', 'OM', 'BH', 'SA', 'FR', 'DE', 'PL', 'ES', 'BE', 'IN'))
);
--> statement-breakpoint
CREATE TABLE "app"."user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_data"."ap_match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"po_id" uuid,
	"goods_receipt_id" uuid,
	"state" text NOT NULL,
	"variance_minor" bigint,
	"tolerance_breached" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ap_match_state_chk" CHECK ("state" IN ('unmatched', 'matched_2way', 'matched_3way', 'price_variance', 'qty_variance', 'no_po', 'duplicate'))
);
--> statement-breakpoint
CREATE TABLE "client_data"."divergence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reconciliation_run_id" uuid NOT NULL,
	"divergence_class" text NOT NULL,
	"severity" text NOT NULL,
	"amount_minor" bigint,
	"currency" text,
	"left_dataset" text NOT NULL,
	"right_dataset" text NOT NULL,
	"document_ref" text,
	"explanation" text,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "divergence_class_chk" CHECK ("divergence_class" IN ('invoice_not_in_ledger', 'ledger_not_in_invoice', 'invoice_not_in_return', 'return_exceeds_invoices', 'counterparty_mismatch', 'credit_note_timing', 'cancellation_unreflected', 'fx_rate_variance', 'partial_delivery_timing', 'intercompany_unreconciled', 'rounding_drift')),
	CONSTRAINT "divergence_severity_chk" CHECK ("severity" IN ('info', 'warn', 'material')),
	CONSTRAINT "divergence_left_dataset_chk" CHECK ("left_dataset" IN ('invoice', 'gl_ledger', 'vat_return', 'asp_response')),
	CONSTRAINT "divergence_right_dataset_chk" CHECK ("right_dataset" IN ('invoice', 'gl_ledger', 'vat_return', 'asp_response')),
	CONSTRAINT "divergence_status_chk" CHECK ("status" IN ('open', 'explained', 'corrected', 'accepted'))
);
--> statement-breakpoint
CREATE TABLE "client_data"."exception" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"direction" text DEFAULT 'ar' NOT NULL,
	"recurrence_key" text NOT NULL,
	"rule_id" text NOT NULL,
	"failure_class" text NOT NULL,
	"affected_count" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"sla_due_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_action" text,
	"effort_minutes" integer,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "exception_direction_chk" CHECK ("direction" IN ('ar', 'ap')),
	CONSTRAINT "exception_failure_class_chk" CHECK ("failure_class" IN ('missing_mandatory', 'invalid_code', 'format_mismatch', 'arithmetic_mismatch', 'identifier_invalid', 'cardinality', 'cross_field_dependency', 'encoding', 'date_logic', 'rounding')),
	CONSTRAINT "exception_status_chk" CHECK ("status" IN ('open', 'assigned', 'in_progress', 'awaiting_client', 'resolved', 'wontfix')),
	CONSTRAINT "exception_resolution_action_chk" CHECK ("resolution_action" IN ('field_map_change', 'master_data_fix', 'erp_config_change', 'spec_misinterpretation', 'asp_config', 'wontfix'))
);
--> statement-breakpoint
CREATE TABLE "client_data"."exception_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"exception_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"visibility" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exception_comment_visibility_chk" CHECK ("visibility" IN ('internal', 'client_visible'))
);
--> statement-breakpoint
CREATE TABLE "client_data"."finding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"invoice_id" uuid,
	"doc_hash" text NOT NULL,
	"direction" text DEFAULT 'ar' NOT NULL,
	"spec_id" text NOT NULL,
	"spec_version" text NOT NULL,
	"ruleset_hash" text NOT NULL,
	"stage" text NOT NULL,
	"validator" text NOT NULL,
	"outcome" text NOT NULL,
	"rule_id" text,
	"native_rule_code" text,
	"severity" text,
	"business_term" text,
	"xpath" text,
	"failure_class" text,
	"value_shape" jsonb,
	"message" text,
	"recurrence_key" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finding_direction_chk" CHECK ("direction" IN ('ar', 'ap')),
	CONSTRAINT "finding_outcome_chk" CHECK ("outcome" IN ('pass', 'fail', 'warn')),
	CONSTRAINT "finding_severity_chk" CHECK ("severity" IN ('fatal', 'error', 'warning')),
	CONSTRAINT "finding_failure_class_chk" CHECK ("failure_class" IN ('missing_mandatory', 'invalid_code', 'format_mismatch', 'arithmetic_mismatch', 'identifier_invalid', 'cardinality', 'cross_field_dependency', 'encoding', 'date_logic', 'rounding'))
);
--> statement-breakpoint
CREATE TABLE "client_data"."gl_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"period_ym" text NOT NULL,
	"account_code" text NOT NULL,
	"document_ref" text,
	"debit_minor" bigint DEFAULT 0 NOT NULL,
	"credit_minor" bigint DEFAULT 0 NOT NULL,
	"tax_code" text,
	"currency" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_data"."goods_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"po_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"lines_json" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_data"."ingestion_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"source" text NOT NULL,
	"dataset" text DEFAULT 'invoice' NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"checksum" text NOT NULL,
	"storage_key" text NOT NULL,
	"doc_count" integer,
	"readiness_score" integer,
	"error" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ingestion_run_source_chk" CHECK ("source" IN ('sftp', 'upload', 'api_pull', 'local_agent')),
	CONSTRAINT "ingestion_run_dataset_chk" CHECK ("dataset" IN ('invoice', 'gl_ledger', 'vat_return', 'asp_response')),
	CONSTRAINT "ingestion_run_status_chk" CHECK ("status" IN ('received', 'normalising', 'mapping', 'validating', 'reporting', 'complete', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "client_data"."invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"direction" text DEFAULT 'ar' NOT NULL,
	"counterparty_id" uuid,
	"doc_hash" text NOT NULL,
	"doc_type" text NOT NULL,
	"scenario" text NOT NULL,
	"invoice_number" text NOT NULL,
	"issue_date" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"buyer_name" text,
	"buyer_trn" text,
	"seller_trn" text,
	"predecessor_ref" text,
	"line_extension_minor" bigint,
	"tax_amount_minor" bigint,
	"payable_minor" bigint,
	"has_allowance_charge" boolean DEFAULT false NOT NULL,
	"has_multi_tax_rate" boolean DEFAULT false NOT NULL,
	"line_count" integer DEFAULT 0 NOT NULL,
	"mapped_payload" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_direction_chk" CHECK ("direction" IN ('ar', 'ap')),
	CONSTRAINT "invoice_doc_type_chk" CHECK ("doc_type" IN ('invoice', 'credit_note', 'debit_note', 'self_billed')),
	CONSTRAINT "invoice_scenario_chk" CHECK ("scenario" IN ('standard', 'zero_rated', 'exempt', 'reverse_charge', 'designated_zone', 'export'))
);
--> statement-breakpoint
CREATE TABLE "client_data"."invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"description" text,
	"quantity" numeric(18, 6),
	"unit_code" text,
	"net_amount_minor" bigint,
	"tax_category_code" text,
	"tax_rate" numeric(6, 3),
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_data"."lifecycle_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"response_type" text NOT NULL,
	"status_code" text NOT NULL,
	"reason_code" text,
	"due_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"breached" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lifecycle_response_type_chk" CHECK ("response_type" IN ('MLR', 'INVOICE_RESPONSE'))
);
--> statement-breakpoint
CREATE TABLE "client_data"."mapping_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid,
	"source_system" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"mapping" jsonb NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mapping_profile_source_system_chk" CHECK ("source_system" IN ('tally', 'sap', 'netsuite', 'dynamics_bc', 'odoo', 'zoho_books', 'quickbooks', 'focus', 'sage_300', 'csv', 'other')),
	CONSTRAINT "mapping_profile_jurisdiction_chk" CHECK ("jurisdiction" IN ('AE', 'OM', 'BH', 'SA', 'FR', 'DE', 'PL', 'ES', 'BE', 'IN'))
);
--> statement-breakpoint
CREATE TABLE "client_data"."master_data_defect" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"defect_class" text NOT NULL,
	"affected_count" integer NOT NULL,
	"effort_minutes" integer,
	"sample_shape" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mdd_defect_class_chk" CHECK ("defect_class" IN ('trn_invalid', 'trn_missing', 'trn_unstructured', 'duplicate_customer', 'address_incomplete', 'identifier_inconsistent', 'unit_code_freetext', 'tax_category_unmapped', 'currency_inconsistent', 'parse_error'))
);
--> statement-breakpoint
CREATE TABLE "client_data"."notification_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"report_id" uuid,
	"channel" text NOT NULL,
	"recipient" text NOT NULL,
	"status" text NOT NULL,
	"provider_message_id" text,
	"error" jsonb,
	"sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notif_channel_chk" CHECK ("channel" IN ('email', 'webhook', 'in_app')),
	CONSTRAINT "notif_status_chk" CHECK ("status" IN ('queued', 'sent', 'failed', 'bounced'))
);
--> statement-breakpoint
CREATE TABLE "client_data"."purchase_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"counterparty_id" uuid NOT NULL,
	"po_number" text NOT NULL,
	"currency" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_data"."raw_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"checksum" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"encrypted_data_key" text NOT NULL,
	"iv" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_data"."reconciliation_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"period_ym" text NOT NULL,
	"datasets" jsonb NOT NULL,
	"assurance_score" integer,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_data"."report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"report_type" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"review_required" boolean DEFAULT true NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"spec_version" text NOT NULL,
	"ruleset_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_type_chk" CHECK ("report_type" IN ('audit', 'monthly', 'evidence'))
);
--> statement-breakpoint
CREATE TABLE "client_data"."supplier_readiness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"counterparty_id" uuid NOT NULL,
	"score" integer,
	"docs_received" integer DEFAULT 0 NOT NULL,
	"fail_rate" numeric(6, 4),
	"top_failing_rule_id" text,
	"last_breach_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_data"."vat_return" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"jurisdiction" text NOT NULL,
	"period_ym" text NOT NULL,
	"filed_at" timestamp with time zone,
	"status" text NOT NULL,
	"boxes" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vat_return_jurisdiction_chk" CHECK ("jurisdiction" IN ('AE', 'OM', 'BH', 'SA', 'FR', 'DE', 'PL', 'ES', 'BE', 'IN')),
	CONSTRAINT "vat_return_status_chk" CHECK ("status" IN ('draft', 'filed', 'amended'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."counterparty" (
	"counterparty_hash" text PRIMARY KEY NOT NULL,
	"jurisdiction" text NOT NULL,
	"size_band" text,
	"sector_code" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus"."document" (
	"doc_hash" text PRIMARY KEY NOT NULL,
	"entity_hash" text NOT NULL,
	"counterparty_hash" text,
	"direction" text DEFAULT 'ar' NOT NULL,
	"doc_type" text NOT NULL,
	"scenario" text NOT NULL,
	"currency" text NOT NULL,
	"line_count_bucket" text NOT NULL,
	"has_allowance_charge" boolean NOT NULL,
	"has_multi_tax_rate" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corpus_document_direction_chk" CHECK ("direction" IN ('ar', 'ap'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."entity" (
	"entity_hash" text PRIMARY KEY NOT NULL,
	"tenant_hash" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"sys_id" text,
	"entity_size_band" text,
	"scenario_profile" jsonb
);
--> statement-breakpoint
CREATE TABLE "corpus"."tenant" (
	"tenant_hash" text PRIMARY KEY NOT NULL,
	"sector_code" text,
	"size_band" text,
	"country" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus"."divergence_pattern" (
	"pattern_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_hash" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"sys_id" text,
	"divergence_class" text NOT NULL,
	"period_ym" text NOT NULL,
	"magnitude_bucket" text NOT NULL,
	"resolved_as" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus"."resolution_event" (
	"resolution_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recurrence_key" text NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"action_detail_code" text,
	"effort_minutes" integer,
	"time_to_resolve_seconds" integer,
	"recurred_after" boolean DEFAULT false NOT NULL,
	"resolved_by" text NOT NULL,
	CONSTRAINT "re_action_chk" CHECK ("action" IN ('field_map_change', 'master_data_fix', 'erp_config_change', 'spec_misinterpretation', 'asp_config', 'wontfix')),
	CONSTRAINT "re_resolved_by_chk" CHECK ("resolved_by" IN ('automated', 'engineer', 'client'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."rule" (
	"rule_id" text PRIMARY KEY NOT NULL,
	"spec_id" text NOT NULL,
	"native_rule_code" text NOT NULL,
	"severity" text NOT NULL,
	"business_term" text,
	"xpath_context" text,
	"failure_class" text NOT NULL,
	"assert_text" text,
	"canonical_text_hash" text NOT NULL,
	CONSTRAINT "rule_severity_chk" CHECK ("severity" IN ('fatal', 'error', 'warning')),
	CONSTRAINT "rule_failure_class_chk" CHECK ("failure_class" IN ('missing_mandatory', 'invalid_code', 'format_mismatch', 'arithmetic_mismatch', 'identifier_invalid', 'cardinality', 'cross_field_dependency', 'encoding', 'date_logic', 'rounding'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."source_system" (
	"sys_id" text PRIMARY KEY NOT NULL,
	"vendor" text NOT NULL,
	"product" text NOT NULL,
	"version" text,
	"deployment_type" text,
	CONSTRAINT "source_system_deployment_type_chk" CHECK ("deployment_type" IN ('cloud', 'on_prem', 'hybrid'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."specification" (
	"spec_id" text PRIMARY KEY NOT NULL,
	"jurisdiction" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"retired_on" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "corpus"."trading_edge" (
	"edge_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer_hash" text NOT NULL,
	"receiver_hash" text NOT NULL,
	"jurisdiction_pair" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text NOT NULL,
	"rule_id" text,
	CONSTRAINT "edge_outcome_chk" CHECK ("outcome" IN ('pass', 'fail'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."validation_event" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"doc_hash" text NOT NULL,
	"entity_hash" text NOT NULL,
	"direction" text DEFAULT 'ar' NOT NULL,
	"spec_id" text NOT NULL,
	"spec_version" text NOT NULL,
	"ruleset_hash" text NOT NULL,
	"stage" text NOT NULL,
	"validator" text NOT NULL,
	"outcome" text NOT NULL,
	"rule_id" text,
	"business_term" text,
	"xpath" text,
	"failure_class" text,
	"value_shape" jsonb,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"recurrence_key" text NOT NULL,
	CONSTRAINT "ve_direction_chk" CHECK ("direction" IN ('ar', 'ap')),
	CONSTRAINT "ve_stage_chk" CHECK ("stage" IN ('pre_map', 'post_map', 'pre_submit', 'asp_response', 'authority_response')),
	CONSTRAINT "ve_validator_chk" CHECK ("validator" IN ('own_schematron', 'asp', 'authority')),
	CONSTRAINT "ve_outcome_chk" CHECK ("outcome" IN ('pass', 'fail', 'warn')),
	CONSTRAINT "ve_failure_class_chk" CHECK ("failure_class" IN ('missing_mandatory', 'invalid_code', 'format_mismatch', 'arithmetic_mismatch', 'identifier_invalid', 'cardinality', 'cross_field_dependency', 'encoding', 'date_logic', 'rounding'))
);
--> statement-breakpoint
ALTER TABLE "app"."counterparty" ADD CONSTRAINT "counterparty_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."crm_activity" ADD CONSTRAINT "crm_activity_contact_id_crm_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "app"."crm_contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."crm_opportunity" ADD CONSTRAINT "crm_opportunity_contact_id_crm_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "app"."crm_contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."delivery_time_log" ADD CONSTRAINT "delivery_time_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entity" ADD CONSTRAINT "entity_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."membership" ADD CONSTRAINT "membership_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."membership" ADD CONSTRAINT "membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."partner_account" ADD CONSTRAINT "partner_account_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "app"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."partner_account" ADD CONSTRAINT "partner_account_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."revenue_event" ADD CONSTRAINT "revenue_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subscription" ADD CONSTRAINT "subscription_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_data"."ap_match" ADD CONSTRAINT "ap_match_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "client_data"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_data"."divergence" ADD CONSTRAINT "divergence_reconciliation_run_id_reconciliation_run_id_fk" FOREIGN KEY ("reconciliation_run_id") REFERENCES "client_data"."reconciliation_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_data"."exception_comment" ADD CONSTRAINT "exception_comment_exception_id_exception_id_fk" FOREIGN KEY ("exception_id") REFERENCES "client_data"."exception"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_data"."goods_receipt" ADD CONSTRAINT "goods_receipt_po_id_purchase_order_id_fk" FOREIGN KEY ("po_id") REFERENCES "client_data"."purchase_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_data"."invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "client_data"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_data"."lifecycle_response" ADD CONSTRAINT "lifecycle_response_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "client_data"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_data"."notification_delivery" ADD CONSTRAINT "notification_delivery_report_id_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "client_data"."report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."document" ADD CONSTRAINT "document_entity_hash_entity_entity_hash_fk" FOREIGN KEY ("entity_hash") REFERENCES "corpus"."entity"("entity_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."document" ADD CONSTRAINT "document_counterparty_hash_counterparty_counterparty_hash_fk" FOREIGN KEY ("counterparty_hash") REFERENCES "corpus"."counterparty"("counterparty_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."entity" ADD CONSTRAINT "entity_tenant_hash_tenant_tenant_hash_fk" FOREIGN KEY ("tenant_hash") REFERENCES "corpus"."tenant"("tenant_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."entity" ADD CONSTRAINT "entity_sys_id_source_system_sys_id_fk" FOREIGN KEY ("sys_id") REFERENCES "corpus"."source_system"("sys_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."rule" ADD CONSTRAINT "rule_spec_id_specification_spec_id_fk" FOREIGN KEY ("spec_id") REFERENCES "corpus"."specification"("spec_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."validation_event" ADD CONSTRAINT "validation_event_doc_hash_document_doc_hash_fk" FOREIGN KEY ("doc_hash") REFERENCES "corpus"."document"("doc_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."validation_event" ADD CONSTRAINT "validation_event_entity_hash_entity_entity_hash_fk" FOREIGN KEY ("entity_hash") REFERENCES "corpus"."entity"("entity_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."validation_event" ADD CONSTRAINT "validation_event_spec_id_specification_spec_id_fk" FOREIGN KEY ("spec_id") REFERENCES "corpus"."specification"("spec_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."validation_event" ADD CONSTRAINT "validation_event_rule_id_rule_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "corpus"."rule"("rule_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cdal_tenant_idx" ON "app"."client_data_access_log" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "counterparty_tenant_idx" ON "app"."counterparty" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "counterparty_corpus_hash_idx" ON "app"."counterparty" USING btree ("corpus_hash");--> statement-breakpoint
CREATE INDEX "dtl_day_idx" ON "app"."delivery_time_log" USING btree ("occurred_on");--> statement-breakpoint
CREATE INDEX "entity_tenant_idx" ON "app"."entity" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_corpus_hash_idx" ON "app"."entity" USING btree ("corpus_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "job_execution_unique" ON "app"."job_execution" USING btree ("job_name","run_id");--> statement-breakpoint
CREATE INDEX "revenue_kind_idx" ON "app"."revenue_event" USING btree ("kind","occurred_at");--> statement-breakpoint
CREATE INDEX "revenue_tenant_idx" ON "app"."revenue_event" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "subscription_tenant_idx" ON "app"."subscription" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_slug_idx" ON "app"."tenant" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_corpus_hash_idx" ON "app"."tenant" USING btree ("corpus_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "user_clerk_idx" ON "app"."user" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_idx" ON "app"."user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "ap_match_tenant_idx" ON "client_data"."ap_match" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "divergence_run_idx" ON "client_data"."divergence" USING btree ("reconciliation_run_id");--> statement-breakpoint
CREATE INDEX "exception_tenant_idx" ON "client_data"."exception" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "exception_status_idx" ON "client_data"."exception" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "exception_recurrence_idx" ON "client_data"."exception" USING btree ("recurrence_key");--> statement-breakpoint
CREATE INDEX "exception_sla_idx" ON "client_data"."exception" USING btree ("sla_due_at","status");--> statement-breakpoint
CREATE INDEX "finding_tenant_idx" ON "client_data"."finding" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "finding_run_idx" ON "client_data"."finding" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "finding_rule_idx" ON "client_data"."finding" USING btree ("tenant_id","rule_id");--> statement-breakpoint
CREATE INDEX "finding_recurrence_idx" ON "client_data"."finding" USING btree ("recurrence_key");--> statement-breakpoint
CREATE INDEX "gl_period_idx" ON "client_data"."gl_entry" USING btree ("tenant_id","entity_id","period_ym");--> statement-breakpoint
CREATE INDEX "gl_docref_idx" ON "client_data"."gl_entry" USING btree ("document_ref");--> statement-breakpoint
CREATE INDEX "ingestion_run_tenant_idx" ON "client_data"."ingestion_run" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ingestion_run_runid_idx" ON "client_data"."ingestion_run" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ingestion_run_expires_idx" ON "client_data"."ingestion_run" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "invoice_tenant_idx" ON "client_data"."invoice" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invoice_run_idx" ON "client_data"."invoice" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "invoice_dochash_idx" ON "client_data"."invoice" USING btree ("doc_hash");--> statement-breakpoint
CREATE INDEX "invoice_direction_idx" ON "client_data"."invoice" USING btree ("tenant_id","direction");--> statement-breakpoint
CREATE INDEX "invoice_line_tenant_idx" ON "client_data"."invoice_line" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invoice_line_invoice_idx" ON "client_data"."invoice_line" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "lifecycle_due_idx" ON "client_data"."lifecycle_response" USING btree ("due_at","sent_at");--> statement-breakpoint
CREATE INDEX "lifecycle_tenant_idx" ON "client_data"."lifecycle_response" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mapping_profile_tenant_idx" ON "client_data"."mapping_profile" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mdd_tenant_idx" ON "client_data"."master_data_defect" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "notif_tenant_idx" ON "client_data"."notification_delivery" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "po_tenant_idx" ON "client_data"."purchase_order" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "raw_document_tenant_idx" ON "client_data"."raw_document" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "raw_document_dup_idx" ON "client_data"."raw_document" USING btree ("tenant_id","checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "recon_period_idx" ON "client_data"."reconciliation_run" USING btree ("tenant_id","entity_id","period_ym");--> statement-breakpoint
CREATE INDEX "report_tenant_idx" ON "client_data"."report" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "supplier_readiness_tenant_idx" ON "client_data"."supplier_readiness" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vat_return_period_idx" ON "client_data"."vat_return" USING btree ("tenant_id","entity_id","period_ym");--> statement-breakpoint
CREATE INDEX "corpus_document_entity_idx" ON "corpus"."document" USING btree ("entity_hash");--> statement-breakpoint
CREATE INDEX "re_recurrence_idx" ON "corpus"."resolution_event" USING btree ("recurrence_key");--> statement-breakpoint
CREATE INDEX "rule_spec_idx" ON "corpus"."rule" USING btree ("spec_id");--> statement-breakpoint
CREATE INDEX "edge_issuer_idx" ON "corpus"."trading_edge" USING btree ("issuer_hash");--> statement-breakpoint
CREATE INDEX "edge_receiver_idx" ON "corpus"."trading_edge" USING btree ("receiver_hash");--> statement-breakpoint
CREATE INDEX "ve_recurrence_idx" ON "corpus"."validation_event" USING btree ("recurrence_key");--> statement-breakpoint
CREATE INDEX "ve_rule_idx" ON "corpus"."validation_event" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "ve_entity_idx" ON "corpus"."validation_event" USING btree ("entity_hash");--> statement-breakpoint
CREATE INDEX "ve_occurred_idx" ON "corpus"."validation_event" USING btree ("occurred_at");