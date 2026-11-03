CREATE TYPE "public"."asset_type" AS ENUM('laptop', 'phone', 'access_card', 'keys', 'software_account', 'other');--> statement-breakpoint
CREATE TYPE "public"."hr_case_kind" AS ENUM('disciplinary', 'grievance', 'incapacity', 'performance', 'other');--> statement-breakpoint
CREATE TYPE "public"."credential_kind" AS ENUM('lpc_admission', 'fidelity_fund', 'practising_certificate', 'right_of_appearance', 'notary', 'conveyancer', 'commissioner_of_oaths', 'pvt_contract', 'board_exam', 'admission_application', 'cpd', 'fica_training', 'course');--> statement-breakpoint
CREATE TYPE "public"."employment_event_kind" AS ENUM('hire', 'promotion', 'transfer', 'title_change', 'pattern_change', 'type_change', 'manager_change', 'exit');--> statement-breakpoint
CREATE TYPE "public"."offboarding_type" AS ENUM('resignation', 'dismissal', 'retirement', 'contract_end', 'retrenchment', 'death', 'other');--> statement-breakpoint
CREATE TYPE "public"."hr_request_kind" AS ENUM('work_arrangement', 'overtime', 'training', 'expense', 'employment_letter', 'certificate_of_service', 'uif_forms', 'hr_query', 'coi_declaration');--> statement-breakpoint
CREATE TYPE "public"."review_kind" AS ENUM('probation', 'annual');--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"audience_value" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "asset_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"receipt_confirmed_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"return_condition" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"type" "asset_type" NOT NULL,
	"description" text NOT NULL,
	"serial" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "credential_kind" NOT NULL,
	"title" text NOT NULL,
	"reference" text,
	"issued_on" date,
	"expires_on" date,
	"hours" numeric(6, 1),
	"provider" text,
	"details_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"document_id" uuid,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "employment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "employment_event_kind" NOT NULL,
	"effective_date" date NOT NULL,
	"summary" text NOT NULL,
	"details_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "hr_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"case_no" text NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "hr_case_kind" NOT NULL,
	"summary" text NOT NULL,
	"officer_ids" uuid[] NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"notes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "hr_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "hr_request_kind" NOT NULL,
	"title" text NOT NULL,
	"details_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"amount" numeric(12, 2),
	"hours" numeric(6, 1),
	"date_from" date,
	"date_to" date,
	"matter_ref" text,
	"receipt_document_id" uuid,
	"response" text,
	"letter_id" uuid,
	"paid_at" timestamp with time zone,
	"workflow_instance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"template" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "offboardings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"type" "offboarding_type" NOT NULL,
	"notice_date" date NOT NULL,
	"last_working_day" date NOT NULL,
	"checklist_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"handovers_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exit_interview_json" jsonb,
	"manager_signed_off_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"kind" "review_kind" NOT NULL,
	"period_label" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"due_date" date NOT NULL,
	"milestones_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"self_assessment" text,
	"manager_feedback" text,
	"rating" integer,
	"goals_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" text,
	"outcome_letter_id" uuid,
	"workflow_instance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_events" ADD CONSTRAINT "employment_events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_events" ADD CONSTRAINT "employment_events_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_cases" ADD CONSTRAINT "hr_cases_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_cases" ADD CONSTRAINT "hr_cases_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_receipt_document_id_documents_id_fk" FOREIGN KEY ("receipt_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboardings" ADD CONSTRAINT "offboardings_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboardings" ADD CONSTRAINT "offboardings_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_people_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_assignments_person_idx" ON "asset_assignments" USING btree ("firm_id","person_id");--> statement-breakpoint
CREATE INDEX "assets_firm_idx" ON "assets" USING btree ("firm_id","tag");--> statement-breakpoint
CREATE INDEX "credentials_person_idx" ON "credentials" USING btree ("firm_id","person_id");--> statement-breakpoint
CREATE INDEX "credentials_expiry_idx" ON "credentials" USING btree ("firm_id","expires_on");--> statement-breakpoint
CREATE INDEX "employment_events_person_idx" ON "employment_events" USING btree ("firm_id","person_id","effective_date");--> statement-breakpoint
CREATE INDEX "hr_cases_firm_idx" ON "hr_cases" USING btree ("firm_id","case_no");--> statement-breakpoint
CREATE INDEX "hr_requests_person_idx" ON "hr_requests" USING btree ("firm_id","person_id");--> statement-breakpoint
CREATE INDEX "hr_requests_kind_idx" ON "hr_requests" USING btree ("firm_id","kind");--> statement-breakpoint
CREATE INDEX "letters_person_idx" ON "letters" USING btree ("firm_id","person_id");--> statement-breakpoint
CREATE INDEX "offboardings_person_idx" ON "offboardings" USING btree ("firm_id","person_id");--> statement-breakpoint
CREATE INDEX "reviews_person_idx" ON "reviews" USING btree ("firm_id","person_id");