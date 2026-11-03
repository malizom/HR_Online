// Platform (non-tenant) tables — reachable only from tenancy resolution and the operator console.
// Design doc 02 §3.
import { boolean, date, jsonb, pgEnum, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { id, stamps } from "./_common";

export const firmStatus = pgEnum("firm_status", ["provisioning", "active", "suspended", "exported", "purged"]);
export const mailMode = pgEnum("mail_mode", ["graph", "acs", "console"]);
export const operatorRole = pgEnum("operator_role", ["operator", "support"]);

export const firms = pgTable("firms", {
  id: id(),
  slug: text("slug").notNull().unique(),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name").notNull(),
  status: firmStatus("status").notNull().default("provisioning"),
  timezone: text("timezone").notNull().default("Africa/Johannesburg"),
  locale: text("locale").notNull().default("en-ZA"),
  entraTenantId: text("entra_tenant_id"),
  entraClientId: text("entra_client_id"),
  entraSecretRef: text("entra_secret_ref"),
  entraSecretExpiresOn: date("entra_secret_expires_on", { mode: "string" }),
  mailMode: mailMode("mail_mode").notNull().default("console"),
  mailSender: text("mail_sender"),
  dataKeyRef: text("data_key_ref"),
  plan: text("plan").notNull().default("standard"),
  featureFlags: jsonb("feature_flags_json").$type<Record<string, boolean>>().notNull().default({}),
  ...stamps,
});

export const firmDomains = pgTable("firm_domains", {
  id: id(),
  firmId: uuid("firm_id").notNull().references(() => firms.id),
  host: text("host").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  ...stamps,
}, t => [uniqueIndex("firm_domains_host_uq").on(t.host)]);

export const operators = pgTable("operators", {
  id: id(),
  entraObjectId: text("entra_object_id"),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: operatorRole("role").notNull().default("support"),
  active: boolean("active").notNull().default(true),
  ...stamps,
});

export const supportSessions = pgTable("support_sessions", {
  id: id(),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  firmId: uuid("firm_id").notNull().references(() => firms.id),
  reason: text("reason").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});
