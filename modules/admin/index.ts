/**
 * Admin and reporting (doc 06 S4, S12, S14, S16; doc 05 §6; doc 07 §4; doc 08 §3).
 * Dashboard, person file, written particulars, offboarding, audit view, reports, payroll export, "download my information".
 */
import crypto from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, withFirm, type Tx } from "@/lib/db";
import { putBytes, UserError } from "@/lib/storage";
import { hashIdentifier } from "@/lib/crypto";
import type { Person } from "@/db/schema";
import { audit, logAccess } from "../audit";
import { can } from "../permissions";
import type { Ctx } from "../identity/actor";
import { displayName } from "../people";
import { enqueue, cancelQueued } from "../notifications";
import { directReportIds, resolveApprover } from "../workflow/routing";
import { ACTIVE, balancesFor, loadPolicies, todayIn } from "../leave";
import { addDays, longDate, resolvePolicy, workingDays } from "../leave/engine";

const who = (ctx: Ctx) => ({ id: ctx.person.id, role: ctx.person.role, isManager: ctx.isManager });
const need = (ok: boolean) => { if (!ok) throw new UserError("Not allowed.", 403); };
const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Postgres array literal for uuid lists — drizzle would otherwise expand a JS array into separate parameters. */
const pgArray = (ids: string[]) => `{${ids.join(",")}}`;
const num = (r: { rows: unknown[] }) => Number((r.rows[0] as { n: number }).n ?? 0);

// ------------------------------------------------------------------ dashboards

export async function adminDashboard(tx: Tx, ctx: Ctx) {
  const today = todayIn(ctx.firm.timezone);
  const weekEnd = addDays(today, 6);
  const [headcount, awayToday, awayWeek, pending, oldest, inReview, docs, handovers, failedMail, jobs, expiring] = await Promise.all([
    tx.execute(sql`select count(*)::int n from people where status = 'active' and deactivated_at is null and employment_status in ('active','on_notice')`).then(num),
    tx.execute(sql`select count(distinct r.person_id)::int n from leave_requests r join workflow_instances w on w.id = r.workflow_instance_id where w.state in ('approved','completed') and r.start_date <= ${today} and r.end_date >= ${today}`).then(num),
    tx.execute(sql`select count(distinct r.person_id)::int n from leave_requests r join workflow_instances w on w.id = r.workflow_instance_id where w.state in ('approved','completed') and r.start_date <= ${weekEnd} and r.end_date >= ${today}`).then(num),
    tx.execute(sql`select count(*)::int n from workflow_instances where definition_key = 'leave_request' and state in ('pending_approval','awaiting_cover')`).then(num),
    tx.execute(sql`select coalesce(extract(day from now() - min(created_at)), 0)::int n from workflow_instances where definition_key = 'leave_request' and state = 'pending_approval'`).then(num),
    tx.execute(sql`select count(*)::int n from people where onboarding_status = 'in_review'`).then(num),
    tx.execute(sql`select count(*)::int n from documents where status = 'pending'`).then(num),
    tx.execute(sql`select count(*)::int n from coverage_requests c join leave_requests r on r.id = c.leave_request_id join workflow_instances w on w.id = r.workflow_instance_id
      where w.state = 'approved' and c.handover_confirmed_at is null and r.start_date between ${today} and ${addDays(today, 7)}`).then(num),
    tx.execute(sql`select count(*)::int n from notifications where status = 'failed' and created_at > now() - interval '7 days'`).then(num),
    tx.select({ jobKey: schema.jobRuns.jobKey, status: schema.jobRuns.status, at: schema.jobRuns.startedAt }).from(schema.jobRuns)
      .where(eq(schema.jobRuns.firmId, ctx.firm.id)).orderBy(desc(schema.jobRuns.startedAt)).limit(8),
    tx.execute(sql`select count(*)::int n from leave_ledger where entry_kind = 'carry_over_in' and cycle_start > ${addDays(today, -366)}`).then(num),
  ]);
  return { headcount, awayToday, awayWeek, pendingApprovals: pending, oldestPendingDays: oldest, onboardingInReview: inReview,
    documentsToReview: docs, handoversUnconfirmed: handovers, emailFailures: failedMail, carriedBalances: expiring,
    jobs: jobs.map(j => ({ key: j.jobKey, status: j.status, at: j.at })) };
}

