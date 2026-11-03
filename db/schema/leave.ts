// Leave engine tables. Design doc 02 §5. Balances are a projection of the append-only ledger.
import {
  boolean, date, foreignKey, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { createdOnly, firmId, id, stamps } from "./_common";
import { firms } from "./platform";
import { people } from "./org";
import { documents } from "./onboarding";

const firmFk = (t: { firmId: any }) => foreignKey({ columns: [t.firmId], foreignColumns: [firms.id] });
const days = (name: string) => numeric(name, { precision: 6, scale: 2, mode: "number" });

export const leaveCategory = pgEnum("leave_category", [
  "annual", "sick", "family_responsibility", "maternity", "parental", "adoption", "study", "unpaid", "special",
]);
export const leaveUnit = pgEnum("leave_unit", ["day", "week", "month"]);
export const reasonVisibility = pgEnum("reason_visibility", ["requester_approver", "hr_only"]);
export const cycleKind = pgEnum("leave_cycle_kind", ["annual", "three_year", "per_event", "none"]);
export const cycleAnchor = pgEnum("leave_cycle_anchor", ["start_date", "calendar_year", "firm_cycle"]);
export const accrualMethod = pgEnum("accrual_method", ["upfront", "monthly", "per_days_worked"]);
export const assignmentScope = pgEnum("policy_scope", ["all", "employment_type", "department", "person"]);
export const holidaySource = pgEnum("holiday_source", ["statute", "declared", "firm"]);
export const ledgerKind = pgEnum("ledger_kind", [
  "opening", "accrual", "taken", "reversal", "adjustment", "carry_over_in", "carry_over_out", "forfeiture", "payout", "closure",
]);
export const halfDay = pgEnum("half_day", ["am", "pm"]);
export const excludedReason = pgEnum("excluded_reason", ["weekend", "not_in_pattern", "public_holiday", "closure"]);

export const leaveTypes = pgTable("leave_types", {
  id: id(),
  firmId: firmId(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  category: leaveCategory("category").notNull(),
  isPaid: boolean("is_paid").notNull().default(true),
  unit: leaveUnit("unit").notNull().default("day"),
  allowsHalfDay: boolean("allows_half_day").notNull().default(true),
  requiresCover: boolean("requires_cover").notNull().default(true),
  showsOnCalendar: boolean("shows_on_calendar").notNull().default(true),
  reasonVisibleTo: reasonVisibility("reason_visible_to").notNull().default("requester_approver"),
  colour: text("colour").notNull().default("#6a9872"),
  isActive: boolean("is_active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  ...stamps,
}, t => [uniqueIndex("leave_types_firm_code_uq").on(t.firmId, t.code), firmFk(t)]);

export const leavePolicies = pgTable("leave_policies", {
  id: id(),
  firmId: firmId(),
  leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
  entitlement: days("entitlement").notNull(),
  cycleKind: cycleKind("cycle_kind").notNull(),
  cycleAnchor: cycleAnchor("cycle_anchor").notNull().default("start_date"),
  accrualMethod: accrualMethod("accrual_method").notNull(),
  accrualRate: numeric("accrual_rate", { precision: 8, scale: 4, mode: "number" }),
  firstMonthsRule: jsonb("first_months_rule_json"),
  minServiceMonths: integer("min_service_months").notNull().default(0),
  minDaysPerWeek: numeric("min_days_per_week", { precision: 3, scale: 1, mode: "number" }),
  carryOverCap: days("carry_over_cap"),
  carryOverExpiryMonths: integer("carry_over_expiry_months"),
  allowNegativeDays: days("allow_negative_days").notNull().default(0),
  certificateAfterDays: integer("certificate_after_days"),
  certificateOccasionsRule: jsonb("certificate_occasions_rule_json"),
  minNoticeDays: integer("min_notice_days"),
  maxAdvanceDays: integer("max_advance_days"),
  countsPublicHolidays: boolean("counts_public_holidays").notNull().default(false),
  ...stamps,
}, t => [uniqueIndex("leave_policies_version_uq").on(t.firmId, t.leaveTypeId, t.name, t.version), firmFk(t)]);

export const policyAssignments = pgTable("policy_assignments", {
  id: id(),
  firmId: firmId(),
  policyId: uuid("policy_id").notNull().references(() => leavePolicies.id),
  appliesTo: assignmentScope("applies_to").notNull().default("all"),
  appliesValue: text("applies_value"),
  priority: integer("priority").notNull().default(0),
  ...stamps,
}, t => [index("policy_assignments_firm_idx").on(t.firmId, t.policyId), firmFk(t)]);

/** National holidays have firm_id NULL and are readable by every firm (RLS policy allows NULL). */
export const publicHolidays = pgTable("public_holidays", {
  id: id(),
  firmId: uuid("firm_id").references(() => firms.id),
  date: date("date", { mode: "string" }).notNull(),
  observedDate: date("observed_date", { mode: "string" }).notNull(),
  name: text("name").notNull(),
  source: holidaySource("source").notNull().default("statute"),
  ...stamps,
}, t => [uniqueIndex("public_holidays_uq").on(t.firmId, t.date, t.name)]);

export const firmClosures = pgTable("firm_closures", {
  id: id(),
  firmId: firmId(),
  name: text("name").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id),
  excludesPeople: uuid("excludes_people").array().notNull().default([]),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  appliedBy: uuid("applied_by"),
  ...stamps,
}, t => [firmFk(t)]);

/** Append-only. Balances are derived from this; corrections are new rows, never edits. */
export const leaveLedger = pgTable("leave_ledger", {
  id: id(),
  firmId: firmId(),
  personId: uuid("person_id").notNull().references(() => people.id),
  leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id),
  cycleStart: date("cycle_start", { mode: "string" }).notNull(),
  cycleEnd: date("cycle_end", { mode: "string" }).notNull(),
  entryKind: ledgerKind("entry_kind").notNull(),
  days: days("days").notNull(),
  effectiveDate: date("effective_date", { mode: "string" }).notNull(),
  sourceKind: text("source_kind").notNull(),
  sourceId: uuid("source_id"),
  reason: text("reason"),
  policyId: uuid("policy_id"),
  policyVersion: integer("policy_version"),
  createdBy: uuid("created_by"),
  ...createdOnly,
}, t => [index("leave_ledger_person_idx").on(t.firmId, t.personId, t.leaveTypeId, t.cycleStart), firmFk(t)]);

export const leaveBalances = pgTable("leave_balances", {
  firmId: firmId(),
  personId: uuid("person_id").notNull().references(() => people.id),
  leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id),
  cycleStart: date("cycle_start", { mode: "string" }).notNull(),
  cycleEnd: date("cycle_end", { mode: "string" }).notNull(),
  opening: days("opening").notNull().default(0),
  accrued: days("accrued").notNull().default(0),
  taken: days("taken").notNull().default(0),
  adjusted: days("adjusted").notNull().default(0),
  carriedIn: days("carried_in").notNull().default(0),
  carriedOut: days("carried_out").notNull().default(0),
  forfeited: days("forfeited").notNull().default(0),
  paidOut: days("paid_out").notNull().default(0),
  reserved: days("reserved").notNull().default(0),
  available: days("available").notNull().default(0),
  projectedAtCycleEnd: days("projected_at_cycle_end"),
  rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }),
}, t => [primaryKey({ columns: [t.firmId, t.personId, t.leaveTypeId, t.cycleStart] }), firmFk(t)]);

