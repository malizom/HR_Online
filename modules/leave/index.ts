/**
 * Leave commands and queries (design doc 04 §9, doc 05 §1–2). These load inputs, call the pure engine
 * in ./engine, and write the append-only ledger. No arithmetic about days or balances lives here.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, withFirm, type Tx } from "@/lib/db";
import { UserError } from "@/lib/storage";
import type { Person } from "@/db/schema";
import { audit } from "../audit";
import { enqueue, cancelQueued } from "../notifications";
import { allowedActions, getInstance, startWorkflow, transition } from "../workflow/engine";
import { resolveApprover, directReportIds } from "../workflow/routing";
import { displayName } from "../people";
import type { Ctx } from "../identity/actor";
import {
  EngineError, accrualTo, carriedRemaining, cycleEnd as engineCycleEnd, addDays, addMonths, balance, cycleFor, daysWorked, diffDays, longDate, longestRun, parentalPeriod,
  remainingAccrual, resolvePolicy, round2, validate, weekday, workingDays,
  type AssignmentRow, type Balance, type Category, type ISODate, type PersonFacts, type PolicyRow, type ValidationResult,
} from "./engine";

export const PENDING = ["awaiting_cover", "cover_declined", "pending_approval"];
export const ACTIVE = [...PENDING, "approved", "completed"];
const NO_BALANCE: Category[] = ["parental", "maternity", "adoption", "unpaid", "special"];

export const todayIn = (tz = "Africa/Johannesburg") =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// ------------------------------------------------------------------ inputs

const facts = (p: Person): PersonFacts => ({
  id: p.id, startDate: p.startDate, pattern: p.workPattern, employmentType: p.employmentType, departmentId: p.departmentId,
});

export async function loadPolicies(tx: Tx): Promise<{ policies: PolicyRow[]; assignments: AssignmentRow[] }> {
  const [ps, as] = await Promise.all([
    tx.select({ p: schema.leavePolicies, category: schema.leaveTypes.category }).from(schema.leavePolicies)
      .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, schema.leavePolicies.leaveTypeId)),
    tx.select().from(schema.policyAssignments),
  ]);
  return {
    policies: ps.map(({ p, category }) => ({
      ...p, category, firstMonthsRule: p.firstMonthsRule as PolicyRow["firstMonthsRule"],
      certificateOccasionsRule: p.certificateOccasionsRule as PolicyRow["certificateOccasionsRule"],
    })),
    assignments: as.map(a => ({ policyId: a.policyId, appliesTo: a.appliesTo, appliesValue: a.appliesValue, priority: a.priority })),
  };
}

export async function holidaysBetween(tx: Tx, from: ISODate, to: ISODate) {
  return tx.select({ observedDate: schema.publicHolidays.observedDate, name: schema.publicHolidays.name }).from(schema.publicHolidays)
    .where(and(gte(schema.publicHolidays.observedDate, from), lte(schema.publicHolidays.observedDate, to)));
}

async function closureDates(tx: Tx, personId: string, leaveTypeId: string, from: ISODate, to: ISODate) {
  const rows = await tx.select().from(schema.firmClosures).where(and(
    eq(schema.firmClosures.leaveTypeId, leaveTypeId), sql`${schema.firmClosures.appliedAt} is not null`,
    lte(schema.firmClosures.startDate, to), gte(schema.firmClosures.endDate, from)));
  const out: ISODate[] = [];
  for (const c of rows) if (!c.excludesPeople.includes(personId)) for (let d = c.startDate; d <= c.endDate; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Approved leave days of any type in a range — "days worked" excludes them (doc 04 §5). */
async function leaveDaysTaken(tx: Tx, personId: string, from: ISODate, to: ISODate) {
  const r = await tx.execute(sql`
    select coalesce(sum(d.fraction), 0)::float as n from leave_request_days d
    join leave_requests r on r.id = d.request_id join workflow_instances w on w.id = r.workflow_instance_id
    where r.person_id = ${personId} and w.state in ('approved','completed') and d.date between ${from} and ${to}`);
  return Number((r.rows[0] as { n: number }).n);
}

async function ledgerRows(tx: Tx, personId: string, leaveTypeId: string, cycleStart: ISODate) {
  return tx.select().from(schema.leaveLedger).where(and(
    eq(schema.leaveLedger.personId, personId), eq(schema.leaveLedger.leaveTypeId, leaveTypeId), eq(schema.leaveLedger.cycleStart, cycleStart)))
    .orderBy(asc(schema.leaveLedger.effectiveDate), asc(schema.leaveLedger.createdAt));
}

async function reservedDays(tx: Tx, personId: string, leaveTypeId: string, cycle: { start: ISODate; end: ISODate }, excludeId?: string) {
  const r = await tx.execute(sql`
    select coalesce(sum(r.working_days), 0)::float as n from leave_requests r join workflow_instances w on w.id = r.workflow_instance_id
    where r.person_id = ${personId} and r.leave_type_id = ${leaveTypeId} and w.state in ('awaiting_cover','cover_declined','pending_approval')
      and r.start_date between ${cycle.start} and ${cycle.end} ${excludeId ? sql`and r.id <> ${excludeId}` : sql``}`);
  return Number((r.rows[0] as { n: number }).n);
}

/** What the person has earned by `onDate` under this policy (for jobs and live balances). */
async function targetAccrual(tx: Tx, person: Person, policy: PolicyRow, cycle: { start: ISODate; end: ISODate }, onDate: ISODate) {
  const f = facts(person);
  let worked = 0;
  if (policy.firstMonthsRule || policy.accrualMethod === "per_days_worked") {
    const from = person.startDate && person.startDate > cycle.start ? person.startDate : cycle.start;
    const hol = await holidaysBetween(tx, from, onDate);
    worked = daysWorked(from, onDate, person.workPattern, hol, await leaveDaysTaken(tx, person.id, from, onDate));
  }
  return accrualTo(policy, f, cycle, onDate, worked);
}