/** Manager home (doc 06 S3): approvals waiting, team away this week, handovers due. */
export async function managerDashboard(tx: Tx, ctx: Ctx) {
  const today = todayIn(ctx.firm.timezone);
  const reports = await directReportIds(tx, ctx.person.id);
  const waiting = await tx.execute(sql`select count(*)::int n, coalesce(extract(day from now() - min(created_at)),0)::int d from workflow_instances
    where definition_key = 'leave_request' and state = 'pending_approval' and assignee_id = ${ctx.person.id}`);
  const row = waiting.rows[0] as { n: number; d: number };
  const away = reports.length ? await tx.execute(sql`select count(distinct r.person_id)::int n from leave_requests r join workflow_instances w on w.id = r.workflow_instance_id
    where w.state in ('approved','completed') and r.person_id = any(${pgArray(reports)}::uuid[]) and r.start_date <= ${addDays(today, 6)} and r.end_date >= ${today}`).then(num) : 0;
  return { approvalsWaiting: row.n, oldestDays: row.d, teamAwayThisWeek: away, teamSize: reports.length };
}

// ------------------------------------------------------------------ person file (S12) and organogram

export async function personFile(ctx: Ctx, personId: string) {
  return withFirm(ctx.firm.id, async tx => {
    const [p] = await tx.select().from(schema.people).where(eq(schema.people.id, personId));
    if (!p) throw new UserError("Person not found.", 404);
    need(can(who(ctx), "profile.view", { personId: p.id, managerId: p.reportsToId }));
    const isAdmin = ctx.person.role === "admin";
    const today = todayIn(ctx.firm.timezone);
    const [contacts, balances, acks, events] = await Promise.all([
      tx.select().from(schema.emergencyContacts).where(eq(schema.emergencyContacts.personId, p.id)),
      balancesFor(tx, p, today),
      tx.select({ a: schema.ackDocuments, ack: schema.acknowledgements }).from(schema.ackDocuments)
        .leftJoin(schema.acknowledgements, and(eq(schema.acknowledgements.ackDocumentId, schema.ackDocuments.id), eq(schema.acknowledgements.personId, p.id)))
        .where(eq(schema.ackDocuments.personId, p.id)),
      isAdmin ? tx.select().from(schema.auditEvents).where(eq(schema.auditEvents.subjectId, p.id)).orderBy(desc(schema.auditEvents.at)).limit(30) : Promise.resolve([]),
    ]);
    const annual = balances.find(b => b.code === "annual");
    return {
      id: p.id, name: displayName(p), email: p.workEmail, title: p.jobTitle, employeeNo: p.employeeNo, role: p.role, employmentType: p.employmentType,
      startDate: p.startDate, lastWorkingDay: p.lastWorkingDay, employmentStatus: p.employmentStatus, isFeeEarner: p.isFeeEarner, workPattern: p.workPattern,
      contacts: contacts.map(c => ({ name: c.name, relationship: c.relationship, phone: c.phone })),
      balances, acknowledgements: acks.map(x => ({ id: x.a.id, title: x.a.title, kind: x.a.kind, issuedAt: x.a.issuedAt, acknowledgedAt: x.ack?.acknowledgedAt ?? null })),
      // BCEA s40: untaken annual leave is paid out on termination (doc 04 §5).
      payoutDays: p.employmentStatus !== "active" && annual ? annual.available : null,
      audit: events.map(e => ({ at: e.at, action: e.action, actorId: e.actorId })),
    };
  });
}

export async function updatePerson(ctx: Ctx, personId: string, raw: unknown) {
  need(can(who(ctx), "people.manage"));
  const r = z.object({
    reportsToId: z.string().uuid().nullable().optional(), departmentId: z.string().uuid().nullable().optional(),
    role: z.enum(["admin", "manager", "staff", "viewer"]).optional(), employeeNo: z.string().trim().max(30).nullable().optional(),
    employmentType: z.enum(["permanent", "fixed_term", "candidate_attorney", "contractor", "part_time"]).optional(),
    isFeeEarner: z.boolean().optional(), workPattern: z.array(z.number().int().min(1).max(7)).min(1).max(7).nullable().optional(), startDate: ISO.optional(),
  }).safeParse(raw);
  if (!r.success) throw new UserError("Check the employment details.");
  await withFirm(ctx.firm.id, async tx => {
    if (r.data.reportsToId) {
      // No reporting cycles: walk up from the new manager.
      let cur: string | null = r.data.reportsToId;
      for (let i = 0; cur && i < 50; i++) {
        if (cur === personId) throw new UserError("That would create a reporting loop in the organogram.");
        const [m] = await tx.select({ up: schema.people.reportsToId }).from(schema.people).where(eq(schema.people.id, cur));
        cur = m?.up ?? null;
      }
    }
    await tx.update(schema.people).set({ ...r.data, updatedAt: new Date() }).where(eq(schema.people.id, personId));
    await audit(tx, ctx.actor, "person.update", "person", personId, r.data);
  });
}