export const leaveRequests = pgTable("leave_requests", {
  id: id(),
  firmId: firmId(),
  personId: uuid("person_id").notNull().references(() => people.id),
  leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id),
  requestNo: text("request_no").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  startHalf: halfDay("start_half"),
  endHalf: halfDay("end_half"),
  workingDays: days("working_days"),
  note: text("note"),
  reasonPrivate: text("reason_private"),
  certificateDocumentId: uuid("certificate_document_id").references(() => documents.id),
  raisedById: uuid("raised_by_id").notNull(),
  policyId: uuid("policy_id"),
  policyVersion: integer("policy_version"),
  workflowInstanceId: uuid("workflow_instance_id"),
  coverageRequestId: uuid("coverage_request_id"),
  balanceBefore: days("balance_before"),
  balanceAfter: days("balance_after"),
  clashCount: integer("clash_count").notNull().default(0),
  validation: jsonb("validation_json"),
  ...stamps,
}, t => [
  uniqueIndex("leave_requests_no_uq").on(t.firmId, t.requestNo),
  index("leave_requests_person_idx").on(t.firmId, t.personId),
  index("leave_requests_dates_idx").on(t.firmId, t.startDate, t.endDate),
  firmFk(t),
]);

export const leaveRequestDays = pgTable("leave_request_days", {
  requestId: uuid("request_id").notNull().references(() => leaveRequests.id),
  firmId: firmId(),
  date: date("date", { mode: "string" }).notNull(),
  fraction: numeric("fraction", { precision: 3, scale: 2, mode: "number" }).notNull(),
  excludedReason: excludedReason("excluded_reason"),
}, t => [primaryKey({ columns: [t.requestId, t.date] }), firmFk(t)]);
