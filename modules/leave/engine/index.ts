/**
 * Leave engine — pure functions, no database or clock access (design doc 04 §1, §9).
 * Inputs: policy version, work pattern, holidays, closures, ledger entries and "today".
 * Outputs: numbers and reasons. Commands in modules/leave load inputs, call these, and write the ledger.
 */
import { addDays, addMonths, completedMonths, monthsElapsed, diffDays, eachDay, round2, weekday, type ISODate } from "./dates";

export * from "./dates";

export type HalfDay = "am" | "pm" | null | undefined;
export type ExcludedReason = "weekend" | "not_in_pattern" | "public_holiday" | "closure";
export type Category = "annual" | "sick" | "family_responsibility" | "maternity" | "parental" | "adoption" | "study" | "unpaid" | "special";

export const DEFAULT_PATTERN = [1, 2, 3, 4, 5];

export class EngineError extends Error {}

// ---------------------------------------------------------------- §3 working days

export interface WorkingDaysInput {
  start: ISODate; end: ISODate; startHalf?: HalfDay; endHalf?: HalfDay;
  pattern?: number[] | null;
  /** Observed dates of public holidays (Sunday → Monday already applied). */
  holidays: { observedDate: ISODate; name?: string }[];
  /** Dates already deducted by a firm closure for the same leave type. */
  closureDates?: ISODate[];
  countsPublicHolidays?: boolean;
}
export interface DayResult { date: ISODate; fraction: number; excluded?: ExcludedReason; label?: string }

export function workingDays(i: WorkingDaysInput): { total: number; days: DayResult[] } {
  if (i.end < i.start) throw new EngineError("The To date cannot be before the From date.");
  if (i.start === i.end && i.startHalf === "pm" && i.endHalf === "am") throw new EngineError("A single day cannot start in the afternoon and end in the morning.");
  const pattern = i.pattern?.length ? i.pattern : DEFAULT_PATTERN;
  const hol = new Map(i.holidays.map(h => [h.observedDate, h.name ?? "Public holiday"]));
  const closed = new Set(i.closureDates ?? []);
  const days: DayResult[] = [];
  for (const date of eachDay(i.start, i.end)) {
    const wd = weekday(date);
    if (!pattern.includes(wd)) { days.push({ date, fraction: 0, excluded: wd >= 6 ? "weekend" : "not_in_pattern" }); continue; }
    if (hol.has(date) && !i.countsPublicHolidays) { days.push({ date, fraction: 0, excluded: "public_holiday", label: hol.get(date) }); continue; }
    if (closed.has(date)) { days.push({ date, fraction: 0, excluded: "closure" }); continue; }
    let f = 1;
    if (date === i.start && i.startHalf === "pm") f = 0.5;
    if (date === i.end && i.endHalf === "am") f = 0.5;
    if (i.start === i.end && (i.startHalf || i.endHalf)) f = 0.5;
    days.push({ date, fraction: f });
  }
  return { total: round2(days.reduce((s, d) => s + d.fraction, 0)), days };
}

// ---------------------------------------------------------------- policies and cycles

export interface PolicyVersion {
  id?: string; version?: number;
  category: Category;
  entitlement: number;
  cycleKind: "annual" | "three_year" | "per_event" | "none";
  cycleAnchor: "start_date" | "calendar_year" | "firm_cycle";
  accrualMethod: "upfront" | "monthly" | "per_days_worked";
  accrualRate?: number | null;
  firstMonthsRule?: { months: number; perDaysWorked: number } | null;
  minServiceMonths?: number;
  minDaysPerWeek?: number | null;
  carryOverCap?: number | null;
  carryOverExpiryMonths?: number | null;
  allowNegativeDays?: number;
  certificateAfterDays?: number | null;
  certificateOccasionsRule?: { occasions: number; weeks: number } | null;
  minNoticeDays?: number | null;
  maxAdvanceDays?: number | null;
  countsPublicHolidays?: boolean;
}

export interface PersonFacts { startDate: ISODate | null; pattern?: number[] | null; employmentType?: string; departmentId?: string | null; id?: string }

export interface PolicyRow extends PolicyVersion { id: string; leaveTypeId: string; effectiveFrom: ISODate; effectiveTo?: ISODate | null }
export interface AssignmentRow { policyId: string; appliesTo: "all" | "employment_type" | "department" | "person"; appliesValue?: string | null; priority: number }