export async function saveEmergencyContact(ctx: Ctx, raw: unknown) {
  const r = z.object({ name: z.string().trim().min(2).max(80), relationship: z.string().trim().min(2).max(40), phone: z.string().trim().min(6).max(30) }).safeParse(raw);
  if (!r.success) throw new UserError("Name, relationship and phone are required.");
  await withFirm(ctx.firm.id, async tx => {
    const [existing] = await tx.select().from(schema.emergencyContacts).where(and(eq(schema.emergencyContacts.personId, ctx.person.id), eq(schema.emergencyContacts.isPrimary, true)));
    if (existing) await tx.update(schema.emergencyContacts).set({ ...r.data, updatedAt: new Date() }).where(eq(schema.emergencyContacts.id, existing.id));
    else await tx.insert(schema.emergencyContacts).values({ firmId: ctx.firm.id, personId: ctx.person.id, ...r.data, isPrimary: true, createdBy: ctx.person.id });
    await audit(tx, ctx.actor, "person.emergency_contact", "person", ctx.person.id);
  });
}

// ------------------------------------------------------------------ written particulars (A8, BCEA s29) and acknowledgement

async function particularsText(tx: Tx, ctx: Ctx, p: Person) {
  const [dept] = p.departmentId ? await tx.select().from(schema.departments).where(eq(schema.departments.id, p.departmentId)) : [];
  const [mgr] = p.reportsToId ? await tx.select().from(schema.people).where(eq(schema.people.id, p.reportsToId)) : [];
  const { policies, assignments } = await loadPolicies(tx);
  const types = await tx.select().from(schema.leaveTypes).where(eq(schema.leaveTypes.isActive, true)).orderBy(asc(schema.leaveTypes.sort));
  const on = p.startDate ?? todayIn(ctx.firm.timezone);
  const leaveLines = types.map(t => {
    const pol = resolvePolicy(policies, assignments, { id: p.id, startDate: p.startDate, pattern: p.workPattern, employmentType: p.employmentType, departmentId: p.departmentId }, t.id, on);
    return pol ? `- ${t.label}: ${pol.entitlement} ${pol.cycleKind === "three_year" ? "days per 36-month cycle" : "working days per leave cycle"}` : `- ${t.label}: by application${t.category === "parental" ? " (per event, Van Wyk [2025] ZACC 20)" : ""}`;
  });
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return [
    `# Written particulars of employment`, ``,
    `Basic Conditions of Employment Act 75 of 1997, section 29.`, ``,
    `**Employer:** ${ctx.firm.legalName}`, `**Employee:** ${p.firstName} ${p.lastName}`, `**Job title:** ${p.jobTitle ?? "—"}`,
    `**Department:** ${dept?.name ?? "—"}`, `**Reports to:** ${mgr ? displayName(mgr) : "—"}`, `**Employment type:** ${p.employmentType.replace("_", " ")}`,
    `**Start date:** ${p.startDate ? longDate(p.startDate) : "to be confirmed"}`,
    `**Ordinary working days:** ${(p.workPattern?.length ? p.workPattern : [1, 2, 3, 4, 5]).map(d => days[d - 1]).join(", ")}`, ``,
    `## Leave`, ...leaveLines, ``,
    `Remuneration, deductions, notice periods and the other particulars required by section 29 are set out in your letter of appointment.`,
    `This statement is issued electronically. Your acknowledgement records that you received it; it is not a signature of agreement to new terms.`,
  ].join("\n");
}

