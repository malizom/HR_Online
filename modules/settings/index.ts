/**
 * Firm settings (doc 06 S15, S17): branding, leave policies (versioned), holidays, closures, approval routes, delegation.
 * Changing an entitlement never requires code (doc 04 §2): a policy change is a new version row.
 */
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, withFirm, type Tx } from "@/lib/db";
import { UserError } from "@/lib/storage";
import { audit } from "../audit";
import { can } from "../permissions";
import type { Ctx } from "../identity/actor";
import { displayName } from "../people";
import { cycleFor, workingDays, addDays, type PolicyRow } from "../leave/engine";
import { holidaysBetween, loadPolicies, todayIn } from "../leave";
import { resolvePolicy } from "../leave/engine";

const who = (ctx: Ctx) => ({ id: ctx.person.id, role: ctx.person.role, isManager: ctx.isManager });
const requireAdmin = (ctx: Ctx) => { if (!can(who(ctx), "settings.manage")) throw new UserError("Only HR can change settings.", 403); };
const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function settingsView(tx: Tx) {
  const [settings] = await tx.select().from(schema.firmSettings);
  const policies = await tx.select({ p: schema.leavePolicies, type: schema.leaveTypes.label }).from(schema.leavePolicies)
    .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, schema.leavePolicies.leaveTypeId)).orderBy(asc(schema.leaveTypes.sort), desc(schema.leavePolicies.version));
  const year = new Date().getUTCFullYear();
  const holidays = await tx.select().from(schema.publicHolidays).where(gte(schema.publicHolidays.observedDate, `${year}-01-01`)).orderBy(asc(schema.publicHolidays.observedDate));
  const closures = await tx.select({ c: schema.firmClosures, type: schema.leaveTypes.label }).from(schema.firmClosures)
    .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, schema.firmClosures.leaveTypeId)).orderBy(desc(schema.firmClosures.startDate));
  const routes = await tx.select().from(schema.approvalRoutes).where(eq(schema.approvalRoutes.scope, "person"));
  return {
    branding: settings ? { brandName: settings.brandName, primaryColour: settings.primaryColour, accentColour: settings.accentColour } : null,
    policies: policies.map(({ p, type }) => ({
      id: p.id, type, name: p.name, version: p.version, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo, entitlement: p.entitlement,
      accrualMethod: p.accrualMethod, cycleKind: p.cycleKind, carryOverCap: p.carryOverCap, carryOverExpiryMonths: p.carryOverExpiryMonths,
      minNoticeDays: p.minNoticeDays, minServiceMonths: p.minServiceMonths, allowNegativeDays: p.allowNegativeDays,
    })),
    holidays: holidays.map(h => ({ id: h.id, date: h.date, observedDate: h.observedDate, name: h.name, source: h.source, firmOnly: !!h.firmId })),
    closures: closures.map(({ c, type }) => ({ id: c.id, name: c.name, start: c.startDate, end: c.endDate, type, applied: !!c.appliedAt, excludes: c.excludesPeople.length })),
    routes: routes.map(r => ({ id: r.id, personId: r.scopeValue, approverId: r.approverValue })),
  };
}

