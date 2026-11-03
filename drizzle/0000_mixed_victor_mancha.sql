CREATE TYPE "public"."doc_status" AS ENUM('Pending', 'Verified', 'Rejected');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('Pending', 'Approved', 'Declined', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."onboarding_status" AS ENUM('Draft', 'In review', 'Complete');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'approver', 'staff', 'viewer');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"collection" text NOT NULL,
	"record_id" text,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"path" text NOT NULL,
	"status" "doc_status" DEFAULT 'Pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"type" text NOT NULL,
	"start" text NOT NULL,
	"end" text NOT NULL,
	"note" text,
	"status" "leave_status" DEFAULT 'Pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "role" DEFAULT 'staff' NOT NULL,
	"status" "onboarding_status" DEFAULT 'Draft' NOT NULL,
	"admitted" boolean DEFAULT false NOT NULL,
	"phone" text,
	"title" text,
	"department" text,
	"start" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave" ADD CONSTRAINT "leave_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_record_idx" ON "audit_log" USING btree ("collection","record_id");--> statement-breakpoint
CREATE INDEX "documents_owner_idx" ON "documents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "leave_owner_idx" ON "leave" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "leave_status_dates_idx" ON "leave" USING btree ("status","start","end");