export async function issueParticulars(ctx: Ctx, personId: string) {
  need(can(who(ctx), "people.manage"));
  return withFirm(ctx.firm.id, async tx => {
    const [p] = await tx.select().from(schema.people).where(eq(schema.people.id, personId));
    if (!p) throw new UserError("Person not found.", 404);
    const text = await particularsText(tx, ctx, p);
    const bytes = Buffer.from(text, "utf8");
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const prior = await tx.select().from(schema.ackDocuments).where(and(eq(schema.ackDocuments.personId, p.id), eq(schema.ackDocuments.kind, "written_particulars"), isNull(schema.ackDocuments.supersededById)));
    const blobPath = `${ctx.firm.id}/acks/${p.id}/${sha256}.md`;
    await putBytes(ctx.firm.id, blobPath, bytes, "text/markdown");
    const [doc] = await tx.insert(schema.ackDocuments).values({ firmId: ctx.firm.id, kind: "written_particulars", personId: p.id, title: "Written particulars of employment",
      version: prior.length + 1, blobPath, sha256, createdBy: ctx.person.id }).returning();
    for (const old of prior) await tx.update(schema.ackDocuments).set({ supersededById: doc.id, updatedAt: new Date() }).where(eq(schema.ackDocuments.id, old.id));
    await audit(tx, ctx.actor, "ack.issue", "ack_document", doc.id, { personId: p.id, kind: "written_particulars" });
    await enqueue(tx, { firmId: ctx.firm.id, recipientId: p.id, templateKey: "ack.issued", payload: { title: doc.title, firm: ctx.firm.displayName }, dedupeKey: `ack:${doc.id}` });
    return { id: doc.id, text };
  });
}

/** What the person must still acknowledge, with the text to read. */
export async function pendingAcknowledgements(tx: Tx, ctx: Ctx) {
  const docs = await tx.select({ a: schema.ackDocuments, ack: schema.acknowledgements }).from(schema.ackDocuments)
    .leftJoin(schema.acknowledgements, and(eq(schema.acknowledgements.ackDocumentId, schema.ackDocuments.id), eq(schema.acknowledgements.personId, ctx.person.id)))
    .where(and(eq(schema.ackDocuments.personId, ctx.person.id), isNull(schema.ackDocuments.supersededById)));
  const out = [];
  for (const d of docs) {
    const [p] = await tx.select().from(schema.people).where(eq(schema.people.id, ctx.person.id));
    out.push({ id: d.a.id, title: d.a.title, issuedAt: d.a.issuedAt, acknowledgedAt: d.ack?.acknowledgedAt ?? null, text: await particularsText(tx, ctx, p) });
  }
  return out;
}

export async function acknowledge(ctx: Ctx, ackDocumentId: string, meta: { ip?: string | null; userAgent?: string | null; typedName?: string }) {
  await withFirm(ctx.firm.id, async tx => {
    const [d] = await tx.select().from(schema.ackDocuments).where(eq(schema.ackDocuments.id, ackDocumentId));
    if (!d || d.personId !== ctx.person.id) throw new UserError("Document not found.", 404);
    // Evidence (doc 02 §7): which exact bytes (hash), when, from where, how.
    await tx.insert(schema.acknowledgements).values({ firmId: ctx.firm.id, ackDocumentId: d.id, personId: ctx.person.id, documentSha256: d.sha256,
      ipHash: meta.ip ? hashIdentifier(meta.ip) : null, userAgent: meta.userAgent?.slice(0, 200) ?? null,
      method: meta.typedName ? "typed_name" : "click", typedName: meta.typedName ?? null }).onConflictDoNothing();
    await audit(tx, ctx.actor, "ack.acknowledge", "ack_document", d.id);
  });
}

// ------------------------------------------------------------------ offboarding (N4, doc 05 §6)

export async function setLastWorkingDay(ctx: Ctx, personId: string, raw: unknown) {
  need(can(who(ctx), "people.offboard"));
  const r = z.object({ lastWorkingDay: ISO }).safeParse(raw);
  if (!r.success) throw new UserError("Choose the last working day.");
  if (personId === ctx.person.id) throw new UserError("You cannot offboard yourself.");
  await withFirm(ctx.firm.id, async tx => {
    await tx.update(schema.people).set({ lastWorkingDay: r.data.lastWorkingDay, employmentStatus: "on_notice", updatedAt: new Date() }).where(eq(schema.people.id, personId));
    await audit(tx, ctx.actor, "person.notice", "person", personId, r.data);
  });
}