const SCOPE_RANK = { person: 3, department: 2, employment_type: 1, all: 0 } as const;

/** Most specific assignment wins (person > department > employment type > all), then priority, then latest version. */
export function resolvePolicy(policies: PolicyRow[], assignments: AssignmentRow[], person: PersonFacts, leaveTypeId: string, onDate: ISODate): PolicyRow | null {
  const live = policies.filter(p => p.leaveTypeId === leaveTypeId && p.effectiveFrom <= onDate && (!p.effectiveTo || p.effectiveTo >= onDate));
  const matches = (a: AssignmentRow) =>
    a.appliesTo === "all" ||
    (a.appliesTo === "person" && a.appliesValue === person.id) ||
    (a.appliesTo === "department" && a.appliesValue === person.departmentId) ||
    (a.appliesTo === "employment_type" && a.appliesValue === person.employmentType);
  const scored = live.flatMap(p => assignments.filter(a => a.policyId === p.id && matches(a)).map(a => ({ p, a })));
  scored.sort((x, y) => SCOPE_RANK[y.a.appliesTo] - SCOPE_RANK[x.a.appliesTo] || y.a.priority - x.a.priority || (y.p.version ?? 0) - (x.p.version ?? 0));
  return scored[0]?.p ?? null;
}

export function cycleFor(policy: Pick<PolicyVersion, "cycleKind" | "cycleAnchor">, person: PersonFacts, onDate: ISODate, firmCycleStartMonth = 3): { start: ISODate; end: ISODate } {
  const len = policy.cycleKind === "three_year" ? 36 : 12;
  // Sick leave always runs 36 months from start date (BCEA s22).
  const anchor = policy.cycleKind === "three_year" ? "start_date" : policy.cycleAnchor;
  if (anchor === "start_date" && person.startDate) {
    let k = Math.floor(monthsElapsed(person.startDate, onDate) / len);
    if (onDate < person.startDate) k = 0;
    const start = addMonths(person.startDate, k * len);
    return { start, end: addDays(addMonths(person.startDate, (k + 1) * len), -1) };
  }
  const y = Number(onDate.slice(0, 4));
  const m = anchor === "firm_cycle" ? firmCycleStartMonth : 1;
  let start = `${y}-${String(m).padStart(2, "0")}-01`;
  if (start > onDate) start = addMonths(start, -12);
  return { start, end: addDays(addMonths(start, len), -1) };
}

/** Days actually earned in the cycle up to onDate (doc 04 §5). `daysWorked` is needed for per-days-worked and first-months rules. */
export function accrualTo(policy: PolicyVersion, person: PersonFacts, cycle: { start: ISODate; end: ISODate }, onDate: ISODate, daysWorked = 0): number {
  if (!eligibleByService(policy, person, onDate)) return 0;
  const fm = policy.firstMonthsRule;
  if (fm && person.startDate && onDate < addMonths(person.startDate, fm.months)) return Math.floor(daysWorked / fm.perDaysWorked);
  switch (policy.accrualMethod) {
    case "upfront": return policy.entitlement;
    case "monthly": return round2(Math.min(policy.entitlement, completedMonths(cycle.start, onDate) * policy.entitlement / 12));
    case "per_days_worked": return Math.min(policy.entitlement, Math.floor(daysWorked / (policy.accrualRate || 17)));
  }
}

/** Accrual still to come between onDate and cycle end (for "available by cycle end"). */
export function remainingAccrual(policy: PolicyVersion, accruedSoFar: number) {
  return policy.accrualMethod === "upfront" ? 0 : round2(Math.max(0, policy.entitlement - accruedSoFar));
}

/** Days worked = pattern days minus public holidays minus leave of any type (doc 04 §5). */
export function daysWorked(from: ISODate, to: ISODate, pattern: number[] | null | undefined, holidays: WorkingDaysInput["holidays"], leaveDays: number) {
  if (to < from) return 0;
  return round2(workingDays({ start: from, end: to, pattern, holidays }).total - leaveDays);
}

