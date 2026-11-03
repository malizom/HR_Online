/** Design doc 04 §8 worked examples E1–E14 — exactly these numbers. Pure engine, no database. */
import { describe, expect, it } from "vitest";
import { saPublicHolidays } from "@/db/seed/holidays";
import {
  accrualTo, addDays, balance, carriedRemaining, cycleEnd, cycleFor, daysWorked, longDate, longestRun, parentalPeriod,
  remainingAccrual, resolvePolicy, validate, weekday, workingDays, type PolicyVersion, type ValidationContext,
} from "@/modules/leave/engine";

const holidays = [2025, 2026, 2027, 2028].flatMap(saPublicHolidays);

const ANNUAL: PolicyVersion = {
  category: "annual", entitlement: 15, cycleKind: "annual", cycleAnchor: "start_date", accrualMethod: "monthly",
  carryOverCap: 5, carryOverExpiryMonths: 6, allowNegativeDays: 0, minNoticeDays: 5, maxAdvanceDays: 365,
};
const SICK: PolicyVersion = {
  category: "sick", entitlement: 30, cycleKind: "three_year", cycleAnchor: "start_date", accrualMethod: "upfront",
  firstMonthsRule: { months: 6, perDaysWorked: 26 }, certificateAfterDays: 2, certificateOccasionsRule: { occasions: 2, weeks: 8 },
};
const FAMILY: PolicyVersion = {
  category: "family_responsibility", entitlement: 3, cycleKind: "annual", cycleAnchor: "start_date", accrualMethod: "upfront",
  minServiceMonths: 4, minDaysPerWeek: 4,
};

const baseCtx = (over: Partial<ValidationContext>): ValidationContext => ({
  category: "annual", label: "Annual", isPaid: true, policy: ANNUAL, person: { startDate: "2024-02-01" }, onboardingComplete: true,
  today: "2027-01-04", total: 1, consecutiveDays: 1, overlapsOwn: false, noticeWorkingDays: 20, available: 10, ...over,
});