export interface BalanceView extends Balance { cycle: { start: ISODate; end: ISODate }; projected: number; pendingAccrual: number }

/**
 * Balance for the cycle containing `onDate`, as known `today`. Accrual the nightly job has not written yet is
 * included (as pendingAccrual) so the preview and the request never disagree with the next morning's figure.
 */
export async function balanceFor(tx: Tx, person: Person, policy: PolicyRow, onDate: ISODate, today: ISODate, excludeRequestId?: string): Promise<BalanceView> {
  const f = facts(person);
  const current = cycleFor(policy, f, today);
  const cycle = cycleFor(policy, f, onDate);
  if (cycle.start > current.end) {
    // A request in a future cycle: what will carry over plus what is granted up front there.
    const now = await balanceFor(tx, person, policy, today, today, excludeRequestId);
    const carry = Math.min(Math.max(now.projected, 0), policy.carryOverCap ?? 0);
    const upfront = policy.accrualMethod === "upfront" ? policy.entitlement : 0;
    const ledger = await ledgerRows(tx, person.id, policy.leaveTypeId, cycle.start);
    const b = balance(ledger.map(l => ({ entryKind: l.entryKind, days: l.days })), await reservedDays(tx, person.id, policy.leaveTypeId, cycle, excludeRequestId));
    const available = round2(carry + upfront + b.available);
    return { ...b, available, cycle, projected: round2(available + remainingAccrual(policy, upfront)), pendingAccrual: 0 };
  }
  const ledger = await ledgerRows(tx, person.id, policy.leaveTypeId, cycle.start);
  const b = balance(ledger.map(l => ({ entryKind: l.entryKind, days: l.days })), await reservedDays(tx, person.id, policy.leaveTypeId, cycle, excludeRequestId));
  let pendingAccrual = 0;
  if (cycle.start === current.start) pendingAccrual = round2(Math.max(0, (await targetAccrual(tx, person, policy, cycle, today)) - b.accrued));
  const available = round2(b.available + pendingAccrual);
  return { ...b, accrued: round2(b.accrued + pendingAccrual), available, cycle, projected: round2(available + remainingAccrual(policy, b.accrued + pendingAccrual)), pendingAccrual };
}

// ------------------------------------------------------------------ preview (doc 06 S6 live preview)

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const Half = z.enum(["am", "pm"]).nullish();
const CoverItem = z.object({
  matterRef: z.string().trim().min(1).max(80), clientName: z.string().trim().max(120).optional(),
  itemType: z.enum(["court_date", "filing_deadline", "consultation", "other"]), due: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/),
  location: z.string().trim().max(160).optional(), notes: z.string().trim().max(500).optional(),
});
const RequestInput = z.object({
  type: z.string().min(1), start: z.string().regex(ISO), end: z.string().regex(ISO).optional(), startHalf: Half, endHalf: Half,
  months: z.coerce.number().int().min(0).max(6).optional(), extraDays: z.coerce.number().int().min(0).max(31).optional(),
  note: z.string().trim().max(500).optional(), reason: z.string().trim().max(500).optional(),
  coverPersonId: z.string().uuid().optional(), coverItems: z.array(CoverItem).max(20).optional(),
  personId: z.string().uuid().optional(),
});
type RequestInput = z.infer<typeof RequestInput>;

export interface Preview {
  type: { id: string; code: string; label: string; category: Category; isPaid: boolean };
  start: ISODate; end: ISODate; total: number; unit: "working days" | "calendar days";
  days: { date: ISODate; label: string; fraction: number; excluded?: string; reason?: string }[];
  balance: { before: number; after: number; projected: number; cycleEnd: ISODate } | null;
  validation: ValidationResult; coverRequired: boolean; clashCount: number; policyId: string | null; policyVersion: number | null;
}