export function eligibleByService(policy: Pick<PolicyVersion, "minServiceMonths">, person: PersonFacts, onDate: ISODate) {
  if (!policy.minServiceMonths) return true;
  if (!person.startDate) return false;
  // "Employed for longer than N months" (BCEA s27): strictly after the N-month mark.
  return onDate > addMonths(person.startDate, policy.minServiceMonths);
}

// ---------------------------------------------------------------- §4 balances

export type LedgerKind = "opening" | "accrual" | "taken" | "reversal" | "adjustment" | "carry_over_in" | "carry_over_out" | "forfeiture" | "payout" | "closure";
export interface LedgerEntry { entryKind: LedgerKind; days: number }
export interface Balance {
  opening: number; accrued: number; taken: number; adjusted: number; carriedIn: number; carriedOut: number;
  forfeited: number; paidOut: number; reserved: number; available: number;
}

/** Signed ledger: credits positive, debits negative. `taken` here is reported as a positive number net of reversals. */
export function balance(ledger: LedgerEntry[], reserved = 0): Balance {
  const sum = (...k: LedgerKind[]) => round2(ledger.filter(e => k.includes(e.entryKind)).reduce((s, e) => s + Number(e.days), 0));
  const b = {
    opening: sum("opening"), accrued: sum("accrual"), taken: round2(-sum("taken", "reversal", "closure")), adjusted: sum("adjustment"),
    carriedIn: sum("carry_over_in"), carriedOut: round2(-sum("carry_over_out")), forfeited: round2(-sum("forfeiture")), paidOut: round2(-sum("payout")),
    reserved: round2(reserved), available: 0,
  };
  b.available = round2(b.opening + b.accrued + b.carriedIn + b.adjusted - b.taken - b.carriedOut - b.forfeited - b.paidOut - b.reserved);
  return b;
}

// ---------------------------------------------------------------- §5 cycle end, carry-over, forfeiture

export interface LedgerEntryDraft { entryKind: LedgerKind; days: number; effectiveDate: ISODate; cycle: "old" | "new"; reason: string; expires?: ISODate }
export interface CycleEndResult { entries: LedgerEntryDraft[]; carried: number; forfeitureProposal: number; carryExpires: ISODate | null }

/**
 * At cycle end: carry up to the cap into the new cycle; the excess is NOT forfeited — it becomes a proposal for HR
 * (forfeiture is only defensible if the employee had a reasonable opportunity to take the leave).
 * Types with no carry-over cap (family responsibility, sick) simply lapse with the cycle.
 */
export function cycleEnd(policy: PolicyVersion, available: number, cycle: { start: ISODate; end: ISODate }): CycleEndResult {
  if (policy.carryOverCap == null || available <= 0) return { entries: [], carried: 0, forfeitureProposal: 0, carryExpires: null };
  const carried = round2(Math.min(available, policy.carryOverCap));
  const newStart = addDays(cycle.end, 1);
  const expires = policy.carryOverExpiryMonths ? addDays(addMonths(newStart, policy.carryOverExpiryMonths), -1) : null;
  const entries: LedgerEntryDraft[] = carried > 0 ? [
    { entryKind: "carry_over_out", days: -carried, effectiveDate: cycle.end, cycle: "old", reason: "Carried to next cycle" },
    { entryKind: "carry_over_in", days: carried, effectiveDate: newStart, cycle: "new", reason: "Carried from previous cycle", ...(expires ? { expires } : {}) },
  ] : [];
  return { entries, carried, forfeitureProposal: round2(available - carried), carryExpires: expires };
}

/** Carried days still unused after leave taken in the new cycle — taken leave uses carried days first (FIFO). */
export const carriedRemaining = (carriedIn: number, takenInNewCycle: number) => round2(Math.max(0, carriedIn - takenInNewCycle));

// ---------------------------------------------------------------- §6 parental

export function parentalPeriod(start: ISODate, months: number, days = 0): { end: ISODate; calendarDays: number } {
  const end = addDays(addDays(addMonths(start, months), days), -1);
  return { end, calendarDays: diffDays(start, end) + 1 };
}

// ---------------------------------------------------------------- §7 validation

