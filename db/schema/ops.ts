// Cross-cutting: audit, access log, sign-ins, jobs, imports/exports, retention. Design doc 02 §7.
import {
  foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid,
} from "drizzle-orm/pg-core";
import { createdOnly, firmId, id } from "./_common";
import { firms } from "./platform";

const firmFk = (t: { firmId: any }) => foreignKey({ columns: [t.firmId], foreignColumns: [firms.id] });

export const actorKind = pgEnum("actor_kind", ["person", "operator", "system"]);
export const accessPurpose = pgEnum("access_purpose", ["view", "download", "export"]);
export const jobStatus = pgEnum("job_status", ["running", "succeeded", "failed"]);
export const importStatus = pgEnum("import_status", ["uploaded", "validated", "failed", "applied", "rolled_back"]);
export const retentionBasis = pgEnum("retention_basis", ["after_last_entry", "after_offboarding"]);

/** Append-only. S-class values are redacted in diff_json. */
export const auditEvents = pgTable("audit_events", {
  id: id(),
  firmId: firmId(),
  actorKind: actorKind("actor_kind").notNull(),
  actorId: uuid("actor_id"),
  supportSessionId: uuid("support_session_id"),
  action: text("action").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id"),
  diff: jsonb("diff_json"),
  requestId: text("request_id"),
  ipHash: text("ip_hash"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("audit_subject_idx").on(t.firmId, t.subjectType, t.subjectId, t.at),
  index("audit_actor_idx").on(t.firmId, t.actorId, t.at),
  firmFk(t),
]);

/** Append-only. Every read of S-class data and every document download or export. */
export const accessLog = pgTable("access_log", {
  id: id(),
  firmId: firmId(),
  actorId: uuid("actor_id"),
  resourceKind: text("resource_kind").notNull(),
  resourceId: uuid("resource_id"),
  purpose: accessPurpose("purpose").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("access_log_resource_idx").on(t.firmId, t.resourceKind, t.resourceId), firmFk(t)]);

export const signIns = pgTable("sign_ins", {
  id: id(),
  firmId: uuid("firm_id").references(() => firms.id),
  personId: uuid("person_id"),
  email: text("email"),
  entraObjectId: text("entra_object_id"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  outcome: text("outcome").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobRuns = pgTable("job_runs", {
  id: id(),
  firmId: uuid("firm_id").references(() => firms.id),
  jobKey: text("job_key").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: jobStatus("status").notNull().default("running"),
  stats: jsonb("stats_json"),
  error: text("error"),
}, t => [index("job_runs_key_idx").on(t.jobKey, t.startedAt)]);

export const jobRequests = pgTable("job_requests", {
  id: id(),
  firmId: firmId(),
  jobKey: text("job_key").notNull(),
  params: jsonb("params_json").notNull().default({}),
  requestedBy: uuid("requested_by"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  pickedUpRunId: uuid("picked_up_run_id"),
}, t => [firmFk(t)]);

export const imports = pgTable("imports", {
  id: id(),
  firmId: firmId(),
  kind: text("kind").notNull(),
  blobPath: text("blob_path").notNull(),
  status: importStatus("status").notNull().default("uploaded"),
  rowCount: integer("row_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  report: jsonb("report_json"),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  appliedBy: uuid("applied_by"),
  ...createdOnly,
}, t => [firmFk(t)]);

export const exportsTable = pgTable("exports", {
  id: id(),
  firmId: firmId(),
  kind: text("kind").notNull(),
  params: jsonb("params_json").notNull().default({}),
  blobPath: text("blob_path").notNull(),
  createdBy: uuid("created_by"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...createdOnly,
}, t => [firmFk(t)]);

export const retentionPolicies = pgTable("retention_policies", {
  firmId: firmId(),
  retentionClass: text("retention_class").notNull(),
  years: integer("years").notNull(),
  basis: retentionBasis("basis").notNull().default("after_last_entry"),
}, t => [primaryKey({ columns: [t.firmId, t.retentionClass] }), firmFk(t)]);