async function compute(tx: Tx, ctx: Ctx, person: Person, input: RequestInput, excludeRequestId?: string): Promise<Preview> {
  const [type] = await tx.select().from(schema.leaveTypes)
    .where(and(eq(schema.leaveTypes.isActive, true), or(eq(schema.leaveTypes.code, input.type), eq(schema.leaveTypes.label, input.type))));
  if (!type) throw new UserError("Choose a leave type.");
  const today = todayIn(ctx.firm.timezone);
  const { policies, assignments } = await loadPolicies(tx);
  const policy = NO_BALANCE.includes(type.category) ? null : resolvePolicy(policies, assignments, facts(person), type.id, input.start);
  const t = { id: type.id, code: type.code, label: type.label, category: type.category as Category, isPaid: type.isPaid };

  // Parental leave is a calendar period per event (doc 04 §6), not a working-day balance.
  let start = input.start, end = input.end ?? input.start, total = 0, unit: Preview["unit"] = "working days";
  let days: Preview["days"] = [];
  let consecutive = 0;
  if (type.category === "parental") {
    const months = input.months ?? 4, extra = input.extraDays ?? 0;
    if (input.months != null || !input.end) end = parentalPeriod(start, months, extra).end;
    total = diffDays(start, end) + 1; unit = "calendar days";
  } else {
    try {
      const wd = workingDays({
        start, end, startHalf: type.allowsHalfDay ? input.startHalf : null, endHalf: type.allowsHalfDay ? input.endHalf : null,
        pattern: person.workPattern, holidays: await holidaysBetween(tx, start, end),
        closureDates: await closureDates(tx, person.id, type.id, start, end), countsPublicHolidays: policy?.countsPublicHolidays,
      });
      total = wd.total; consecutive = longestRun(wd.days);
      const REASON = { weekend: "Weekend", not_in_pattern: "Not a working day for you", public_holiday: "Public holiday", closure: "Already deducted (firm closure)" };
      days = wd.days.map(d => ({ date: d.date, label: longDate(d.date), fraction: d.fraction, excluded: d.excluded, reason: d.excluded ? (d.label ?? REASON[d.excluded]) : undefined }));
    } catch (e) {
      if (e instanceof EngineError) throw new UserError(e.message);
      throw e;
    }
  }

  const active = (q: ReturnType<typeof and>) => tx.select({ id: schema.leaveRequests.id, personId: schema.leaveRequests.personId, start: schema.leaveRequests.startDate })
    .from(schema.leaveRequests).innerJoin(schema.workflowInstances, eq(schema.workflowInstances.id, schema.leaveRequests.workflowInstanceId))
    .where(and(inArray(schema.workflowInstances.state, ACTIVE), q, excludeRequestId ? ne(schema.leaveRequests.id, excludeRequestId) : undefined));
  const overlap = await active(and(eq(schema.leaveRequests.personId, person.id), lte(schema.leaveRequests.startDate, end), gte(schema.leaveRequests.endDate, start)));

  let clashCount = 0;
  if (person.departmentId) {
    const r = await tx.execute(sql`
      select count(distinct r.person_id)::int as n from leave_requests r join workflow_instances w on w.id = r.workflow_instance_id
      join people p on p.id = r.person_id
      where p.department_id = ${person.departmentId} and r.person_id <> ${person.id} and w.state in ('pending_approval','approved','awaiting_cover')
        and r.start_date <= ${end} and r.end_date >= ${start}`);
    clashCount = (r.rows[0] as { n: number }).n;
  }

  let priorSickOccasions = 0;
  if (type.category === "sick" && policy?.certificateOccasionsRule) {
    const since = addDays(start, -7 * policy.certificateOccasionsRule.weeks);
    const prior = await active(and(eq(schema.leaveRequests.personId, person.id), eq(schema.leaveRequests.leaveTypeId, type.id),
      gte(schema.leaveRequests.startDate, since), sql`${schema.leaveRequests.startDate} < ${start}`));
    priorSickOccasions = prior.length;
  }

  const noticeFrom = addDays(today, 1), noticeTo = addDays(start, -1);
  const noticeWorkingDays = noticeTo < noticeFrom ? 0 : workingDays({ start: noticeFrom, end: noticeTo, pattern: person.workPattern, holidays: await holidaysBetween(tx, noticeFrom, noticeTo) }).total;

  const bal = policy ? await balanceFor(tx, person, policy, start, today, excludeRequestId) : null;
  const coverRequired = type.requiresCover && person.isFeeEarner;
  const validation = validate({ start, end }, {
    category: t.category, label: type.label, isPaid: type.isPaid, policy, person: facts(person),
    onboardingComplete: person.onboardingStatus === "complete", today, total, consecutiveDays: consecutive,
    overlapsOwn: overlap.length > 0, noticeWorkingDays, available: bal?.available ?? null,
    priorSickOccasions, clashCount, requiresCover: coverRequired, raisedOnBehalf: person.id !== ctx.person.id,
  });
  return {
    type: t, start, end, total, unit, days,
    balance: bal ? { before: bal.available, after: round2(bal.available - total), projected: round2(bal.projected - total), cycleEnd: bal.cycle.end } : null,
    validation, coverRequired, clashCount, policyId: policy?.id ?? null, policyVersion: policy?.version ?? null,
  };
}

async function subjectPerson(tx: Tx, ctx: Ctx, personId?: string) {
  if (!personId || personId === ctx.person.id) return ctx.person;
  if (ctx.person.role !== "admin") throw new UserError("Only HR can raise leave on someone's behalf.", 403);
  const [p] = await tx.select().from(schema.people).where(eq(schema.people.id, personId));
  if (!p) throw new UserError("Person not found.", 404);
  return p;
}

export async function previewLeave(ctx: Ctx, raw: unknown) {
  const r = RequestInput.safeParse(raw);
  if (!r.success) throw new UserError("Choose a leave type and valid dates.");
  return withFirm(ctx.firm.id, async tx => compute(tx, ctx, await subjectPerson(tx, ctx, r.data.personId), r.data));
}

// ------------------------------------------------------------------ request

async function nextRequestNo(tx: Tx, year: number) {
  const r = await tx.execute(sql`select coalesce(max(substring(request_no from 9)::int), 0) + 1 as n from leave_requests where request_no like ${`LR-${year}-%`}`);
  return `LR-${year}-${String((r.rows[0] as { n: number }).n).padStart(4, "0")}`;
}

/** 08:00 SAST, two working days before the leave starts (doc 05 §8 handover.due). */
async function handoverAt(tx: Tx, start: ISODate) {
  const hol = new Set((await holidaysBetween(tx, addDays(start, -14), start)).map(h => h.observedDate));
  let d = start, n = 0;
  while (n < 2) { d = addDays(d, -1); if (weekday(d) <= 5 && !hol.has(d)) n++; }
  return new Date(`${d}T06:00:00Z`);
}

/** 08:00 SAST N working days after `from`. */
async function workingDaysAfter(tx: Tx, from: ISODate, n: number) {
  const hol = new Set((await holidaysBetween(tx, from, addDays(from, n * 3 + 14))).map(h => h.observedDate));
  let d = from, k = 0;
  while (k < n) { d = addDays(d, 1); if (weekday(d) <= 5 && !hol.has(d)) k++; }
  return new Date(`${d}T06:00:00Z`);
}