/** Daily job: people whose last working day has passed are offboarded; their future leave is cancelled with reversals; approvals re-routed. */
export async function offboardDue(firmId: string, today: string) {
  return withFirm(firmId, async tx => {
    const due = await tx.select().from(schema.people).where(and(eq(schema.people.employmentStatus, "on_notice"), sql`${schema.people.lastWorkingDay} < ${today}`));
    let cancelled = 0, rerouted = 0;
    for (const p of due) {
      await tx.update(schema.people).set({ employmentStatus: "offboarded", deactivatedAt: new Date(), updatedAt: new Date() }).where(eq(schema.people.id, p.id));
      const future = await tx.select({ r: schema.leaveRequests, w: schema.workflowInstances }).from(schema.leaveRequests)
        .innerJoin(schema.workflowInstances, eq(schema.workflowInstances.id, schema.leaveRequests.workflowInstanceId))
        .where(and(eq(schema.leaveRequests.personId, p.id), inArray(schema.workflowInstances.state, ACTIVE.filter(s => s !== "completed")), gte(schema.leaveRequests.startDate, today)));
      for (const { r, w } of future) {
        await tx.update(schema.workflowInstances).set({ state: "cancelled", closedAt: new Date(), updatedAt: new Date() }).where(eq(schema.workflowInstances.id, w.id));
        await tx.insert(schema.workflowSteps).values({ firmId, instanceId: w.id, fromState: w.state, toState: "cancelled", action: "cancel", actorId: null, comment: "Employment ended" });
        if (w.state === "approved" && r.policyId && r.workingDays != null) {
          const [taken] = await tx.select().from(schema.leaveLedger).where(and(eq(schema.leaveLedger.sourceId, r.id), eq(schema.leaveLedger.entryKind, "taken")));
          if (taken) await tx.insert(schema.leaveLedger).values({ firmId, personId: p.id, leaveTypeId: r.leaveTypeId, cycleStart: taken.cycleStart, cycleEnd: taken.cycleEnd,
            entryKind: "reversal", days: Number(r.workingDays), effectiveDate: today, sourceKind: "offboarding", sourceId: r.id, reason: "Employment ended" });
        }
        await cancelQueued(tx, `leave:${r.id}:`);
        cancelled++;
      }
      // Approvals assigned to the leaver go to the requester's next approver.
      const open = await tx.select({ w: schema.workflowInstances, r: schema.leaveRequests }).from(schema.workflowInstances)
        .innerJoin(schema.leaveRequests, eq(schema.leaveRequests.id, schema.workflowInstances.subjectId))
        .where(and(eq(schema.workflowInstances.assigneeId, p.id), eq(schema.workflowInstances.state, "pending_approval")));
      for (const { w, r } of open) {
        const next = await resolveApprover(tx, "leave", r.personId, r.startDate);
        if (!next) continue;
        await tx.update(schema.workflowInstances).set({ assigneeId: next.approverId, updatedAt: new Date() }).where(eq(schema.workflowInstances.id, w.id));
        await tx.insert(schema.workflowSteps).values({ firmId, instanceId: w.id, fromState: w.state, toState: w.state, action: "reassign", actorId: null, comment: "Approver left the firm" });
        rerouted++;
      }
      await tx.insert(schema.auditEvents).values({ firmId, actorKind: "system", action: "person.offboard", subjectType: "person", subjectId: p.id });
    }
    return { offboarded: due.length, cancelled, rerouted };
  });
}

// ------------------------------------------------------------------ audit view (S16)

