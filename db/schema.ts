// MVR People & Leave — data model (v1 scope, Phase-2-ready field names)
import { pgTable, pgEnum, text, boolean, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createId } from "./id";

export const roleEnum = pgEnum("role", ["admin", "approver", "staff", "viewer"]);
export const onboardingEnum = pgEnum("onboarding_status", ["Draft", "In review", "Complete"]);
export const docStatusEnum = pgEnum("doc_status", ["Pending", "Verified", "Rejected"]);
export const leaveStatusEnum = pgEnum("leave_status", ["Pending", "Approved", "Declined", "Cancelled"]);

/** A staff member. Sign-in is allowed only if the signing-in email matches an active row here. */
export const people = pgTable("people", {
  id: text("id").primaryKey().$defaultFn(createId),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: roleEnum("role").notNull().default("staff"),
  status: onboardingEnum("status").notNull().default("Draft"),
  admitted: boolean("admitted").notNull().default(false),
  phone: text("phone"),
  title: text("title"),
  department: text("department"),
  start: text("start"), // ISO date
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: text("id").primaryKey().$defaultFn(createId),
  ownerId: text("owner_id").notNull().references(() => people.id),
  category: text("category").notNull(), // CV | ID | Banking | Qualifications | LPC
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  path: text("path").notNull(), // relative to UPLOAD_DIR
  status: docStatusEnum("status").notNull().default("Pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("documents_owner_idx").on(t.ownerId)]);

export const leave = pgTable("leave", {
  id: text("id").primaryKey().$defaultFn(createId),
  ownerId: text("owner_id").notNull().references(() => people.id),
  type: text("type").notNull(),
  start: text("start").notNull(), // ISO date, inclusive
  end: text("end").notNull(),     // ISO date, inclusive
  note: text("note"),
  status: leaveStatusEnum("status").notNull().default("Pending"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("leave_owner_idx").on(t.ownerId), index("leave_status_dates_idx").on(t.status, t.start, t.end)]);

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey().$defaultFn(createId),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  collection: text("collection").notNull(),
  recordId: text("record_id"),
  detail: jsonb("detail"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("audit_record_idx").on(t.collection, t.recordId)]);

export type Person = typeof people.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Leave = typeof leave.$inferSelect;