const Branding = z.object({ brandName: z.string().trim().min(2).max(80), primaryColour: z.string().regex(/^#[0-9a-fA-F]{6}$/), accentColour: z.string().regex(/^#[0-9a-fA-F]{6}$/) });
export async function updateBranding(ctx: Ctx, raw: unknown) {
  requireAdmin(ctx);
  const b = Branding.safeParse(raw);
  if (!b.success) throw new UserError("Enter a name and two colours like #29553d.");
  await withFirm(ctx.firm.id, async tx => {
    await tx.update(schema.firmSettings).set({ ...b.data, updatedAt: new Date() }).where(eq(schema.firmSettings.firmId, ctx.firm.id));
    await audit(tx, ctx.actor, "settings.branding", "firm", ctx.firm.id, b.data);
  });
}

const PolicyChange = z.object({
  policyId: z.string().uuid(), effectiveFrom: ISO, entitlement: z.coerce.number().min(0).max(366),
  carryOverCap: z.coerce.number().min(0).max(366).nullable().optional(), carryOverExpiryMonths: z.coerce.number().int().min(0).max(24).nullable().optional(),
  minNoticeDays: z.coerce.number().int().min(0).max(90).nullable().optional(), allowNegativeDays: z.coerce.number().min(0).max(30).optional(),
});
/** A policy change is a new version from a date; earlier requests keep the version they were made under. */
export async function changePolicy(ctx: Ctx, raw: unknown) {
  requireAdmin(ctx);
  const r = PolicyChange.safeParse(raw);
  if (!r.success) throw new UserError("Check the policy values.");
  return withFirm(ctx.firm.id, async tx => {
    const [old] = await tx.select().from(schema.leavePolicies).where(eq(schema.leavePolicies.id, r.data.policyId));
    if (!old) throw new UserError("Policy not found.", 404);
    if (r.data.effectiveFrom <= old.effectiveFrom) throw new UserError("The new version must start after the current version.");
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = old;
    const [next] = await tx.insert(schema.leavePolicies).values({
      ...rest, version: old.version + 1, effectiveFrom: r.data.effectiveFrom, effectiveTo: null, entitlement: r.data.entitlement,
      carryOverCap: r.data.carryOverCap === undefined ? old.carryOverCap : r.data.carryOverCap,
      carryOverExpiryMonths: r.data.carryOverExpiryMonths === undefined ? old.carryOverExpiryMonths : r.data.carryOverExpiryMonths,
      minNoticeDays: r.data.minNoticeDays === undefined ? old.minNoticeDays : r.data.minNoticeDays,
      allowNegativeDays: r.data.allowNegativeDays ?? old.allowNegativeDays, createdBy: ctx.person.id,
    }).returning();
    await tx.update(schema.leavePolicies).set({ effectiveTo: addDays(r.data.effectiveFrom, -1), updatedAt: new Date() }).where(eq(schema.leavePolicies.id, old.id));
    const assigns = await tx.select().from(schema.policyAssignments).where(eq(schema.policyAssignments.policyId, old.id));
    for (const a of assigns) await tx.insert(schema.policyAssignments).values({ firmId: ctx.firm.id, policyId: next.id, appliesTo: a.appliesTo, appliesValue: a.appliesValue, priority: a.priority });
    await audit(tx, ctx.actor, "policy.version", "leave_policy", next.id, { from: old.version, to: next.version, entitlement: next.entitlement, effectiveFrom: next.effectiveFrom });
    return next;
  });
}

export async function addHoliday(ctx: Ctx, raw: unknown) {
  requireAdmin(ctx);
  const r = z.object({ date: ISO, name: z.string().trim().min(2).max(80) }).safeParse(raw);
  if (!r.success) throw new UserError("A date and a name are required.");
  await withFirm(ctx.firm.id, async tx => {
    await tx.insert(schema.publicHolidays).values({ firmId: ctx.firm.id, date: r.data.date, observedDate: r.data.date, name: r.data.name, source: "firm", createdBy: ctx.person.id });
    await audit(tx, ctx.actor, "holiday.add", "public_holiday", null, r.data);
  });
}

const Closure = z.object({ name: z.string().trim().min(2).max(80), start: ISO, end: ISO, type: z.string().default("annual"), excludes: z.array(z.string().uuid()).default([]) });

/** Impact of a closure per person before applying it (doc 06 F5). */
async function closureImpact(tx: Tx, c: { start: string; end: string; leaveTypeId: string; excludes: string[] }) {
  const people = await tx.select().from(schema.people).where(and(eq(schema.people.status, "active"), isNull(schema.people.deactivatedAt), eq(schema.people.onboardingStatus, "complete")));
  const hol = await holidaysBetween(tx, c.start, c.end);
  const { policies, assignments } = await loadPolicies(tx);
  return people.filter(p => !c.excludes.includes(p.id)).map(p => {
    const pol = resolvePolicy(policies, assignments, { id: p.id, startDate: p.startDate, pattern: p.workPattern, employmentType: p.employmentType, departmentId: p.departmentId }, c.leaveTypeId, c.start);
    return { person: p, policy: pol as PolicyRow | null, days: workingDays({ start: c.start, end: c.end, pattern: p.workPattern, holidays: hol }).total };
  });
}

export async function previewClosure(ctx: Ctx, raw: unknown) {
  requireAdmin(ctx);
  const r = Closure.safeParse(raw);
  if (!r.success || r.data.end < r.data.start) throw new UserError("A name and valid dates are required.");
  return withFirm(ctx.firm.id, async tx => {
    const [t] = await tx.select().from(schema.leaveTypes).where(eq(schema.leaveTypes.code, r.data.type));
    const impact = await closureImpact(tx, { ...r.data, leaveTypeId: t.id });
    return impact.map(i => ({ personId: i.person.id, name: displayName(i.person), days: i.days }));
  });
}

/** Creates and applies a firm closure: one `closure` ledger entry per person; requests over those dates won't deduct again. */
export async function applyClosure(ctx: Ctx, raw: unknown) {
  requireAdmin(ctx);
  const r = Closure.safeParse(raw);
  if (!r.success || r.data.end < r.data.start) throw new UserError("A name and valid dates are required.");
  return withFirm(ctx.firm.id, async tx => {
    const [t] = await tx.select().from(schema.leaveTypes).where(eq(schema.leaveTypes.code, r.data.type));
    if (!t) throw new UserError("Unknown leave type.");
    const [c] = await tx.insert(schema.firmClosures).values({ firmId: ctx.firm.id, name: r.data.name, startDate: r.data.start, endDate: r.data.end, leaveTypeId: t.id,
      excludesPeople: r.data.excludes, appliedAt: new Date(), appliedBy: ctx.person.id, createdBy: ctx.person.id }).returning();
    let entries = 0;
    for (const i of await closureImpact(tx, { ...r.data, leaveTypeId: t.id })) {
      if (!i.policy || i.days <= 0) continue;
      const cyc = cycleFor(i.policy, { startDate: i.person.startDate }, r.data.start);
      await tx.insert(schema.leaveLedger).values({ firmId: ctx.firm.id, personId: i.person.id, leaveTypeId: t.id, cycleStart: cyc.start, cycleEnd: cyc.end,
        entryKind: "closure", days: -i.days, effectiveDate: r.data.start, sourceKind: "closure", sourceId: c.id, reason: r.data.name,
        policyId: i.policy.id, policyVersion: i.policy.version, createdBy: ctx.person.id });
      entries++;
    }
    await audit(tx, ctx.actor, "closure.apply", "firm_closure", c.id, { ...r.data, entries });
    return { id: c.id, entries };
  });
}

/** Explicit approver for someone at the top of the organogram (ADR-09). Rows are updated, never deleted. */
export async function setRoute(ctx: Ctx, raw: unknown) {
  requireAdmin(ctx);
  const r = z.object({ personId: z.string().uuid(), approverId: z.string().uuid() }).safeParse(raw);
  if (!r.success || r.data.personId === r.data.approverId) throw new UserError("Choose a person and a different approver.");
  await withFirm(ctx.firm.id, async tx => {
    const [existing] = await tx.select().from(schema.approvalRoutes).where(and(eq(schema.approvalRoutes.scope, "person"), eq(schema.approvalRoutes.scopeValue, r.data.personId), eq(schema.approvalRoutes.subjectType, "leave")));
    if (existing) await tx.update(schema.approvalRoutes).set({ approverValue: r.data.approverId, updatedAt: new Date() }).where(eq(schema.approvalRoutes.id, existing.id));
    else await tx.insert(schema.approvalRoutes).values({ firmId: ctx.firm.id, subjectType: "leave", scope: "person", scopeValue: r.data.personId, approverKind: "person", approverValue: r.data.approverId });
    await audit(tx, ctx.actor, "route.set", "person", r.data.personId, { approverId: r.data.approverId });
  });
}

// ------------------------------------------------------------------ delegation (R3, doc 05 §7)

const Delegation = z.object({ delegateId: z.string().uuid(), start: ISO, end: ISO, delegatorId: z.string().uuid().optional() });

export async function listDelegations(tx: Tx, ctx: Ctx) {
  const rows = await tx.select().from(schema.delegations).where(and(isNull(schema.delegations.revokedAt), gte(schema.delegations.endDate, todayIn(ctx.firm.timezone))));
  const visible = ctx.person.role === "admin" ? rows : rows.filter(d => d.delegatorId === ctx.person.id || d.delegateId === ctx.person.id);
  return visible.map(d => ({ id: d.id, delegatorId: d.delegatorId, delegateId: d.delegateId, start: d.startDate, end: d.endDate }));
}

export async function createDelegation(ctx: Ctx, raw: unknown) {
  const r = Delegation.safeParse(raw);
  if (!r.success || r.data.end < r.data.start) throw new UserError("Choose a colleague and a valid date range.");
  const delegatorId = r.data.delegatorId ?? ctx.person.id;
  const w = who(ctx);
  if (!(delegatorId === ctx.person.id ? can(w, "delegation.manage_own") : can(w, "delegation.manage_any"))) throw new UserError("Not allowed.", 403);
  if (delegatorId === r.data.delegateId) throw new UserError("You cannot delegate to yourself.");
  return withFirm(ctx.firm.id, async tx => {
    const [d] = await tx.insert(schema.delegations).values({ firmId: ctx.firm.id, delegatorId, delegateId: r.data.delegateId, subjectTypes: ["leave"],
      startDate: r.data.start, endDate: r.data.end, createdBy: ctx.person.id }).returning();
    // Open approvals assigned to the delegator move to the delegate now if the window has started (doc 05 §7).
    if (r.data.start <= todayIn(ctx.firm.timezone)) {
      await tx.execute(sql`update workflow_instances set assignee_id = ${r.data.delegateId},
        context_json = context_json || jsonb_build_object('onBehalfOfId', ${delegatorId}::text), updated_at = now()
        where definition_key = 'leave_request' and state = 'pending_approval' and assignee_id = ${delegatorId}
          and subject_id <> all(select id from leave_requests where person_id = ${r.data.delegateId})`);
    }
    await audit(tx, ctx.actor, "delegation.create", "delegation", d.id, { delegatorId, delegateId: r.data.delegateId, start: r.data.start, end: r.data.end });
    return d;
  });
}

export async function revokeDelegation(ctx: Ctx, id: string) {
  await withFirm(ctx.firm.id, async tx => {
    const [d] = await tx.select().from(schema.delegations).where(eq(schema.delegations.id, id));
    if (!d) throw new UserError("Delegation not found.", 404);
    if (d.delegatorId !== ctx.person.id && !can(who(ctx), "delegation.manage_any")) throw new UserError("Not allowed.", 403);
    await tx.update(schema.delegations).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(schema.delegations.id, id));
    await tx.execute(sql`update workflow_instances set assignee_id = ${d.delegatorId}, context_json = context_json - 'onBehalfOfId', updated_at = now()
      where definition_key = 'leave_request' and state = 'pending_approval' and assignee_id = ${d.delegateId} and context_json->>'onBehalfOfId' = ${d.delegatorId}::text`);
    await audit(tx, ctx.actor, "delegation.revoke", "delegation", id);
  });
}
