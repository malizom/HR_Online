// Later-release HR records (scope register sections D2, E–N). Design doc 02 extension for the full-product demo.
// Reuses: documents (contracts G1), ack_documents + acknowledgements (policy library G2/G3), workflow engine (all approvals).
import { boolean, date, foreignKey, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { firmId, id, stamps } from "./_common";
import { firms } from "./platform";
import { people } from "./org";
import { documents } from "./onboarding";

const firmFk = (t: { firmId: any }) => foreignKey({ columns: [t.firmId], foreignColumns: [firms.id] });

/** D2 — employment history timeline. */
export const employmentEventKind = pgEnum("employment_event_kind", ["hire", "promotion", "transfer", "title_change", "pattern_change", "type_change", "manager_change", "exit"]);
export const employmentEvents = pgTable("employment_events", {
  id: id(),
  firmId: firmId(),
  personId: uuid("person_id").notNull().references(() => people.id),
  kind: employmentEventKind("kind").notNull(),
  effectiveDate: date("effective_date", { mode: "string" }).notNull(),
  summary: text("summary").notNull(),
  details: jsonb("details_json").notNull().default({}),
  ...stamps,
}, t => [index("employment_events_person_idx").on(t.firmId, t.personId, t.effectiveDate), firmFk(t)]);

/** F1–F5, I1 — credentials, candidate-attorney milestones, CPD, FICA training and courses in one register. */
export const credentialKind = pgEnum("credential_kind", [
  "lpc_admission", "fidelity_fund", "practising_certificate", "right_of_appearance", "notary", "conveyancer", "commissioner_of_oaths",
  "pvt_contract", "board_exam", "admission_application", "cpd", "fica_training", "course",
]);
export const credentials = pgTable("credentials", {
  id: id(),
  firmId: firmId(),
  personId: uuid("person_id").notNull().references(() => people.id),
  kind: credentialKind("kind").notNull(),
  title: text("title").notNull(),
  reference: text("reference"),
  issuedOn: date("issued_on", { mode: "string" }),
  expiresOn: date("expires_on", { mode: "string" }),
  hours: numeric("hours", { precision: 6, scale: 1, mode: "number" }),
  provider: text("provider"),
  details: jsonb("details_json").notNull().default({}),
  documentId: uuid("document_id").references(() => documents.id),
  verifiedBy: uuid("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  ...stamps,
}, t => [index("credentials_person_idx").on(t.firmId, t.personId), index("credentials_expiry_idx").on(t.firmId, t.expiresOn), firmFk(t)]);

/** E1, E3, I2, K1, M1, G4, N3 — staff-initiated requests with approval through the workflow engine. */
export const requestKind = pgEnum("hr_request_kind", [
  "work_arrangement", "overtime", "training", "expense", "employment_letter", "certificate_of_service", "uif_forms", "hr_query", "coi_declaration",
]);
export const hrRequests = pgTable("hr_requests", {
  id: id(),
  firmId: firmId(),
  personId: uuid("person_id").notNull().references(() => people.id),
  kind: requestKind("kind").notNull(),
  title: text("title").notNull(),
  details: jsonb("details_json").notNull().default({}),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }),
  hours: numeric("hours", { precision: 6, scale: 1, mode: "number" }),
  dateFrom: date("date_from", { mode: "string" }),
  dateTo: date("date_to", { mode: "string" }),
  matterRef: text("matter_ref"),
  receiptDocumentId: uuid("receipt_document_id").references(() => documents.id),
  response: text("response"),
  letterId: uuid("letter_id"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  workflowInstanceId: uuid("workflow_instance_id"),
  ...stamps,
}, t => [index("hr_requests_person_idx").on(t.firmId, t.personId), index("hr_requests_kind_idx").on(t.firmId, t.kind), firmFk(t)]);

/** H1–H3 — probation and review cycles; state lives in the workflow engine. */
export const reviewKind = pgEnum("review_kind", ["probation", "annual"]);
export const reviews = pgTable("reviews", {
  id: id(),
  firmId: firmId(),
  personId: uuid("person_id").notNull().references(() => people.id),
  reviewerId: uuid("reviewer_id").references(() => people.id),
  kind: reviewKind("kind").notNull(),
  periodLabel: text("period_label").notNull(),
  periodStart: date("period_start", { mode: "string" }).notNull(),
  periodEnd: date("period_end", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  milestones: jsonb("milestones_json").notNull().default([]),
  selfAssessment: text("self_assessment"),
  managerFeedback: text("manager_feedback"),
  rating: integer("rating"),
  goals: jsonb("goals_json").notNull().default([]),
  outcome: text("outcome"),
  outcomeLetterId: uuid("outcome_letter_id"),
  workflowInstanceId: uuid("workflow_instance_id"),
  ...stamps,
}, t => [index("reviews_person_idx").on(t.firmId, t.personId), firmFk(t)]);

/** J1–J2 — asset register and assignments with receipt and return. */
export const assetType = pgEnum("asset_type", ["laptop", "phone", "access_card", "keys", "software_account", "other"]);
export const assets = pgTable("assets", {
  id: id(),
  firmId: firmId(),
  tag: text("tag").notNull(),
  type: assetType("type").notNull(),
  description: text("description").notNull(),
  serial: text("serial"),
  isActive: boolean("is_active").notNull().default(true),
  ...stamps,
}, t => [index("assets_firm_idx").on(t.firmId, t.tag), firmFk(t)]);
export const assetAssignments = pgTable("asset_assignments", {
  id: id(),
  firmId: firmId(),
  assetId: uuid("asset_id").notNull().references(() => assets.id),
  personId: uuid("person_id").notNull().references(() => people.id),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  receiptConfirmedAt: timestamp("receipt_confirmed_at", { withTimezone: true }),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
  returnCondition: text("return_condition"),
  ...stamps,
}, t => [index("asset_assignments_person_idx").on(t.firmId, t.personId), firmFk(t)]);

/** L1–L2 — confidential HR cases: named officers only, every access logged. */
export const caseKind = pgEnum("hr_case_kind", ["disciplinary", "grievance", "incapacity", "performance", "other"]);
export const hrCases = pgTable("hr_cases", {
  id: id(),
  firmId: firmId(),
  caseNo: text("case_no").notNull(),
  personId: uuid("person_id").notNull().references(() => people.id),
  kind: caseKind("kind").notNull(),
  summary: text("summary").notNull(),
  officerIds: uuid("officer_ids").array().notNull(),
  status: text("status").notNull().default("open"),
  notes: jsonb("notes_json").notNull().default([]),
  ...stamps,
}, t => [index("hr_cases_firm_idx").on(t.firmId, t.caseNo), firmFk(t)]);

/** M3 — announcements to all / a department / a role. */
export const announcements = pgTable("announcements", {
  id: id(),
  firmId: firmId(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audience: text("audience").notNull().default("all"),
  audienceValue: text("audience_value"),
  pinned: boolean("pinned").notNull().default(false),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  expiresOn: date("expires_on", { mode: "string" }),
  ...stamps,
}, t => [firmFk(t)]);

/** M2, N5, L2, H1 — letters generated from templates on firm letterhead. */
export const letters = pgTable("letters", {
  id: id(),
  firmId: firmId(),
  personId: uuid("person_id").notNull().references(() => people.id),
  template: text("template").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  issuedBy: uuid("issued_by"),
  ...stamps,
}, t => [index("letters_person_idx").on(t.firmId, t.personId), firmFk(t)]);

/** N1–N3 — offboarding record with checklist, matter handover and exit interview. */
export const offboardingType = pgEnum("offboarding_type", ["resignation", "dismissal", "retirement", "contract_end", "retrenchment", "death", "other"]);
export const offboardings = pgTable("offboardings", {
  id: id(),
  firmId: firmId(),
  personId: uuid("person_id").notNull().references(() => people.id),
  type: offboardingType("type").notNull(),
  noticeDate: date("notice_date", { mode: "string" }).notNull(),
  lastWorkingDay: date("last_working_day", { mode: "string" }).notNull(),
  checklist: jsonb("checklist_json").notNull().default([]),
  handovers: jsonb("handovers_json").notNull().default([]),
  exitInterview: jsonb("exit_interview_json"),
  managerSignedOffAt: timestamp("manager_signed_off_at", { withTimezone: true }),
  ...stamps,
}, t => [index("offboardings_person_idx").on(t.firmId, t.personId), firmFk(t)]);