export interface ValidationContext {
  category: Category;
  label: string;
  isPaid: boolean;
  policy: PolicyVersion | null;
  person: PersonFacts;
  onboardingComplete: boolean;
  today: ISODate;
  total: number;
  /** Longest run of consecutive working days in the request (for the certificate rule). */
  consecutiveDays: number;
  overlapsOwn: boolean;
  /** Working days from today (exclusive) until start (exclusive) — notice given. */
  noticeWorkingDays: number;
  available: number | null;
  /** Earlier sick occasions inside the occasions-rule window. */
  priorSickOccasions?: number;
  clashCount?: number;
  requiresCover?: boolean;
  raisedOnBehalf?: boolean;
}
export interface ValidationResult { ok: boolean; code?: string; error?: string; warnings: string[]; certificateRequired: boolean; coverRequired: boolean; shortfall?: number }

/** 2 → "2.0", 3.5 → "3.5", 3.25 → "3.25": never round a quarter day away. */
const fmt = (n: number) => (Number.isInteger(round2(n) * 10) ? n.toFixed(1) : n.toFixed(2));
const daysWord = (n: number) => `${fmt(n)} ${n === 1 ? "day" : "days"}`;

export function validate(req: { start: ISODate; end: ISODate }, c: ValidationContext): ValidationResult {
  const warnings: string[] = [];
  const out = (code: string, error: string): ValidationResult => ({ ok: false, code, error, warnings, certificateRequired: false, coverRequired: false });
  const p = c.policy;

  if (!c.onboardingComplete) return out("V1", "Complete your onboarding before submitting leave requests.");
  if (req.end < req.start) return out("V2", "The To date cannot be before the From date.");
  if (c.total <= 0) return out("V3", "Those dates are all weekends or public holidays — no leave is needed.");
  if (c.overlapsOwn) return out("V4", "You already have a pending or approved request covering those dates.");

  const noticeWaived = c.category === "sick" || c.category === "family_responsibility";
  if (!noticeWaived && p?.minNoticeDays && c.noticeWorkingDays < p.minNoticeDays) {
    const msg = `${c.label} leave needs ${p.minNoticeDays} working days' notice.`;
    if (c.raisedOnBehalf) warnings.push(msg); else return out("V5", msg);
  }
  if (p?.maxAdvanceDays && diffDays(c.today, req.start) > p.maxAdvanceDays) return out("V6", `${c.label} leave can be booked at most ${p.maxAdvanceDays} days ahead.`);

  if (p) {
    if (!eligibleByService(p, c.person, req.start)) return out("V7", `${c.label} leave applies once you have been employed for more than ${p.minServiceMonths} months.`);
    const perWeek = (c.person.pattern?.length ? c.person.pattern : DEFAULT_PATTERN).length;
    if (p.minDaysPerWeek && perWeek < p.minDaysPerWeek) return out("V7", `${c.label} leave applies to employees who work at least ${p.minDaysPerWeek} days a week.`);
  }

  let shortfall: number | undefined;
  if (p && c.available != null) {
    const after = round2(c.available - c.total);
    if (after < -(p.allowNegativeDays ?? 0)) {
      shortfall = round2(c.total - c.available - (p.allowNegativeDays ?? 0));
      return { ...out("V8", `You have ${fmt(c.available)} days available; this request needs ${fmt(c.total)}. You can request ${daysWord(shortfall)} as unpaid.`), shortfall };
    }
  }

  let certificateRequired = false;
  if (c.category === "sick" && p) {
    if (p.certificateAfterDays != null && c.consecutiveDays > p.certificateAfterDays) certificateRequired = true;
    const occ = p.certificateOccasionsRule;
    if (occ && (c.priorSickOccasions ?? 0) >= occ.occasions) certificateRequired = true;
    if (certificateRequired) warnings.push("Medical certificate required before approval.");
  }
  if (c.clashCount) warnings.push(`${c.clashCount} other ${c.clashCount === 1 ? "person" : "people"} in the team ${c.clashCount === 1 ? "is" : "are"} away on some of these days.`);

  return { ok: true, warnings, certificateRequired, coverRequired: !!c.requiresCover };
}

/** Longest run of consecutive working days (excluded days in between — weekends, holidays — don't break the run). */
export function longestRun(days: DayResult[]) {
  let best = 0, run = 0;
  for (const d of days) {
    if (d.fraction > 0) { run += d.fraction; best = Math.max(best, run); }
    else if (d.excluded === "weekend" || d.excluded === "public_holiday" || d.excluded === "not_in_pattern") continue;
    else run = 0;
  }
  return best;
}
