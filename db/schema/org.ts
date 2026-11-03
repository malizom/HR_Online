// Organisation: settings, departments, people, sensitive data, emergency contacts. Design doc 02 §3–4.
import {
  boolean, customType, date, foreignKey, index, integer, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { firmId, id, stamps } from "./_common";
import { firms } from "./platform";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const personRole = pgEnum("person_role", ["admin", "manager", "staff", "viewer"]);
export const employmentType = pgEnum("employment_type", ["permanent", "fixed_term", "candidate_attorney", "contractor", "part_time"]);
export const onboardingStatus = pgEnum("onboarding_status", ["invited", "draft", "in_review", "complete"]);
export const employmentStatus = pgEnum("employment_status", ["pre_start", "active", "on_notice", "offboarded"]);
export const recordStatus = pgEnum("record_status", ["active", "archived", "purged"]);
export const leaveCycleKind = pgEnum("firm_leave_cycle", ["anniversary", "calendar", "fixed_month"]);

export const firmSettings = pgTable("firm_settings", {
  firmId: uuid("firm_id").primaryKey().references(() => firms.id),
  brandName: text("brand_name").notNull(),
  logoBlobPath: text("logo_blob_path"),
  primaryColour: text("primary_colour").notNull().default("#29553d"),
  accentColour: text("accent_colour").notNull().default("#6a9872"),
  letterheadBlobPath: text("letterhead_blob_path"),
  workWeek: integer("work_week").array().notNull().default(sql`'{1,2,3,4,5}'::int[]`),
  defaultHoursPerDay: numeric("default_hours_per_day", { precision: 4, scale: 2 }).notNull().default("8"),
  leaveCycle: leaveCycleKind("fiscal_leave_cycle").notNull().default("anniversary"),
  cycleStartMonth: integer("cycle_start_month").notNull().default(1),
  minNoticeDays: integer("min_notice_days").notNull().default(5),
  maxAdvanceDays: integer("max_advance_days").notNull().default(365),
  sessionIdleMinutes: integer("session_idle_minutes").notNull().default(30),
  ...stamps,
});

export const departments = pgTable("departments", {
  id: id(),
  firmId: firmId(),
  name: text("name").notNull(),
  code: text("code"),
  isActive: boolean("is_active").notNull().default(true),
  ...stamps,
}, t => [
  uniqueIndex("departments_firm_name_uq").on(t.firmId, t.name),
  foreignKey({ columns: [t.firmId], foreignColumns: [firms.id] }),
]);

export const people = pgTable("people", {
  id: id(),
  firmId: firmId(),
  employeeNo: text("employee_no"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  preferredName: text("preferred_name"),
  workEmail: text("work_email").notNull(), // stored lower-case
  entraObjectId: text("entra_object_id"),
  phone: text("phone"),
  role: personRole("role").notNull().default("staff"),
  departmentId: uuid("department_id"),
  reportsToId: uuid("reports_to_id"),
  jobTitle: text("job_title"),
  employmentType: employmentType("employment_type").notNull().default("permanent"),
  isFeeEarner: boolean("is_fee_earner").notNull().default(false),
  isAdmittedAttorney: boolean("is_admitted_attorney").notNull().default(false),
  workPattern: integer("work_pattern").array(),
  hoursPerDay: numeric("hours_per_day", { precision: 4, scale: 2 }),
  startDate: date("start_date", { mode: "string" }),
  probationEndDate: date("probation_end_date", { mode: "string" }),
  contractEndDate: date("contract_end_date", { mode: "string" }),
  onboardingStatus: onboardingStatus("onboarding_status").notNull().default("invited"),
  employmentStatus: employmentStatus("employment_status").notNull().default("pre_start"),
  lastWorkingDay: date("last_working_day", { mode: "string" }),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  status: recordStatus("status").notNull().default("active"),
  ...stamps,
}, t => [
  uniqueIndex("people_firm_email_uq").on(t.firmId, t.workEmail),
  uniqueIndex("people_firm_empno_uq").on(t.firmId, t.employeeNo),
  index("people_firm_reports_to_idx").on(t.firmId, t.reportsToId),
  index("people_firm_dept_idx").on(t.firmId, t.departmentId),
  index("people_firm_empstatus_idx").on(t.firmId, t.employmentStatus),
  foreignKey({ columns: [t.firmId], foreignColumns: [firms.id] }),
  foreignKey({ columns: [t.departmentId], foreignColumns: [departments.id] }),
  foreignKey({ columns: [t.reportsToId], foreignColumns: [t.id] }),
]);

/** Class S data, encrypted at the application layer. Every read is written to access_log. */
export const personSensitive = pgTable("person_sensitive", {
  personId: uuid("person_id").primaryKey().references(() => people.id),
  firmId: firmId(),
  idNumberEnc: bytea("id_number_enc"),
  idNumberHmac: bytea("id_number_hmac"),
  passportNoEnc: bytea("passport_no_enc"),
  nationality: text("nationality"),
  permitExpiry: date("permit_expiry", { mode: "string" }),
  dateOfBirthEnc: bytea("date_of_birth_enc"),
  taxNumberEnc: bytea("tax_number_enc"),
  bankName: text("bank_name"),
  bankAccountEnc: bytea("bank_account_enc"),
  bankBranchCodeEnc: bytea("bank_branch_code_enc"),
  bankAccountType: text("bank_account_type"),
  addressEnc: bytea("address_enc"),
  keyVersion: integer("key_version").notNull().default(1),
  ...stamps,
}, t => [foreignKey({ columns: [t.firmId], foreignColumns: [firms.id] })]);

export const emergencyContacts = pgTable("emergency_contacts", {
  id: id(),
  firmId: firmId(),
  personId: uuid("person_id").notNull().references(() => people.id),
  name: text("name").notNull(),
  relationship: text("relationship").notNull(),
  phone: text("phone").notNull(),
  altPhone: text("alt_phone"),
  email: text("email"),
  isPrimary: boolean("is_primary").notNull().default(false),
  ...stamps,
}, t => [
  index("emergency_contacts_person_idx").on(t.firmId, t.personId),
  foreignKey({ columns: [t.firmId], foreignColumns: [firms.id] }),
]);

export type Person = typeof people.$inferSelect;