export async function auditView(ctx: Ctx, raw: unknown) {
  need(can(who(ctx), "audit.view"));
  const f = z.object({ personId: z.string().uuid().optional(), action: z.string().max(60).optional(), from: ISO.optional(), to: ISO.optional() }).parse(raw ?? {});
  return withFirm(ctx.firm.id, async tx => {
    const rows = await tx.select({ e: schema.auditEvents, first: schema.people.firstName, last: schema.people.lastName, pref: schema.people.preferredName })
      .from(schema.auditEvents).leftJoin(schema.people, eq(schema.people.id, schema.auditEvents.actorId))
      .where(and(
        f.personId ? sql`(${schema.auditEvents.subjectId} = ${f.personId} or ${schema.auditEvents.actorId} = ${f.personId}
          or ${schema.auditEvents.subjectId} in (select id from leave_requests where person_id = ${f.personId}))` : undefined,
        f.action ? sql`${schema.auditEvents.action} like ${f.action + "%"}` : undefined,
        f.from ? gte(schema.auditEvents.at, new Date(`${f.from}T00:00:00+02:00`)) : undefined,
        f.to ? lte(schema.auditEvents.at, new Date(`${f.to}T23:59:59+02:00`)) : undefined))
      .orderBy(desc(schema.auditEvents.at)).limit(300);
    return rows.map(({ e, first, last, pref }) => ({
      at: e.at, action: e.action, subjectType: e.subjectType, subjectId: e.subjectId,
      actor: e.actorKind === "system" ? "System" : first ? displayName({ firstName: first, lastName: last!, preferredName: pref }) : e.actorKind, diff: e.diff,
    }));
  });
}

// ------------------------------------------------------------------ reports (S14)

export async function reports(ctx: Ctx, year: number) {
  const w = who(ctx);
  need(can(w, "reports.team"));
  const firmWide = can(w, "reports.firm");
  return withFirm(ctx.firm.id, async tx => {
    const scope = firmWide ? null : await directReportIds(tx, ctx.person.id);
    const scoped = scope ? sql`and r.person_id = any(${pgArray(scope)}::uuid[])` : sql``;
    const byMonth = await tx.execute(sql`
      select t.label as type, extract(month from d.date)::int as month, sum(d.fraction)::float as days
      from leave_request_days d join leave_requests r on r.id = d.request_id join leave_types t on t.id = r.leave_type_id
      join workflow_instances w on w.id = r.workflow_instance_id
      where w.state in ('approved','completed') and extract(year from d.date) = ${year} ${scoped}
      group by 1, 2 order by 1, 2`);
    const people = await tx.select().from(schema.people).where(and(eq(schema.people.status, "active"), isNull(schema.people.deactivatedAt),
      scope ? inArray(schema.people.id, scope.length ? scope : ["00000000-0000-0000-0000-000000000000"]) : undefined));
    const today = todayIn(ctx.firm.timezone);
    const balances = [];
    for (const p of people.filter(x => x.onboardingStatus === "complete")) {
      const b = await balancesFor(tx, p, today);
      const g = (c: string) => b.find(x => x.code === c);
      balances.push({ personId: p.id, name: displayName(p), annual: g("annual")?.available ?? null, annualProjected: g("annual")?.projected ?? null,
        sick: g("sick")?.available ?? null, family: g("family")?.available ?? null });
    }
    const depts = await tx.select().from(schema.departments);
    const headcount = depts.map(d => ({ department: d.name, count: people.filter(p => p.departmentId === d.id && p.employmentStatus !== "offboarded").length })).filter(x => x.count);
    const onboarding = ["invited", "draft", "in_review", "complete"].map(s => ({ status: s, count: people.filter(p => p.onboardingStatus === s).length }));
    return { year, scope: firmWide ? "firm" : "team", byMonth: byMonth.rows, balances, headcount, onboarding };
  });
}

// ------------------------------------------------------------------ payroll leave export (doc 07 §4, ADR-12)

