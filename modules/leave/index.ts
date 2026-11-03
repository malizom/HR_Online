/**
 * Leave requests on the workflow engine with organogram routing (S0 scope: v1 parity).
 * The leave engine proper — balances, working days, policies, ledger — arrives in S1 per design doc 04.
 */
import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, withFirm, type Tx } from "@/lib/db";
import { UserError } from "@/lib/storage";
import { enqueue, cancelQueued } from "../notifications";
import { allowedActions, getInstance, startWorkflow, transition } from "../workflow/engine";
import { resolveApprover, directReportIds } from "../workflow/routing";
import { displayName } from "../people";
import type { Ctx } from "../identity/actor";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const Request = z.object({
  type: z.string().min(1), start: z.string().regex(ISO), end: z.string().regex(ISO), note: z.string().trim().max(500).optional(),
});

export async function listLeaveTypes(tx: Tx) {
  return tx.select({ id: schema.leaveTypes.id, code: schema.leaveTypes.code, label: schema.leaveTypes.label })
    .from(schema.leaveTypes).where(eq(schema.leaveTypes.isActive, true)).orderBy(schema.leaveTypes.sort);
}

async function nextRequestNo(tx: Tx, year: number) {
  const r = await tx.execute(sql`select count(*)::int + 1 as n from leave_requests where request_no like ${`LR-${year}-%`}`);
  return `LR-${year}-${String((r.rows[0] as { n: number }).n).padStart(4, "0")}`;
}

export async function requestLeave(ctx: Ctx, raw: unknown, portalUrl: string) {
  if (ctx.person.role === "viewer") throw new UserError("Calendar viewers cannot make changes.", 403);
  if (ctx.person.onboardingStatus !== "complete") throw new UserError("Complete your onboarding before submitting leave requests.");
  const r = Request.safeParse(raw);
  if (!r.success) throw new UserError("Valid From and To dates are required.");
  const { start, end, note } = r.data;
  if (end < start) throw new UserError("The To date cannot be before the From date.");

  return withFirm(ctx.firm.id, async tx => {
    const [type] = await tx.select().from(schema.leaveTypes).where(or(eq(schema.leaveTypes.code, r.data.type), eq(schema.leaveTypes.label, r.data.type)));
    if (!type) throw new UserError("Choose a leave type.");

    // Overlap with the person's own pending/approved requests.
    const overlapping = await tx.select({ id: schema.leaveRequests.id }).from(schema.leaveRequests)
      .innerJoin(schema.workflowInstances, eq(schema.workflowInstances.id, schema.leaveRequests.workflowInstanceId))
      .where(and(eq(schema.leaveRequests.personId, ctx.person.id), inArray(schema.workflowInstances.state, ["pending_approval", "approved"]),
        lte(schema.leaveRequests.startDate, end), gte(schema.leaveRequests.endDate, start)));
    if (overlapping.length) throw new UserError("You already have a pending or approved request covering those dates.");

    const route = await resolveApprover(tx, "leave", ctx.person.id, start);
    if (!route) throw new UserError("No approver could be found for you. Ask HR to set your manager in the organogram.");

    const [req] = await tx.insert(schema.leaveRequests).values({
      firmId: ctx.firm.id, personId: ctx.person.id, leaveTypeId: type.id, requestNo: await nextRequestNo(tx, Number(start.slice(0, 4))),
      startDate: start, endDate: end, note: note || null, raisedById: ctx.person.id, createdBy: ctx.person.id,
    }).returning();
    const inst = await startWorkflow(tx, ctx.actor, "leave_request", "leave_request", req.id, {
      assigneeId: route.approverId, context: { via: route.via, onBehalfOfId: route.onBehalfOfId },
    });
    await tx.update(schema.leaveRequests).set({ workflowInstanceId: inst.id }).where(eq(schema.leaveRequests.id, req.id));
    await enqueue(tx, { firmId: ctx.firm.id, recipientId: route.approverId, templateKey: "leave.submitted",
      payload: { requester: displayName(ctx.person), type: type.label, start, end, link: portalUrl }, dedupeKey: `leave:${req.id}:submitted` });
    return req;
  });
}

