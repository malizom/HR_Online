CREATE TYPE "public"."firm_status" AS ENUM('provisioning', 'active', 'suspended', 'exported', 'purged');--> statement-breakpoint
CREATE TYPE "public"."mail_mode" AS ENUM('graph', 'acs', 'console');--> statement-breakpoint
CREATE TYPE "public"."operator_role" AS ENUM('operator', 'support');--> statement-breakpoint
CREATE TYPE "public"."employment_status" AS ENUM('pre_start', 'active', 'on_notice', 'offboarded');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('permanent', 'fixed_term', 'candidate_attorney', 'contractor', 'part_time');--> statement-breakpoint
CREATE TYPE "public"."firm_leave_cycle" AS ENUM('anniversary', 'calendar', 'fixed_month');--> statement-breakpoint
CREATE TYPE "public"."onboarding_status" AS ENUM('invited', 'draft', 'in_review', 'complete');--> statement-breakpoint
CREATE TYPE "public"."person_role" AS ENUM('admin', 'manager', 'staff', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('active', 'archived', 'purged');--> statement-breakpoint
CREATE TYPE "public"."ack_kind" AS ENUM('written_particulars', 'policy', 'contract');--> statement-breakpoint
CREATE TYPE "public"."ack_method" AS ENUM('click', 'typed_name');--> statement-breakpoint
CREATE TYPE "public"."doc_applies_when" AS ENUM('all', 'admitted', 'candidate_attorney', 'foreign_national');--> statement-breakpoint
CREATE TYPE "public"."doc_status" AS ENUM('pending', 'verified', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."onboarding_item_kind" AS ENUM('details', 'document', 'emergency_contact', 'acknowledgement', 'induction_task');--> statement-breakpoint
CREATE TYPE "public"."onboarding_item_owner" AS ENUM('staff', 'hr');--> statement-breakpoint
CREATE TYPE "public"."accrual_method" AS ENUM('upfront', 'monthly', 'per_days_worked');--> statement-breakpoint
CREATE TYPE "public"."policy_scope" AS ENUM('all', 'employment_type', 'department', 'person');--> statement-breakpoint
CREATE TYPE "public"."leave_cycle_anchor" AS ENUM('start_date', 'calendar_year', 'firm_cycle');--> statement-breakpoint
CREATE TYPE "public"."leave_cycle_kind" AS ENUM('annual', 'three_year', 'per_event', 'none');--> statement-breakpoint
CREATE TYPE "public"."excluded_reason" AS ENUM('weekend', 'not_in_pattern', 'public_holiday', 'closure');--> statement-breakpoint
CREATE TYPE "public"."half_day" AS ENUM('am', 'pm');--> statement-breakpoint
CREATE TYPE "public"."holiday_source" AS ENUM('statute', 'declared', 'firm');--> statement-breakpoint
CREATE TYPE "public"."leave_category" AS ENUM('annual', 'sick', 'family_responsibility', 'maternity', 'parental', 'adoption', 'study', 'unpaid', 'special');--> statement-breakpoint
CREATE TYPE "public"."leave_unit" AS ENUM('day', 'week', 'month');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('opening', 'accrual', 'taken', 'reversal', 'adjustment', 'carry_over_in', 'carry_over_out', 'forfeiture', 'payout', 'closure');--> statement-breakpoint
CREATE TYPE "public"."reason_visibility" AS ENUM('requester_approver', 'hr_only');--> statement-breakpoint
CREATE TYPE "public"."approver_kind" AS ENUM('reports_to', 'person', 'role');--> statement-breakpoint
CREATE TYPE "public"."coverage_item_type" AS ENUM('court_date', 'filing_deadline', 'consultation', 'other');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'failed', 'cancelled', 'read');--> statement-breakpoint
CREATE TYPE "public"."route_scope" AS ENUM('person', 'department', 'employment_type', 'role');--> statement-breakpoint
CREATE TYPE "public"."access_purpose" AS ENUM('view', 'download', 'export');--> statement-breakpoint
CREATE TYPE "public"."actor_kind" AS ENUM('person', 'operator', 'system');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'validated', 'failed', 'applied', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."retention_basis" AS ENUM('after_last_entry', 'after_offboarding');--> statement-breakpoint
CREATE TABLE "firm_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"host" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "firms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "firm_status" DEFAULT 'provisioning' NOT NULL,
	"timezone" text DEFAULT 'Africa/Johannesburg' NOT NULL,
	"locale" text DEFAULT 'en-ZA' NOT NULL,
	"entra_tenant_id" text,
	"entra_client_id" text,
	"entra_secret_ref" text,
	"entra_secret_expires_on" date,
	"mail_mode" "mail_mode" DEFAULT 'console' NOT NULL,
	"mail_sender" text,
	"data_key_ref" text,
	"plan" text DEFAULT 'standard' NOT NULL,
	"feature_flags_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "firms_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entra_object_id" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "operator_role" DEFAULT 'support' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "operators_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "support_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "emergency_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone" text NOT NULL,
	"alt_phone" text,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "firm_settings" (
	"firm_id" uuid PRIMARY KEY NOT NULL,
	"brand_name" text NOT NULL,
	"logo_blob_path" text,
	"primary_colour" text DEFAULT '#29553d' NOT NULL,
	"accent_colour" text DEFAULT '#6a9872' NOT NULL,
	"letterhead_blob_path" text,
	"work_week" integer[] DEFAULT '{1,2,3,4,5}'::int[] NOT NULL,
	"default_hours_per_day" numeric(4, 2) DEFAULT '8' NOT NULL,
	"fiscal_leave_cycle" "firm_leave_cycle" DEFAULT 'anniversary' NOT NULL,
	"cycle_start_month" integer DEFAULT 1 NOT NULL,
	"min_notice_days" integer DEFAULT 5 NOT NULL,
	"max_advance_days" integer DEFAULT 365 NOT NULL,
	"session_idle_minutes" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"employee_no" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"preferred_name" text,
	"work_email" text NOT NULL,
	"entra_object_id" text,
	"phone" text,
	"role" "person_role" DEFAULT 'staff' NOT NULL,
	"department_id" uuid,
	"reports_to_id" uuid,
	"job_title" text,
	"employment_type" "employment_type" DEFAULT 'permanent' NOT NULL,
	"is_fee_earner" boolean DEFAULT false NOT NULL,
	"is_admitted_attorney" boolean DEFAULT false NOT NULL,
	"work_pattern" integer[],
	"hours_per_day" numeric(4, 2),
	"start_date" date,
	"probation_end_date" date,
	"contract_end_date" date,
	"onboarding_status" "onboarding_status" DEFAULT 'invited' NOT NULL,
	"employment_status" "employment_status" DEFAULT 'pre_start' NOT NULL,
	"last_working_day" date,
	"deactivated_at" timestamp with time zone,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "person_sensitive" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"id_number_enc" "bytea",
	"id_number_hmac" "bytea",
	"passport_no_enc" "bytea",
	"nationality" text,
	"permit_expiry" date,
	"date_of_birth_enc" "bytea",
	"tax_number_enc" "bytea",
	"bank_name" text,
	"bank_account_enc" "bytea",
	"bank_branch_code_enc" "bytea",
	"bank_account_type" text,
	"address_enc" "bytea",
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "ack_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" "ack_kind" NOT NULL,
	"person_id" uuid,
	"title" text NOT NULL,
	"version" integer NOT NULL,
	"blob_path" text NOT NULL,
	"sha256" text NOT NULL,
	"generated_from_template_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"ack_document_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"document_sha256" text NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"method" "ack_method" DEFAULT 'click' NOT NULL,
	"typed_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" "ack_kind" NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body_markdown" text NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "document_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"is_required" boolean DEFAULT true NOT NULL,
	"applies_when" "doc_applies_when" DEFAULT 'all' NOT NULL,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"accepted_mime" text[] NOT NULL,
	"max_bytes" integer DEFAULT 10485760 NOT NULL,
	"has_expiry" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"blob_path" text NOT NULL,
	"sha256" text NOT NULL,
	"expires_on" date,
	"status" "doc_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "induction_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"label" text NOT NULL,
	"owner" "onboarding_item_owner" DEFAULT 'hr' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "onboarding_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"invited_at" timestamp with time zone,
	"invitation_sent_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "onboarding_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"kind" "onboarding_item_kind" NOT NULL,
	"ref_id" uuid,
	"label" text NOT NULL,
	"owner" "onboarding_item_owner" DEFAULT 'staff' NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "firm_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"excludes_people" uuid[] DEFAULT '{}' NOT NULL,
	"applied_at" timestamp with time zone,
	"applied_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"firm_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"cycle_start" date NOT NULL,
	"cycle_end" date NOT NULL,
	"opening" numeric(6, 2) DEFAULT 0 NOT NULL,
	"accrued" numeric(6, 2) DEFAULT 0 NOT NULL,
	"taken" numeric(6, 2) DEFAULT 0 NOT NULL,
	"adjusted" numeric(6, 2) DEFAULT 0 NOT NULL,
	"carried_in" numeric(6, 2) DEFAULT 0 NOT NULL,
	"carried_out" numeric(6, 2) DEFAULT 0 NOT NULL,
	"forfeited" numeric(6, 2) DEFAULT 0 NOT NULL,
	"paid_out" numeric(6, 2) DEFAULT 0 NOT NULL,
	"reserved" numeric(6, 2) DEFAULT 0 NOT NULL,
	"available" numeric(6, 2) DEFAULT 0 NOT NULL,
	"projected_at_cycle_end" numeric(6, 2),
	"rebuilt_at" timestamp with time zone,
	CONSTRAINT "leave_balances_firm_id_person_id_leave_type_id_cycle_start_pk" PRIMARY KEY("firm_id","person_id","leave_type_id","cycle_start")
);
--> statement-breakpoint
CREATE TABLE "leave_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"cycle_start" date NOT NULL,
	"cycle_end" date NOT NULL,
	"entry_kind" "ledger_kind" NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"effective_date" date NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid,
	"reason" text,
	"policy_id" uuid,
	"policy_version" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"entitlement" numeric(6, 2) NOT NULL,
	"cycle_kind" "leave_cycle_kind" NOT NULL,
	"cycle_anchor" "leave_cycle_anchor" DEFAULT 'start_date' NOT NULL,
	"accrual_method" "accrual_method" NOT NULL,
	"accrual_rate" numeric(8, 4),
	"first_months_rule_json" jsonb,
	"min_service_months" integer DEFAULT 0 NOT NULL,
	"min_days_per_week" numeric(3, 1),
	"carry_over_cap" numeric(6, 2),
	"carry_over_expiry_months" integer,
	"allow_negative_days" numeric(6, 2) DEFAULT 0 NOT NULL,
	"certificate_after_days" integer,
	"certificate_occasions_rule_json" jsonb,
	"min_notice_days" integer,
	"max_advance_days" integer,
	"counts_public_holidays" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "leave_request_days" (
	"request_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"date" date NOT NULL,
	"fraction" numeric(3, 2) NOT NULL,
	"excluded_reason" "excluded_reason",
	CONSTRAINT "leave_request_days_request_id_date_pk" PRIMARY KEY("request_id","date")
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"request_no" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_half" "half_day",
	"end_half" "half_day",
	"working_days" numeric(6, 2),
	"note" text,
	"reason_private" text,
	"certificate_document_id" uuid,
	"raised_by_id" uuid NOT NULL,
	"policy_id" uuid,
	"policy_version" integer,
	"workflow_instance_id" uuid,
	"coverage_request_id" uuid,
	"balance_before" numeric(6, 2),
	"balance_after" numeric(6, 2),
	"clash_count" integer DEFAULT 0 NOT NULL,
	"validation_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"category" "leave_category" NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"unit" "leave_unit" DEFAULT 'day' NOT NULL,
	"allows_half_day" boolean DEFAULT true NOT NULL,
	"requires_cover" boolean DEFAULT true NOT NULL,
	"shows_on_calendar" boolean DEFAULT true NOT NULL,
	"reason_visible_to" "reason_visibility" DEFAULT 'requester_approver' NOT NULL,
	"colour" text DEFAULT '#6a9872' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "policy_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"applies_to" "policy_scope" DEFAULT 'all' NOT NULL,
	"applies_value" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "public_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid,
	"date" date NOT NULL,
	"observed_date" date NOT NULL,
	"name" text NOT NULL,
	"source" "holiday_source" DEFAULT 'statute' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "approval_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"scope" "route_scope" NOT NULL,
	"scope_value" text NOT NULL,
	"approver_kind" "approver_kind" NOT NULL,
	"approver_value" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_fallback" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "coverage_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"coverage_request_id" uuid NOT NULL,
	"matter_ref" text NOT NULL,
	"client_name" text,
	"item_type" "coverage_item_type" NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"location" text,
	"notes" text,
	"checklist_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_handed_over" boolean DEFAULT false NOT NULL,
	"handed_over_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "coverage_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"leave_request_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"covering_person_id" uuid NOT NULL,
	"workflow_instance_id" uuid,
	"handover_due_at" timestamp with time zone,
	"handover_confirmed_at" timestamp with time zone,
	"handover_confirmed_by" uuid,
	"received_confirmed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"delegator_id" uuid NOT NULL,
	"delegate_id" uuid NOT NULL,
	"subject_types" text[] NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"key" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"locale" text DEFAULT 'en-ZA' NOT NULL,
	"subject" text NOT NULL,
	"body_markdown" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"definition_json" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "workflow_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"definition_key" text NOT NULL,
	"definition_version" integer NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"state" text NOT NULL,
	"assignee_id" uuid,
	"due_at" timestamp with time zone,
	"context_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid,
	"on_behalf_of_id" uuid,
	"comment" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"actor_id" uuid,
	"resource_kind" text NOT NULL,
	"resource_id" uuid,
	"purpose" "access_purpose" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_id" uuid,
	"support_session_id" uuid,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"diff_json" jsonb,
	"request_id" text,
	"ip_hash" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"params_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"blob_path" text NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"blob_path" text NOT NULL,
	"status" "import_status" DEFAULT 'uploaded' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"report_json" jsonb,
	"validated_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"applied_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"job_key" text NOT NULL,
	"params_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"picked_up_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid,
	"job_key" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "job_status" DEFAULT 'running' NOT NULL,
	"stats_json" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"firm_id" uuid NOT NULL,
	"retention_class" text NOT NULL,
	"years" integer NOT NULL,
	"basis" "retention_basis" DEFAULT 'after_last_entry' NOT NULL,
	CONSTRAINT "retention_policies_firm_id_retention_class_pk" PRIMARY KEY("firm_id","retention_class")
);
--> statement-breakpoint
CREATE TABLE "sign_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid,
	"person_id" uuid,
	"email" text,
	"entra_object_id" text,
	"ip_hash" text,
	"user_agent" text,
	"outcome" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "firm_domains" ADD CONSTRAINT "firm_domains_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD CONSTRAINT "firm_settings_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_reports_to_id_people_id_fk" FOREIGN KEY ("reports_to_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_sensitive" ADD CONSTRAINT "person_sensitive_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_sensitive" ADD CONSTRAINT "person_sensitive_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ack_documents" ADD CONSTRAINT "ack_documents_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ack_documents" ADD CONSTRAINT "ack_documents_generated_from_template_id_doc_templates_id_fk" FOREIGN KEY ("generated_from_template_id") REFERENCES "public"."doc_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ack_documents" ADD CONSTRAINT "ack_documents_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_ack_document_id_ack_documents_id_fk" FOREIGN KEY ("ack_document_id") REFERENCES "public"."ack_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_templates" ADD CONSTRAINT "doc_templates_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_categories" ADD CONSTRAINT "document_categories_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_category_id_document_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."document_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "induction_templates" ADD CONSTRAINT "induction_templates_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_checklists" ADD CONSTRAINT "onboarding_checklists_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_checklists" ADD CONSTRAINT "onboarding_checklists_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_checklist_id_onboarding_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."onboarding_checklists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_closures" ADD CONSTRAINT "firm_closures_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_closures" ADD CONSTRAINT "firm_closures_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_days" ADD CONSTRAINT "leave_request_days_request_id_leave_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."leave_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_days" ADD CONSTRAINT "leave_request_days_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_certificate_document_id_documents_id_fk" FOREIGN KEY ("certificate_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_policy_id_leave_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."leave_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_routes" ADD CONSTRAINT "approval_routes_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_items" ADD CONSTRAINT "coverage_items_coverage_request_id_coverage_requests_id_fk" FOREIGN KEY ("coverage_request_id") REFERENCES "public"."coverage_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_items" ADD CONSTRAINT "coverage_items_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_requests" ADD CONSTRAINT "coverage_requests_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_requests" ADD CONSTRAINT "coverage_requests_requester_id_people_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_requests" ADD CONSTRAINT "coverage_requests_covering_person_id_people_id_fk" FOREIGN KEY ("covering_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_requests" ADD CONSTRAINT "coverage_requests_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_delegator_id_people_id_fk" FOREIGN KEY ("delegator_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_delegate_id_people_id_fk" FOREIGN KEY ("delegate_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_people_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requests" ADD CONSTRAINT "job_requests_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_ins" ADD CONSTRAINT "sign_ins_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "firm_domains_host_uq" ON "firm_domains" USING btree ("host");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_firm_name_uq" ON "departments" USING btree ("firm_id","name");--> statement-breakpoint
CREATE INDEX "emergency_contacts_person_idx" ON "emergency_contacts" USING btree ("firm_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_firm_email_uq" ON "people" USING btree ("firm_id","work_email");--> statement-breakpoint
CREATE UNIQUE INDEX "people_firm_empno_uq" ON "people" USING btree ("firm_id","employee_no");--> statement-breakpoint
CREATE INDEX "people_firm_reports_to_idx" ON "people" USING btree ("firm_id","reports_to_id");--> statement-breakpoint
CREATE INDEX "people_firm_dept_idx" ON "people" USING btree ("firm_id","department_id");--> statement-breakpoint
CREATE INDEX "people_firm_empstatus_idx" ON "people" USING btree ("firm_id","employment_status");--> statement-breakpoint
CREATE INDEX "ack_documents_person_idx" ON "ack_documents" USING btree ("firm_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "acknowledgements_doc_person_uq" ON "acknowledgements" USING btree ("firm_id","ack_document_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_templates_kind_version_uq" ON "doc_templates" USING btree ("firm_id","kind","version");--> statement-breakpoint
CREATE UNIQUE INDEX "document_categories_firm_code_uq" ON "document_categories" USING btree ("firm_id","code");--> statement-breakpoint
CREATE INDEX "documents_firm_person_idx" ON "documents" USING btree ("firm_id","person_id");--> statement-breakpoint
CREATE INDEX "documents_firm_status_idx" ON "documents" USING btree ("firm_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_checklists_person_uq" ON "onboarding_checklists" USING btree ("firm_id","person_id");--> statement-breakpoint
CREATE INDEX "onboarding_items_checklist_idx" ON "onboarding_items" USING btree ("firm_id","checklist_id");--> statement-breakpoint
CREATE INDEX "leave_ledger_person_idx" ON "leave_ledger" USING btree ("firm_id","person_id","leave_type_id","cycle_start");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_policies_version_uq" ON "leave_policies" USING btree ("firm_id","leave_type_id","name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_requests_no_uq" ON "leave_requests" USING btree ("firm_id","request_no");--> statement-breakpoint
CREATE INDEX "leave_requests_person_idx" ON "leave_requests" USING btree ("firm_id","person_id");--> statement-breakpoint
CREATE INDEX "leave_requests_dates_idx" ON "leave_requests" USING btree ("firm_id","start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_firm_code_uq" ON "leave_types" USING btree ("firm_id","code");--> statement-breakpoint
CREATE INDEX "policy_assignments_firm_idx" ON "policy_assignments" USING btree ("firm_id","policy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_holidays_uq" ON "public_holidays" USING btree ("firm_id","date","name");--> statement-breakpoint
CREATE INDEX "approval_routes_firm_idx" ON "approval_routes" USING btree ("firm_id","subject_type");--> statement-breakpoint
CREATE INDEX "coverage_items_request_idx" ON "coverage_items" USING btree ("firm_id","coverage_request_id");--> statement-breakpoint
CREATE INDEX "coverage_requests_covering_idx" ON "coverage_requests" USING btree ("firm_id","covering_person_id");--> statement-breakpoint
CREATE INDEX "delegations_delegator_idx" ON "delegations" USING btree ("firm_id","delegator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_uq" ON "notification_templates" USING btree ("firm_id","key","channel","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("firm_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "notifications" USING btree ("status","send_after");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("firm_id","recipient_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definitions_key_version_uq" ON "workflow_definitions" USING btree ("firm_id","key","version");--> statement-breakpoint
CREATE INDEX "workflow_instances_assignee_idx" ON "workflow_instances" USING btree ("firm_id","assignee_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_instances_subject_uq" ON "workflow_instances" USING btree ("firm_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "workflow_steps_instance_idx" ON "workflow_steps" USING btree ("firm_id","instance_id");--> statement-breakpoint
CREATE INDEX "access_log_resource_idx" ON "access_log" USING btree ("firm_id","resource_kind","resource_id");--> statement-breakpoint
CREATE INDEX "audit_subject_idx" ON "audit_events" USING btree ("firm_id","subject_type","subject_id","at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_events" USING btree ("firm_id","actor_id","at");--> statement-breakpoint
CREATE INDEX "job_runs_key_idx" ON "job_runs" USING btree ("job_key","started_at");