const LEAVE_CODE: Record<string, string> = { annual: "ANN", sick: "SICK", family: "FAM", parental: "PAR", study: "STUDY", unpaid: "UNPAID", other: "OTHER" };
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export async function payrollExport(ctx: Ctx, raw: unknown) {
  need(can(who(ctx), "payroll.export"));
  const r = z.object({ from: ISO, to: ISO }).safeParse(raw);
  if (!r.success || r.data.to < r.data.from) throw new UserError("Choose a valid period.");
  const { from, to } = r.data;
  return withFirm(ctx.firm.id, async tx => {
    const approved = await tx.select({ r: schema.leaveRequests, t: schema.leaveTypes, p: schema.people, w: schema.workflowInstances }).from(schema.leaveRequests)
      .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, schema.leaveRequests.leaveTypeId))
      .innerJoin(schema.people, eq(schema.people.id, schema.leaveRequests.personId))
      .innerJoin(schema.workflowInstances, eq(schema.workflowInstances.id, schema.leaveRequests.workflowInstanceId))
      .where(and(inArray(schema.workflowInstances.state, ["approved", "completed", "cancelled"]), lte(schema.leaveRequests.startDate, to), gte(schema.leaveRequests.endDate, from)))
      .orderBy(asc(schema.people.lastName), asc(schema.leaveRequests.startDate));
    // Cancelled rows only if they had been approved (they reverse something payroll may already have).
    const wasApproved = new Set((await tx.select({ id: schema.workflowSteps.instanceId }).from(schema.workflowSteps).where(eq(schema.workflowSteps.toState, "approved"))).map(x => x.id));
    const exportedAt = new Date().toISOString();
    const header = ["employee_no", "surname", "first_name", "leave_code", "start_date", "end_date", "days", "paid", "status", "request_no", "exported_at"];
    const lines = [header.join(",")];
    for (const x of approved) {
      if (x.w.state === "cancelled" && !wasApproved.has(x.w.id)) continue;
      const days = Number(x.r.workingDays ?? 0);
      lines.push([x.p.employeeNo ?? "", x.p.lastName, x.p.firstName, LEAVE_CODE[x.t.code] ?? "OTHER", x.r.startDate, x.r.endDate,
        (x.w.state === "cancelled" ? -days : days).toFixed(2), x.t.isPaid ? "Y" : "N", x.w.state === "cancelled" ? "CANCELLED" : "APPROVED", x.r.requestNo, exportedAt].map(csvCell).join(","));
    }
    const csv = lines.join("\n") + "\n";
    const blobPath = `${ctx.firm.id}/exports/payroll-${from}-${to}-${Date.now()}.csv`;
    await putBytes(ctx.firm.id, blobPath, Buffer.from(csv), "text/csv");
    await tx.insert(schema.exportsTable).values({ firmId: ctx.firm.id, kind: "payroll_leave", params: { from, to, rows: lines.length - 1 }, blobPath, createdBy: ctx.person.id,
      expiresAt: new Date(Date.now() + 7 * 86400000) });
    await logAccess(tx, ctx.actor, "payroll_export", null, "export");
    await audit(tx, ctx.actor, "export.payroll", "export", null, { from, to, rows: lines.length - 1 });
    return { csv, rows: lines.length - 1, fileName: `payroll-leave-${from}-to-${to}.csv` };
  });
}

// ------------------------------------------------------------------ download my information (POPIA s23, doc 08 §3)

export async function myInformation(ctx: Ctx) {
  return withFirm(ctx.firm.id, async tx => {
    const p = ctx.person;
    const [contacts, docs, requests, ledger, acks] = await Promise.all([
      tx.select().from(schema.emergencyContacts).where(eq(schema.emergencyContacts.personId, p.id)),
      tx.select({ fileName: schema.documents.fileName, status: schema.documents.status, uploadedAt: schema.documents.createdAt }).from(schema.documents).where(eq(schema.documents.personId, p.id)),
      tx.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.personId, p.id)),
      tx.select().from(schema.leaveLedger).where(eq(schema.leaveLedger.personId, p.id)),
      tx.select().from(schema.acknowledgements).where(eq(schema.acknowledgements.personId, p.id)),
    ]);
    await logAccess(tx, ctx.actor, "my_information", p.id, "export");
    await audit(tx, ctx.actor, "person.download_information", "person", p.id);
    return {
      generatedAt: new Date().toISOString(), firm: ctx.firm.legalName,
      person: { name: displayName(p), email: p.workEmail, phone: p.phone, title: p.jobTitle, startDate: p.startDate, employmentType: p.employmentType, role: p.role },
      emergencyContacts: contacts.map(c => ({ name: c.name, relationship: c.relationship, phone: c.phone })),
      documents: docs, leaveRequests: requests.map(r => ({ requestNo: r.requestNo, start: r.startDate, end: r.endDate, days: r.workingDays, note: r.note, reason: r.reasonPrivate })),
      leaveLedger: ledger.map(l => ({ date: l.effectiveDate, kind: l.entryKind, days: l.days, reason: l.reason })),
      acknowledgements: acks.map(a => ({ at: a.acknowledgedAt, documentSha256: a.documentSha256, method: a.method })),
    };
  });
}

