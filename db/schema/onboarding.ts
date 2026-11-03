// Onboarding, documents, acknowledgements. Design doc 02 §4 and §7.
import {
  boolean, date, foreignKey, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { createdOnly, firmId, id, stamps } from "./_common";
import { firms } from "./platform";
import { people } from "./org";

const firmFk = (t: { firmId: any }) => foreignKey({ columns: [t.firmId], foreignColumns: [firms.id] });

export const docAppliesWhen = pgEnum("doc_applies_when", ["all", "admitted", "candidate_attorney", "foreign_national"]);
export const docStatus = pgEnum("doc_status", ["pending", "verified", "rejected", "superseded"]);
export const itemKind = pgEnum("onboarding_item_kind", ["details", "document", "emergency_contact", "acknowledgement", "induction_task"]);
export const itemOwner = pgEnum("onboarding_item_owner", ["staff", "hr"]);
export const ackKind = pgEnum("ack_kind", ["written_particulars", "policy", "contract"]);
export const ackMethod = pgEnum("ack_method", ["click", "typed_name"]);

export const documentCategories = pgTable("document_categories", {
  id: id(),
  firmId: firmId(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  isRequired: boolean("is_required").notNull().default(true),
  appliesWhen: docAppliesWhen("applies_when").notNull().default("all"),
  isSensitive: boolean("is_sensitive").notNull().default(false),
  acceptedMime: text("accepted_mime").array().notNull(),
  maxBytes: integer("max_bytes").notNull().default(10 * 1024 * 1024),
  hasExpiry: boolean("has_expiry").notNull().default(false),
  sort: integer("sort").notNull().default(0),
  ...stamps,
}, t => [uniqueIndex("document_categories_firm_code_uq").on(t.firmId, t.code), firmFk(t)]);

export const documents = pgTable("documents", {
  id: id(),
  firmId: firmId(),
  personId: uuid("person_id").notNull().references(() => people.id),
  categoryId: uuid("category_id").notNull().references(() => documentCategories.id),
  fileName: text("file_name").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  blobPath: text("blob_path").notNull(),
  sha256: text("sha256").notNull(),
  expiresOn: date("expires_on", { mode: "string" }),
  status: docStatus("status").notNull().default("pending"),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  supersededById: uuid("superseded_by_id"),
  ...stamps,
}, t => [index("documents_firm_person_idx").on(t.firmId, t.personId), index("documents_firm_status_idx").on(t.firmId, t.status), firmFk(t)]);

export const inductionTemplates = pgTable("induction_templates", {
  id: id(),
  firmId: firmId(),
  label: text("label").notNull(),
  owner: itemOwner("owner").notNull().default("hr"),
  sort: integer("sort").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  ...stamps,
}, t => [firmFk(t)]);

export const onboardingChecklists = pgTable("onboarding_checklists", {
  id: id(),
  firmId: firmId(),
  personId: uuid("person_id").notNull().references(() => people.id),
  templateVersion: integer("template_version").notNull().default(1),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  invitationSentAt: timestamp("invitation_sent_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: uuid("completed_by"),
  ...stamps,
}, t => [uniqueIndex("onboarding_checklists_person_uq").on(t.firmId, t.personId), firmFk(t)]);

export const onboardingItems = pgTable("onboarding_items", {
  id: id(),
  firmId: firmId(),
  checklistId: uuid("checklist_id").notNull().references(() => onboardingChecklists.id),
  kind: itemKind("kind").notNull(),
  refId: uuid("ref_id"),
  label: text("label").notNull(),
  owner: itemOwner("owner").notNull().default("staff"),
  isRequired: boolean("is_required").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  doneAt: timestamp("done_at", { withTimezone: true }),
  doneBy: uuid("done_by"),
  ...stamps,
}, t => [index("onboarding_items_checklist_idx").on(t.firmId, t.checklistId), firmFk(t)]);

export const docTemplates = pgTable("doc_templates", {
  id: id(),
  firmId: firmId(),
  kind: ackKind("kind").notNull(),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  bodyMarkdown: text("body_markdown").notNull(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  ...stamps,
}, t => [uniqueIndex("doc_templates_kind_version_uq").on(t.firmId, t.kind, t.version), firmFk(t)]);

export const ackDocuments = pgTable("ack_documents", {
  id: id(),
  firmId: firmId(),
  kind: ackKind("kind").notNull(),
  personId: uuid("person_id").references(() => people.id), // null = firm-wide
  title: text("title").notNull(),
  version: integer("version").notNull(),
  blobPath: text("blob_path").notNull(),
  sha256: text("sha256").notNull(),
  generatedFromTemplateId: uuid("generated_from_template_id").references(() => docTemplates.id),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  supersededById: uuid("superseded_by_id"),
  ...stamps,
}, t => [index("ack_documents_person_idx").on(t.firmId, t.personId), firmFk(t)]);

/** Evidence of acknowledgement (feature S1). Append-only. */
export const acknowledgements = pgTable("acknowledgements", {
  id: id(),
  firmId: firmId(),
  ackDocumentId: uuid("ack_document_id").notNull().references(() => ackDocuments.id),
  personId: uuid("person_id").notNull().references(() => people.id),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
  documentSha256: text("document_sha256").notNull(),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  method: ackMethod("method").notNull().default("click"),
  typedName: text("typed_name"),
  ...createdOnly,
}, t => [uniqueIndex("acknowledgements_doc_person_uq").on(t.firmId, t.ackDocumentId, t.personId), firmFk(t)]);