describe("working days (doc 04 §3)", () => {
  it("E1 — holiday inside a request: Mon 14 – Thu 24 Dec 2026 = 8", () => {
    const r = workingDays({ start: "2026-12-14", end: "2026-12-24", holidays });
    expect(r.total).toBe(8);
    expect(r.days.find(d => d.date === "2026-12-16")).toMatchObject({ fraction: 0, excluded: "public_holiday", label: "Day of Reconciliation" });
    expect(r.days.filter(d => d.excluded === "weekend").map(d => d.date)).toEqual(["2026-12-19", "2026-12-20"]);
  });

  it("E2 — Sunday holiday moves to Monday, Saturday does not: Mon 20 – Fri 31 Dec 2027 = 9", () => {
    expect(weekday("2027-12-25")).toBe(6);
    expect(weekday("2027-12-26")).toBe(7);
    const r = workingDays({ start: "2027-12-20", end: "2027-12-31", holidays });
    expect(r.total).toBe(9);
    expect(r.days.find(d => d.date === "2027-12-27")?.excluded).toBe("public_holiday");
  });

  it("E3 — half days: Mon 1 Mar 2027 pm – Wed 3 Mar 2027 am = 2.0", () => {
    expect(workingDays({ start: "2027-03-01", end: "2027-03-03", startHalf: "pm", endHalf: "am", holidays }).total).toBe(2);
  });

  it("E3b — a single half day is 0.5; pm-to-am on one day is invalid", () => {
    expect(workingDays({ start: "2027-03-02", end: "2027-03-02", startHalf: "pm", holidays }).total).toBe(0.5);
    expect(() => workingDays({ start: "2027-03-02", end: "2027-03-02", startHalf: "pm", endHalf: "am", holidays })).toThrow();
  });

  it("E4 — four-day pattern: Mon 8 – Fri 12 Mar 2027 = 4", () => {
    const r = workingDays({ start: "2027-03-08", end: "2027-03-12", pattern: [1, 2, 3, 4], holidays });
    expect(r.total).toBe(4);
    expect(r.days.at(-1)?.excluded).toBe("not_in_pattern");
  });

  it("E12 — December shutdown Thu 24 Dec 2026 – Fri 1 Jan 2027 deducts 5 days", () => {
    const r = workingDays({ start: "2026-12-24", end: "2027-01-01", holidays });
    expect(r.total).toBe(5);
    expect(r.days.filter(d => d.fraction > 0).map(d => d.date)).toEqual(["2026-12-24", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31"]);
  });

  it("closure days already deducted are not deducted again", () => {
    expect(workingDays({ start: "2026-12-28", end: "2026-12-31", holidays, closureDates: ["2026-12-28", "2026-12-29"] }).total).toBe(2);
  });
});

describe("accrual and balances (doc 04 §4–5)", () => {
  const person = { startDate: "2026-02-01" };

  it("E5 — monthly accrual: accrued 6.25, available 3.25, projected 12.0 by 31 Jan 2027", () => {
    const cycle = cycleFor(ANNUAL, person, "2026-07-15");
    expect(cycle).toEqual({ start: "2026-02-01", end: "2027-01-31" });
    const accrued = accrualTo(ANNUAL, person, cycle, "2026-07-15");
    expect(accrued).toBe(6.25);
    const b = balance([{ entryKind: "accrual", days: accrued }, { entryKind: "taken", days: -3 }]);
    expect(b.available).toBe(3.25);
    expect(b.available + remainingAccrual(ANNUAL, accrued)).toBe(12);
  });

  it("E6 — carry within cap, FIFO, then expiry proposal", () => {
    const r = cycleEnd(ANNUAL, 4.5, { start: "2026-02-01", end: "2027-01-31" });
    expect(r.carried).toBe(4.5);
    expect(r.forfeitureProposal).toBe(0);
    expect(r.carryExpires).toBe("2027-07-31");
    expect(r.entries.map(e => [e.entryKind, e.days])).toEqual([["carry_over_out", -4.5], ["carry_over_in", 4.5]]);
    const left = carriedRemaining(4.5, 3);
    expect(left).toBe(1.5); // proposed to HR for forfeiture on 31 Jul 2027
  });

  it("E7 — carry above cap: 5.0 carried, 2.0 proposed (not removed)", () => {
    const r = cycleEnd(ANNUAL, 7, { start: "2026-02-01", end: "2027-01-31" });
    expect(r.carried).toBe(5);
    expect(r.forfeitureProposal).toBe(2);
    expect(r.entries.some(e => e.entryKind === "forfeiture")).toBe(false);
  });

  it("E8 — sick leave in the first six months: worked 59, accrued 2, available 0", () => {
    const p = { startDate: "2026-02-02" };
    const worked = daysWorked("2026-02-02", "2026-04-30", null, holidays, 2);
    expect(worked).toBe(59);
    const cycle = cycleFor(SICK, p, "2026-04-30");
    expect(cycle.end).toBe("2029-02-01");
    const accrued = accrualTo(SICK, p, cycle, "2026-04-30", worked);
    expect(accrued).toBe(2);
    const b = balance([{ entryKind: "accrual", days: accrued }, { entryKind: "taken", days: -2 }]);
    expect(b.available).toBe(0);
    const third = validate({ start: "2026-05-04", end: "2026-05-04" }, baseCtx({ category: "sick", label: "Sick", policy: SICK, person: p, available: 0, total: 1 }));
    expect(third.ok).toBe(false);
    expect(third.code).toBe("V8");
    expect(third.error).toMatch(/as unpaid/);
  });

  it("sick leave after six months: full 30 for the 36-month cycle", () => {
    expect(accrualTo(SICK, { startDate: "2026-02-02" }, { start: "2026-02-02", end: "2029-02-01" }, "2026-09-01")).toBe(30);
  });

  it("E9 — sick Mon–Wed (3 consecutive days) needs a certificate", () => {
    const wd = workingDays({ start: "2027-03-08", end: "2027-03-10", holidays });
    const r = validate({ start: "2027-03-08", end: "2027-03-10" }, baseCtx({ category: "sick", label: "Sick", policy: SICK, total: wd.total, consecutiveDays: longestRun(wd.days), available: 30, noticeWorkingDays: 0 }));
    expect(r.ok).toBe(true);
    expect(r.certificateRequired).toBe(true);
  });

  it("sick: 2 days alone needs no certificate, but a third occasion in 8 weeks does", () => {
    const c = baseCtx({ category: "sick", label: "Sick", policy: SICK, total: 2, consecutiveDays: 2, available: 30 });
    expect(validate({ start: "2027-03-08", end: "2027-03-09" }, c).certificateRequired).toBe(false);
    expect(validate({ start: "2027-03-08", end: "2027-03-09" }, { ...c, priorSickOccasions: 2 }).certificateRequired).toBe(true);
  });

  it("E10 — family responsibility: Mon–Wed worker is not eligible, even after 2 Jun 2026", () => {
    const person = { startDate: "2026-02-02", pattern: [1, 2, 3] };
    const r = validate({ start: "2026-07-06", end: "2026-07-06" }, baseCtx({ category: "family_responsibility", label: "Family responsibility", policy: FAMILY, person, available: 3 }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe("V7");
    expect(r.error).toMatch(/at least 4 days a week/);
    // A full-time colleague with the same start date is eligible after more than 4 months, and needs no notice.
    const ok = validate({ start: "2026-06-03", end: "2026-06-03" }, baseCtx({ category: "family_responsibility", label: "Family responsibility", policy: FAMILY, person: { startDate: "2026-02-02" }, available: 3, noticeWorkingDays: 0 }));
    expect(ok.ok).toBe(true);
    const early = validate({ start: "2026-06-02", end: "2026-06-02" }, baseCtx({ category: "family_responsibility", label: "Family responsibility", policy: FAMILY, person: { startDate: "2026-02-02" }, available: 3 }));
    expect(early.ok).toBe(false);
  });

  it("E11 — parental, only employed parent: 4 months ends Thu 2 Sep 2027; 4 months 10 days ends Sun 12 Sep (133 days)", () => {
    const a = parentalPeriod("2027-05-03", 4);
    expect(longDate(a.end)).toBe("Thu 2 Sep 2027");
    const b = parentalPeriod("2027-05-03", 4, 10);
    expect(longDate(b.end)).toBe("Sun 12 Sep 2027");
    expect(b.calendarDays).toBe(133);
  });

  it("E13 — over balance is refused with the exact message", () => {
    const r = validate({ start: "2027-03-08", end: "2027-03-10" }, baseCtx({ available: 2, total: 3 }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("You have 2.0 days available; this request needs 3.0. You can request 1.0 day as unpaid.");
    expect(r.shortfall).toBe(1);
  });

  it("E14 — cancelling approved leave writes a reversal; balance restored", () => {
    const before = balance([{ entryKind: "accrual", days: 15 }]);
    const after = balance([{ entryKind: "accrual", days: 15 }, { entryKind: "taken", days: -5 }, { entryKind: "reversal", days: 5 }]);
    expect(after.available).toBe(before.available);
    expect(after.taken).toBe(0);
  });
});

describe("validation order and policy resolution", () => {
  it("V1 onboarding, V3 zero days, V4 overlap, V5 notice (waived for sick)", () => {
    expect(validate({ start: "2027-03-08", end: "2027-03-08" }, baseCtx({ onboardingComplete: false })).code).toBe("V1");
    expect(validate({ start: "2027-03-06", end: "2027-03-07" }, baseCtx({ total: 0 })).code).toBe("V3");
    expect(validate({ start: "2027-03-08", end: "2027-03-08" }, baseCtx({ overlapsOwn: true })).code).toBe("V4");
    expect(validate({ start: "2027-03-08", end: "2027-03-08" }, baseCtx({ noticeWorkingDays: 2 })).code).toBe("V5");
    expect(validate({ start: "2027-03-08", end: "2027-03-08" }, baseCtx({ noticeWorkingDays: 2, raisedOnBehalf: true })).ok).toBe(true);
    expect(validate({ start: "2027-03-08", end: "2027-03-08" }, baseCtx({ category: "sick", label: "Sick", policy: SICK, noticeWorkingDays: 0, available: 30 })).ok).toBe(true);
  });

  it("team clash produces a warning, not a refusal", () => {
    const r = validate({ start: "2027-03-08", end: "2027-03-08" }, baseCtx({ clashCount: 2 }));
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/2 other people/);
  });

  it("most specific assignment wins", () => {
    const base = { ...ANNUAL, leaveTypeId: "t", effectiveFrom: "2026-01-01" };
    const policies = [{ ...base, id: "all" }, { ...base, id: "ca", entitlement: 18 }];
    const assignments = [
      { policyId: "all", appliesTo: "all" as const, priority: 0 },
      { policyId: "ca", appliesTo: "employment_type" as const, appliesValue: "candidate_attorney", priority: 0 },
    ];
    expect(resolvePolicy(policies, assignments, { startDate: null, employmentType: "permanent" }, "t", "2027-01-01")?.id).toBe("all");
    expect(resolvePolicy(policies, assignments, { startDate: null, employmentType: "candidate_attorney" }, "t", "2027-01-01")?.id).toBe("ca");
  });

  it("cycles: anniversary, calendar year, second anniversary cycle", () => {
    expect(cycleFor(ANNUAL, { startDate: "2024-02-01" }, "2026-11-03")).toEqual({ start: "2026-02-01", end: "2027-01-31" });
    expect(cycleFor({ ...ANNUAL, cycleAnchor: "calendar_year" }, { startDate: "2024-02-01" }, "2026-11-03")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    // The last day of a cycle belongs to that cycle; the anniversary starts the next one.
    expect(cycleFor(ANNUAL, { startDate: "2024-02-01" }, "2027-01-31")).toEqual({ start: "2026-02-01", end: "2027-01-31" });
    expect(cycleFor(ANNUAL, { startDate: "2024-02-01" }, "2027-02-01")).toEqual({ start: "2027-02-01", end: "2028-01-31" });
  });
});