const ACTION_BY_STATUS: Record<string, string> = { Approved: "approve", Declined: "decline", Cancelled: "cancel" };

export async function decideLeave(ctx: Ctx, requestId: string, status: string, comment?: string) {
  const action = ACTION_BY_STATUS[status];
  if (!action) throw new UserError("Unknown decision.");
  await withFirm(ctx.firm.id, async tx => {
    const [row] = await tx.select({ r: schema.leaveRequests, type: schema.leaveTypes.label }).from(schema.leaveRequests)
      .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, schema.leaveRequests.leaveTypeId)).where(eq(schema.leaveRequests.id, requestId));
    if (!row) throw new UserError("Leave request not found.", 404);
    const inst = await getInstance(tx, "leave_request", row.r.id);
    if (!inst) throw new UserError("Leave request not found.", 404);
    const ctxJson = inst.context as { onBehalfOfId?: string | null };
    const updated = await transition(tx, { instance: inst, action, actor: ctx.actor, actorRole: ctx.person.role, ownerId: row.r.personId,
      comment: comment ?? null, onBehalfOfId: ctxJson.onBehalfOfId ?? null, nextAssigneeId: null });
    if (action === "cancel") await cancelQueued(tx, `leave:${row.r.id}:`);
    if (action !== "cancel") {
      await enqueue(tx, { firmId: ctx.firm.id, recipientId: row.r.personId, templateKey: `leave.${updated.state}`,
        payload: { type: row.type, start: row.r.startDate, end: row.r.endDate, by: displayName(ctx.person), comment }, dedupeKey: `leave:${row.r.id}:${updated.state}` });
    }
  });
}

const STATUS_LABEL: Record<string, string> = { pending_approval: "Pending", approved: "Approved", declined: "Declined", cancelled: "Cancelled", completed: "Approved" };

/** Requests visible to the actor: own; direct reports' (managers); everything (admin); plus any assigned to them. */
export async function listLeave(tx: Tx, ctx: Ctx) {
  const reports = await directReportIds(tx, ctx.person.id);
  const visibleIds = [ctx.person.id, ...reports];
  const rows = await tx.select({ r: schema.leaveRequests, type: schema.leaveTypes.label, w: schema.workflowInstances,
      firstName: schema.people.firstName, lastName: schema.people.lastName, preferredName: schema.people.preferredName })
    .from(schema.leaveRequests)
    .innerJoin(schema.people, eq(schema.people.id, schema.leaveRequests.personId))
    .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, schema.leaveRequests.leaveTypeId))
    .innerJoin(schema.workflowInstances, eq(schema.workflowInstances.id, schema.leaveRequests.workflowInstanceId))
    .where(ctx.person.role === "admin" ? undefined : or(inArray(schema.leaveRequests.personId, visibleIds), eq(schema.workflowInstances.assigneeId, ctx.person.id)))
    .orderBy(desc(schema.leaveRequests.startDate));
  return rows.map(x => ({
    id: x.r.id, requestNo: x.r.requestNo, owner: x.r.personId, name: displayName(x), type: x.type,
    start: x.r.startDate, end: x.r.endDate, note: x.r.note ?? "", status: STATUS_LABEL[x.w.state] ?? x.w.state,
    actions: allowedActions(x.w, ctx.person.id, ctx.person.role, x.r.personId),
  }));
}

/** Approved leave for the team calendar: names and dates only — reasons stay private. */
export async function calendar(tx: Tx, fromDate: string) {
  const rows = await tx.select({ id: schema.leaveRequests.id, start: schema.leaveRequests.startDate, end: schema.leaveRequests.endDate,
      firstName: schema.people.firstName, lastName: schema.people.lastName, preferredName: schema.people.preferredName })
    .from(schema.leaveRequests)
    .innerJoin(schema.people, eq(schema.people.id, schema.leaveRequests.personId))
    .innerJoin(schema.workflowInstances, eq(schema.workflowInstances.id, schema.leaveRequests.workflowInstanceId))
    .where(and(eq(schema.workflowInstances.state, "approved"), gte(schema.leaveRequests.endDate, fromDate)));
  return rows.map(x => ({ id: x.id, name: displayName(x), start: x.start, end: x.end }));
}