/** Pending for 3 working days → reminder to the approver; 5 → HR admins told. Never auto-approved (doc 05 §1). */
async function scheduleEscalation(tx: Tx, ctx: Ctx, requestId: string, approverId: string, payload: Record<string, unknown>) {
  const today = todayIn(ctx.firm.timezone);
  const [approver] = await tx.select().from(schema.people).where(eq(schema.people.id, approverId));
  await enqueue(tx, { firmId: ctx.firm.id, recipientId: approverId, templateKey: "leave.reminder", payload, dedupeKey: `leave:${requestId}:remind:3`, sendAfter: await workingDaysAfter(tx, today, 3) });
  const admins = await tx.select().from(schema.people).where(and(eq(schema.people.role, "admin"), eq(schema.people.status, "active"), isNull(schema.people.deactivatedAt)));
  for (const a of admins) if (a.id !== approverId) await enqueue(tx, { firmId: ctx.firm.id, recipientId: a.id, templateKey: "leave.escalated",
    payload: { ...payload, approver: approver ? displayName(approver) : "the approver" }, dedupeKey: `leave:${requestId}:remind:5:${a.id}`, sendAfter: await workingDaysAfter(tx, today, 5) });
}

export async function requestLeave(ctx: Ctx, raw: unknown, portalUrl: string) {
  if (ctx.person.role === "viewer") throw new UserError("Calendar viewers cannot make changes.", 403);
  const r = RequestInput.safeParse(raw);
  if (!r.success) throw new UserError("Choose a leave type and valid dates.");
  const input = r.data;

  return withFirm(ctx.firm.id, async tx => {
    const person = await subjectPerson(tx, ctx, input.personId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`leave:${person.id}`}))`); // one request at a time per person (V4/V8 races)
    const p = await compute(tx, ctx, person, input);
    if (!p.validation.ok) throw new UserError(p.validation.error!);

    let coverPerson: Person | undefined;
    if (p.coverRequired) {
      if (!input.coverPersonId) throw new UserError("Choose a colleague to cover your matters while you are away.");
      if (input.coverPersonId === person.id) throw new UserError("You cannot cover your own matters.");
      [coverPerson] = await tx.select().from(schema.people).where(and(eq(schema.people.id, input.coverPersonId), eq(schema.people.status, "active"), isNull(schema.people.deactivatedAt)));
      if (!coverPerson) throw new UserError("That colleague is not available to cover.");
    }
    const route = await resolveApprover(tx, "leave", person.id, p.start);
    if (!route) throw new UserError("No approver could be found. Ask HR to set the manager in the organogram.");

    const [req] = await tx.insert(schema.leaveRequests).values({
      firmId: ctx.firm.id, personId: person.id, leaveTypeId: p.type.id, requestNo: await nextRequestNo(tx, Number(p.start.slice(0, 4))),
      startDate: p.start, endDate: p.end, startHalf: input.startHalf ?? null, endHalf: input.endHalf ?? null, workingDays: p.total,
      note: input.note || null, reasonPrivate: input.reason || null, raisedById: ctx.person.id, policyId: p.policyId, policyVersion: p.policyVersion,
      balanceBefore: p.balance?.before ?? null, balanceAfter: p.balance?.after ?? null, clashCount: p.clashCount,
      validation: { warnings: p.validation.warnings, certificateRequired: p.validation.certificateRequired }, createdBy: ctx.person.id,
    }).returning();
    if (p.days.length) await tx.insert(schema.leaveRequestDays).values(p.days.map(d => ({ requestId: req.id, firmId: ctx.firm.id, date: d.date, fraction: d.fraction, excludedReason: (d.excluded ?? null) as any })));

    const inst = await startWorkflow(tx, ctx.actor, "leave_request", "leave_request", req.id, {
      assigneeId: coverPerson ? coverPerson.id : route.approverId, initial: coverPerson ? "awaiting_cover" : "pending_approval",
      context: { via: route.via, onBehalfOfId: route.onBehalfOfId, approverId: route.approverId },
    });
    let coverageId: string | null = null;
    if (coverPerson) {
      const [cov] = await tx.insert(schema.coverageRequests).values({
        firmId: ctx.firm.id, leaveRequestId: req.id, requesterId: person.id, coveringPersonId: coverPerson.id,
        handoverDueAt: await handoverAt(tx, p.start), createdBy: ctx.person.id,
      }).returning();
      coverageId = cov.id;
      for (const it of input.coverItems ?? []) {
        if (it.due.slice(0, 10) < p.start || it.due.slice(0, 10) > p.end) continue; // only items inside the leave window (doc 05 §2)
        await tx.insert(schema.coverageItems).values({ firmId: ctx.firm.id, coverageRequestId: cov.id, matterRef: it.matterRef, clientName: it.clientName ?? null,
          itemType: it.itemType, dueAt: new Date(it.due.length === 10 ? `${it.due}T07:00:00Z` : `${it.due}:00+02:00`), location: it.location ?? null, notes: it.notes ?? null, createdBy: ctx.person.id });
      }
    }
    await tx.update(schema.leaveRequests).set({ workflowInstanceId: inst.id, coverageRequestId: coverageId }).where(eq(schema.leaveRequests.id, req.id));
    await audit(tx, ctx.actor, "leave.request", "leave_request", req.id, { days: p.total, type: p.type.code, onBehalf: person.id !== ctx.person.id });

    const payload = { requester: displayName(person), type: p.type.label, start: longDate(p.start), end: longDate(p.end), days: p.total, link: portalUrl };
    if (coverPerson) await enqueue(tx, { firmId: ctx.firm.id, recipientId: coverPerson.id, templateKey: "cover.requested", payload, dedupeKey: `leave:${req.id}:cover:${coverPerson.id}` });
    else {
      await enqueue(tx, { firmId: ctx.firm.id, recipientId: route.approverId, templateKey: "leave.submitted", payload, dedupeKey: `leave:${req.id}:submitted` });
      await scheduleEscalation(tx, ctx, req.id, route.approverId, payload);
    }
    return { ...req, preview: p };
  });
}

// ------------------------------------------------------------------ decisions (doc 05 §1 transitions + effects)

const ACTION_BY_STATUS: Record<string, string> = { Approved: "approve", Declined: "decline", Cancelled: "cancel" };
const ACTIONS = ["approve", "decline", "cancel", "accept_cover", "decline_cover", "renominate"];

export async function decideLeave(ctx: Ctx, requestId: string, statusOrAction: string, comment?: string, opts: { coverPersonId?: string; waiveCertificate?: boolean; portalUrl?: string } = {}) {
  const action = ACTION_BY_STATUS[statusOrAction] ?? statusOrAction;
  if (!ACTIONS.includes(action)) throw new UserError("Unknown decision.");
  await withFirm(ctx.firm.id, async tx => {
    const [row] = await tx.select({ r: schema.leaveRequests, type: schema.leaveTypes }).from(schema.leaveRequests)
      .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, schema.leaveRequests.leaveTypeId)).where(eq(schema.leaveRequests.id, requestId));
    if (!row) throw new UserError("Leave request not found.", 404);
    const inst = await getInstance(tx, "leave_request", row.r.id);
    if (!inst) throw new UserError("Leave request not found.", 404);
    const [owner] = await tx.select().from(schema.people).where(eq(schema.people.id, row.r.personId));
    const [coverage] = row.r.coverageRequestId ? await tx.select().from(schema.coverageRequests).where(eq(schema.coverageRequests.id, row.r.coverageRequestId)) : [];
    const ictx = inst.context as { onBehalfOfId?: string | null; approverId?: string };
    const v = (row.r.validation ?? {}) as { certificateRequired?: boolean; certificateWaived?: boolean };

    let nextAssigneeId: string | null | undefined = undefined;
    let onBehalfOfId: string | null = null;
    if (action === "approve") {
      if (v.certificateRequired && !row.r.certificateDocumentId && !v.certificateWaived) {
        if (!(opts.waiveCertificate && ctx.person.role === "admin")) throw new UserError("A medical certificate is required before this sick leave can be approved.");
        await tx.update(schema.leaveRequests).set({ validation: { ...v, certificateWaived: true } }).where(eq(schema.leaveRequests.id, row.r.id));
      }
      onBehalfOfId = ctx.person.id === inst.assigneeId ? ictx.onBehalfOfId ?? null : null;
    }
    let approver: Awaited<ReturnType<typeof resolveApprover>> = null;
    if (action === "accept_cover") {
      approver = await resolveApprover(tx, "leave", row.r.personId, row.r.startDate);
      if (!approver) throw new UserError("No approver could be found for this request.");
      nextAssigneeId = approver.approverId;
    }
    if (action === "decline_cover") nextAssigneeId = row.r.personId;
    let newCover: Person | undefined;
    if (action === "renominate") {
      if (!opts.coverPersonId || opts.coverPersonId === row.r.personId) throw new UserError("Choose another colleague to cover.");
      [newCover] = await tx.select().from(schema.people).where(and(eq(schema.people.id, opts.coverPersonId), eq(schema.people.status, "active")));
      if (!newCover) throw new UserError("That colleague is not available to cover.");
      nextAssigneeId = newCover.id;
    }

    const prev = inst.state;
    const updated = await transition(tx, { instance: inst, action, actor: ctx.actor, actorRole: ctx.person.role, ownerId: row.r.personId,
      comment: comment ?? null, onBehalfOfId, nextAssigneeId });
    if (approver) await tx.update(schema.workflowInstances).set({ context: { ...ictx, approverId: approver.approverId, onBehalfOfId: approver.onBehalfOfId, via: approver.via } }).where(eq(schema.workflowInstances.id, inst.id));

    const ledgerTracked = !!row.r.policyId && row.r.workingDays != null;
    const cycleOf = async () => {
      const { policies } = await loadPolicies(tx);
      const pol = policies.find(x => x.id === row.r.policyId)!;
      return cycleFor(pol, facts(owner), row.r.startDate);
    };
    const today = todayIn(ctx.firm.timezone);
    const payload = { requester: displayName(owner), type: row.type.label, start: longDate(row.r.startDate), end: longDate(row.r.endDate),
      days: row.r.workingDays, by: displayName(ctx.person), comment, link: opts.portalUrl ?? "" };
    const notify = (recipientId: string | null | undefined, templateKey: string, key: string, sendAfter?: Date) =>
      recipientId && recipientId !== ctx.person.id ? enqueue(tx, { firmId: ctx.firm.id, recipientId, templateKey, payload, dedupeKey: `leave:${row.r.id}:${key}`, sendAfter }) : Promise.resolve();

    switch (action) {
      case "approve": {
        await cancelQueued(tx, `leave:${row.r.id}:remind`);
        if (ledgerTracked) {
          const c = await cycleOf();
          await tx.insert(schema.leaveLedger).values({ firmId: ctx.firm.id, personId: row.r.personId, leaveTypeId: row.r.leaveTypeId, cycleStart: c.start, cycleEnd: c.end,
            entryKind: "taken", days: -Number(row.r.workingDays), effectiveDate: row.r.startDate, sourceKind: "leave_request", sourceId: row.r.id,
            policyId: row.r.policyId, policyVersion: row.r.policyVersion, createdBy: ctx.person.id });
        }
        await notify(row.r.personId, "leave.approved", "approved");
        if (coverage) {
          await notify(coverage.coveringPersonId, "leave.approved.cover", "approved:cover");
          if (coverage.handoverDueAt && coverage.handoverDueAt > new Date()) await notify(row.r.personId, "handover.due", "handover", coverage.handoverDueAt);
        }
        break;
      }
      case "decline":
        await notify(row.r.personId, "leave.declined", "declined");
        await cancelQueued(tx, `leave:${row.r.id}:`);
        break;
      case "cancel": {
        if (prev === "approved" && ledgerTracked) {
          const c = await cycleOf();
          await tx.insert(schema.leaveLedger).values({ firmId: ctx.firm.id, personId: row.r.personId, leaveTypeId: row.r.leaveTypeId, cycleStart: c.start, cycleEnd: c.end,
            entryKind: "reversal", days: Number(row.r.workingDays), effectiveDate: today, sourceKind: "leave_request", sourceId: row.r.id,
            reason: "Cancelled", policyId: row.r.policyId, policyVersion: row.r.policyVersion, createdBy: ctx.person.id });
        }
        await cancelQueued(tx, `leave:${row.r.id}:`);
        if (prev === "pending_approval" || prev === "approved") await notify(ictx.approverId ?? inst.assigneeId, "leave.cancelled", "cancelled:approver");
        if (coverage) await notify(coverage.coveringPersonId, "leave.cancelled", "cancelled:cover");
        if (ctx.person.id !== row.r.personId) await notify(row.r.personId, "leave.cancelled", "cancelled:owner");
        break;
      }
      case "accept_cover":
        await notify(updated.assigneeId, "leave.submitted", "submitted");
        if (updated.assigneeId) await scheduleEscalation(tx, ctx, row.r.id, updated.assigneeId, payload);
        break;
      case "decline_cover":
        await notify(row.r.personId, "cover.declined", `cover-declined:${ctx.person.id}`);
        break;
      case "renominate":
        await tx.update(schema.coverageRequests).set({ coveringPersonId: newCover!.id, updatedAt: new Date() }).where(eq(schema.coverageRequests.id, coverage!.id));
        await notify(newCover!.id, "cover.requested", `cover:${newCover!.id}`);
        break;
    }
  });
}

/** Sick note for a request (BCEA s23). Only the requester attaches it; only HR can open it — the approver sees "received". */
export async function attachCertificate(ctx: Ctx, requestId: string, documentId: string) {
  await withFirm(ctx.firm.id, async tx => {
    const [r] = await tx.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.id, requestId));
    if (!r || r.personId !== ctx.person.id) throw new UserError("Leave request not found.", 404);
    await tx.update(schema.leaveRequests).set({ certificateDocumentId: documentId, updatedAt: new Date() }).where(eq(schema.leaveRequests.id, r.id));
    await audit(tx, ctx.actor, "leave.certificate", "leave_request", r.id);
  });
}

/** Requester confirms each item is handed over; the colleague then confirms receipt (doc 05 §2). */
export async function confirmHandover(ctx: Ctx, requestId: string) {
  await withFirm(ctx.firm.id, async tx => {
    const [cov] = await tx.select().from(schema.coverageRequests).where(eq(schema.coverageRequests.leaveRequestId, requestId));
    if (!cov) throw new UserError("No cover arrangement for this request.", 404);
    const now = new Date();
    if (ctx.person.id === cov.requesterId) {
      await tx.update(schema.coverageRequests).set({ handoverConfirmedAt: now, handoverConfirmedBy: ctx.person.id, updatedAt: now }).where(eq(schema.coverageRequests.id, cov.id));
      await tx.update(schema.coverageItems).set({ isHandedOver: true, handedOverAt: now, updatedAt: now }).where(eq(schema.coverageItems.coverageRequestId, cov.id));
      await cancelQueued(tx, `leave:${requestId}:handover`);
      await audit(tx, ctx.actor, "coverage.handover", "coverage_request", cov.id, {});
    } else if (ctx.person.id === cov.coveringPersonId) {
      if (!cov.handoverConfirmedAt) throw new UserError("The handover has not been confirmed yet.");
      await tx.update(schema.coverageRequests).set({ receivedConfirmedAt: now, updatedAt: now }).where(eq(schema.coverageRequests.id, cov.id));
      await audit(tx, ctx.actor, "coverage.received", "coverage_request", cov.id, {});
    } else throw new UserError("You are not part of this cover arrangement.", 403);
  });
}

// ------------------------------------------------------------------ queries

const STATUS_LABEL: Record<string, string> = {
  awaiting_cover: "Awaiting cover", cover_declined: "Cover declined", pending_approval: "Pending",
  approved: "Approved", declined: "Declined", cancelled: "Cancelled", completed: "Approved",
};

/** Requests visible to the actor: own; direct reports' (managers); everything (admin); plus any assigned to them. */
export async function listLeave(tx: Tx, ctx: Ctx) {
  const reports = await directReportIds(tx, ctx.person.id);
  const visibleIds = [ctx.person.id, ...reports];
  const isAdmin = ctx.person.role === "admin";
  const rows = await tx.select({ r: schema.leaveRequests, type: schema.leaveTypes, w: schema.workflowInstances,
      firstName: schema.people.firstName, lastName: schema.people.lastName, preferredName: schema.people.preferredName, cov: schema.coverageRequests })
    .from(schema.leaveRequests)
    .innerJoin(schema.people, eq(schema.people.id, schema.leaveRequests.personId))
    .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, schema.leaveRequests.leaveTypeId))
    .innerJoin(schema.workflowInstances, eq(schema.workflowInstances.id, schema.leaveRequests.workflowInstanceId))
    .leftJoin(schema.coverageRequests, eq(schema.coverageRequests.id, schema.leaveRequests.coverageRequestId))
    .where(isAdmin ? undefined : or(inArray(schema.leaveRequests.personId, visibleIds), eq(schema.workflowInstances.assigneeId, ctx.person.id), eq(schema.coverageRequests.coveringPersonId, ctx.person.id)))
    .orderBy(desc(schema.leaveRequests.startDate));
  const coverIds = [...new Set(rows.map(x => x.cov?.coveringPersonId).filter(Boolean))] as string[];
  const names = coverIds.length ? Object.fromEntries((await tx.select().from(schema.people).where(inArray(schema.people.id, coverIds))).map(p => [p.id, displayName(p)])) : {};
  const items = coverIds.length ? await tx.select().from(schema.coverageItems).where(inArray(schema.coverageItems.coverageRequestId, rows.map(x => x.cov?.id).filter(Boolean) as string[])) : [];
  return rows.map(x => {
    const own = x.r.personId === ctx.person.id;
    // Private reasons: requester and the deciding approver; HR-only types: requester and HR (doc 03).
    const canSeeReason = own || isAdmin || (x.type.reasonVisibleTo === "requester_approver" && (x.w.assigneeId === ctx.person.id || reports.includes(x.r.personId)));
    const v = (x.r.validation ?? {}) as { warnings?: string[]; certificateRequired?: boolean; certificateWaived?: boolean };
    const actions = allowedActions(x.w, ctx.person.id, ctx.person.role, x.r.personId);
    if (x.cov && x.w.state === "approved" && own && !x.cov.handoverConfirmedAt) actions.push("confirm_handover");
    if (x.cov && x.w.state === "approved" && x.cov.coveringPersonId === ctx.person.id && x.cov.handoverConfirmedAt && !x.cov.receivedConfirmedAt) actions.push("confirm_receipt");
    return {
      id: x.r.id, requestNo: x.r.requestNo, owner: x.r.personId, name: displayName(x), type: x.type.label, typeCode: x.type.code,
      start: x.r.startDate, end: x.r.endDate, startHalf: x.r.startHalf, endHalf: x.r.endHalf, days: x.r.workingDays,
      note: x.r.note ?? "", reason: canSeeReason ? x.r.reasonPrivate ?? "" : "",
      status: STATUS_LABEL[x.w.state] ?? x.w.state, state: x.w.state, actions,
      balanceAfter: own || isAdmin || x.w.assigneeId === ctx.person.id ? x.r.balanceAfter : null,
      clashCount: x.r.clashCount, warnings: v.warnings ?? [], certificateReceived: !!x.r.certificateDocumentId,
      certificateDocumentId: own || isAdmin ? x.r.certificateDocumentId : null, certificateRequired: !!v.certificateRequired && !x.r.certificateDocumentId && !v.certificateWaived,
      cover: x.cov ? {
        name: names[x.cov.coveringPersonId] ?? "", personId: x.cov.coveringPersonId, handoverConfirmed: !!x.cov.handoverConfirmedAt, received: !!x.cov.receivedConfirmedAt,
        items: items.filter(i => i.coverageRequestId === x.cov!.id).map(i => ({ matterRef: i.matterRef, itemType: i.itemType, due: i.dueAt.toISOString(), location: i.location ?? "" })),
      } : null,
    };
  });
}

/** Approved leave for the team calendar: names and dates only — reasons and types stay private. */
export async function calendar(tx: Tx, fromDate: string) {
  const rows = await tx.select({ id: schema.leaveRequests.id, start: schema.leaveRequests.startDate, end: schema.leaveRequests.endDate, personId: schema.leaveRequests.personId,
      firstName: schema.people.firstName, lastName: schema.people.lastName, preferredName: schema.people.preferredName, showsOnCalendar: schema.leaveTypes.showsOnCalendar })
    .from(schema.leaveRequests)
    .innerJoin(schema.people, eq(schema.people.id, schema.leaveRequests.personId))
    .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, schema.leaveRequests.leaveTypeId))
    .innerJoin(schema.workflowInstances, eq(schema.workflowInstances.id, schema.leaveRequests.workflowInstanceId))
    .where(and(inArray(schema.workflowInstances.state, ["approved", "completed"]), gte(schema.leaveRequests.endDate, fromDate)));
  return rows.filter(r => r.showsOnCalendar).map(x => ({ id: x.id, name: displayName(x), start: x.start, end: x.end }));
}

export async function listHolidays(tx: Tx, from: ISODate, to: ISODate) {
  return (await holidaysBetween(tx, from, to)).map(h => ({ date: h.observedDate, name: h.name }));
}

export async function listLeaveTypes(tx: Tx) {
  return tx.select({ id: schema.leaveTypes.id, code: schema.leaveTypes.code, label: schema.leaveTypes.label, category: schema.leaveTypes.category,
      allowsHalfDay: schema.leaveTypes.allowsHalfDay, requiresCover: schema.leaveTypes.requiresCover })
    .from(schema.leaveTypes).where(eq(schema.leaveTypes.isActive, true)).orderBy(schema.leaveTypes.sort);
}

/** Balance cards for one person (doc 06 S2): available now and by cycle end, per type with a policy. */
export async function balancesFor(tx: Tx, person: Person, today: ISODate) {
  const { policies, assignments } = await loadPolicies(tx);
  const types = await tx.select().from(schema.leaveTypes).where(eq(schema.leaveTypes.isActive, true)).orderBy(schema.leaveTypes.sort);
  const out = [];
  for (const t of types) {
    if (NO_BALANCE.includes(t.category)) continue;
    const pol = resolvePolicy(policies, assignments, facts(person), t.id, today);
    if (!pol) continue;
    const b = await balanceFor(tx, person, pol, today, today);
    const ledger = await ledgerRows(tx, person.id, t.id, b.cycle.start);
    const carriedExpires = b.carriedIn > 0 && pol.carryOverExpiryMonths ? addDays(addMonths(b.cycle.start, pol.carryOverExpiryMonths), -1) : null;
    out.push({
      code: t.code, label: t.label, cycleStart: b.cycle.start, cycleEnd: b.cycle.end, entitlement: pol.entitlement,
      available: b.available, projected: b.projected, taken: b.taken, reserved: b.reserved, accrued: b.accrued, carriedIn: b.carriedIn, carriedExpires,
      statement: [
        ...ledger.map(l => ({ date: l.effectiveDate, kind: l.entryKind, days: l.days, reason: l.reason ?? "" })),
        ...(b.pendingAccrual > 0 ? [{ date: today, kind: "accrual", days: b.pendingAccrual, reason: "Earned to date (posted tonight)" }] : []),
      ],
    });
  }
  return out;
}

// ------------------------------------------------------------------ jobs (doc 04 §5; ADR-13). Idempotent; `today` injected.

export async function accruePerson(tx: Tx, firmId: string, person: Person, today: ISODate) {
  if (!person.startDate || person.employmentStatus === "offboarded" || person.startDate > today) return 0;
  const { policies, assignments } = await loadPolicies(tx);
  const types = await tx.select().from(schema.leaveTypes).where(eq(schema.leaveTypes.isActive, true));
  let written = 0;
  for (const t of types) {
    if (NO_BALANCE.includes(t.category)) continue;
    const pol = resolvePolicy(policies, assignments, facts(person), t.id, today);
    if (!pol) continue;
    const cycle = cycleFor(pol, facts(person), today);
    const ledger = await ledgerRows(tx, person.id, t.id, cycle.start);
    const have = round2(ledger.filter(l => l.entryKind === "accrual").reduce((s, l) => s + Number(l.days), 0));
    const want = await targetAccrual(tx, person, pol, cycle, today);
    if (want > have) {
      await tx.insert(schema.leaveLedger).values({ firmId, personId: person.id, leaveTypeId: t.id, cycleStart: cycle.start, cycleEnd: cycle.end,
        entryKind: "accrual", days: round2(want - have), effectiveDate: today, sourceKind: "job", reason: "Accrual", policyId: pol.id, policyVersion: pol.version });
      written++;
    }
  }
  return written;
}

export async function accrueAll(firmId: string, today: ISODate) {
  return withFirm(firmId, async tx => {
    const people = await tx.select().from(schema.people).where(and(eq(schema.people.status, "active"), isNull(schema.people.deactivatedAt)));
    let entries = 0;
    for (const p of people) entries += await accruePerson(tx, firmId, p, today);
    return { people: people.length, entries };
  });
}

/** Carry-over at cycle end and expiry of carried days; excess becomes a proposal to HR, never an automatic forfeiture. */
export async function cycleEndAll(firmId: string, today: ISODate) {
  return withFirm(firmId, async tx => {
    const { policies, assignments } = await loadPolicies(tx);
    const people = await tx.select().from(schema.people).where(and(eq(schema.people.status, "active"), isNull(schema.people.deactivatedAt)));
    const admins = people.filter(p => p.role === "admin");
    const types = await tx.select().from(schema.leaveTypes);
    const stats = { carried: 0, proposals: 0, expiryProposals: 0 };
    for (const person of people) {
      if (!person.startDate) continue;
      for (const t of types) {
        const pol = resolvePolicy(policies, assignments, facts(person), t.id, today);
        if (!pol || pol.carryOverCap == null) continue;
        const current = cycleFor(pol, facts(person), today);
        const prevEnd = addDays(current.start, -1);
        if (prevEnd < person.startDate) continue;
        const prev = cycleFor(pol, facts(person), prevEnd);
        const prevLedger = await ledgerRows(tx, person.id, t.id, prev.start);
        if (!prevLedger.some(l => l.entryKind === "carry_over_out")) {
          const b = balance(prevLedger.map(l => ({ entryKind: l.entryKind, days: l.days })));
          const r = engineCycleEnd(pol, b.available, prev);
          for (const e of r.entries) {
            const c = e.cycle === "old" ? prev : current;
            await tx.insert(schema.leaveLedger).values({ firmId, personId: person.id, leaveTypeId: t.id, cycleStart: c.start, cycleEnd: c.end, entryKind: e.entryKind,
              days: e.days, effectiveDate: e.effectiveDate, sourceKind: "job", reason: e.expires ? `${e.reason}; expires ${e.expires}` : e.reason, policyId: pol.id, policyVersion: pol.version });
          }
          if (r.carried > 0) stats.carried++;
          if (r.forfeitureProposal > 0) for (const a of admins) {
            await enqueue(tx, { firmId, recipientId: a.id, templateKey: "balance.forfeit_proposal", dedupeKey: `forfeit:${person.id}:${t.id}:${prev.start}`,
              payload: { person: displayName(person), type: t.label, days: r.forfeitureProposal, cycleEnd: longDate(prev.end), why: "above the carry-over cap" } });
            stats.proposals++;
          }
        }
        if (pol.carryOverExpiryMonths) {
          const expires = addDays(addMonths(current.start, pol.carryOverExpiryMonths), -1);
          if (today > expires) {
            const cur = balance((await ledgerRows(tx, person.id, t.id, current.start)).map(l => ({ entryKind: l.entryKind, days: l.days })));
            const left = carriedRemaining(cur.carriedIn, cur.taken);
            if (left > 0) for (const a of admins) {
              await enqueue(tx, { firmId, recipientId: a.id, templateKey: "balance.forfeit_proposal", dedupeKey: `forfeit-expiry:${person.id}:${t.id}:${current.start}`,
                payload: { person: displayName(person), type: t.label, days: left, cycleEnd: longDate(expires), why: "carried days not used by the expiry date" } });
              stats.expiryProposals++;
            }
          }
        }
      }
    }
    return stats;
  });
}

/** Rebuild the leave_balances projection from the ledger (consistency check; doc 04 §4). */
export async function rebuildBalances(firmId: string, today: ISODate) {
  return withFirm(firmId, async tx => {
    const people = await tx.select().from(schema.people).where(eq(schema.people.status, "active"));
    let rows = 0;
    for (const person of people) {
      for (const b of await balancesFor(tx, person, today)) {
        const [t] = await tx.select().from(schema.leaveTypes).where(eq(schema.leaveTypes.code, b.code));
        const values = { available: b.available, accrued: b.accrued, taken: b.taken, reserved: b.reserved, carriedIn: b.carriedIn, projectedAtCycleEnd: b.projected, rebuiltAt: new Date() };
        await tx.insert(schema.leaveBalances).values({ firmId, personId: person.id, leaveTypeId: t.id, cycleStart: b.cycleStart, cycleEnd: b.cycleEnd, ...values })
          .onConflictDoUpdate({ target: [schema.leaveBalances.firmId, schema.leaveBalances.personId, schema.leaveBalances.leaveTypeId, schema.leaveBalances.cycleStart], set: values });
        rows++;
      }
    }
    return { rows };
  });
}
