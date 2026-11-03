// Approvals follow the organogram (decision 3 Nov 2026) and the workflow engine enforces who may act.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { closeDb, schema, withFirm } from "@/lib/db";
import { ownerDb, provisionFirm } from "@/db/seed/provision";
import { resolveApprover } from "@/modules/workflow/routing";
import { allowedActions, startWorkflow, transition } from "@/modules/workflow/engine";

let firmId = "", admin = "", director = "", manager = "", staff = "", other = "", delegate = "";
const actor = (personId: string) => ({ firmId, personId, kind: "person" as const });

beforeAll(async () => {
  const { db, end } = ownerDb();
  const r = await provisionFirm(db, {
    slug: `rt-${crypto.randomBytes(4).toString("hex")}`, legalName: "Routing Test", displayName: "Routing Test", hosts: [`rt-${crypto.randomUUID()}.test`],
    admin: { firstName: "Hr", lastName: "Admin", email: `hr-${crypto.randomUUID()}@rt.test` },
  });
  firmId = r.firm.id; admin = r.adminId;
  await db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.firm_id', ${firmId}, true)`);
    const mk = async (first: string, reportsToId: string | null) => (await tx.insert(schema.people).values({
      firmId, firstName: first, lastName: "T", workEmail: `${first}-${crypto.randomUUID()}@rt.test`, reportsToId, onboardingStatus: "complete", employmentStatus: "active",
    }).returning())[0].id;
    director = await mk("Director", null);
    manager = await mk("Manager", director);
    staff = await mk("Staff", manager);
    other = await mk("Other", director);
    delegate = await mk("Delegate", director);
  });
  await end();
});
afterAll(async () => { await closeDb(); });

describe("approver routing (organogram)", () => {
  it("routes a staff member to their manager", async () => {
    const r = await withFirm(firmId, tx => resolveApprover(tx, "leave", staff, "2027-01-10"));
    expect(r).toMatchObject({ approverId: manager, via: "manager", onBehalfOfId: null });
  });

  it("routes a top-of-tree director to HR admin when no explicit route exists", async () => {
    const r = await withFirm(firmId, tx => resolveApprover(tx, "leave", director, "2027-01-10"));
    expect(r).toMatchObject({ approverId: admin, via: "fallback" });
  });

  it("uses an explicit route for a director when one is configured", async () => {
    await withFirm(firmId, tx => tx.insert(schema.approvalRoutes).values({ firmId, subjectType: "leave", scope: "person", scopeValue: director, approverKind: "person", approverValue: other }));
    const r = await withFirm(firmId, tx => resolveApprover(tx, "leave", director, "2027-01-10"));
    expect(r).toMatchObject({ approverId: other, via: "route" });
  });

  it("skips a deactivated manager", async () => {
    await withFirm(firmId, tx => tx.update(schema.people).set({ deactivatedAt: new Date() }).where(eq(schema.people.id, manager)));
    const r = await withFirm(firmId, tx => resolveApprover(tx, "leave", staff, "2027-01-10"));
    expect(r?.approverId).toBe(admin);
    await withFirm(firmId, tx => tx.update(schema.people).set({ deactivatedAt: null }).where(eq(schema.people.id, manager)));
  });

  it("substitutes an active delegate and records on whose behalf", async () => {
    await withFirm(firmId, tx => tx.insert(schema.delegations).values({ firmId, delegatorId: manager, delegateId: delegate, subjectTypes: ["leave"], startDate: "2027-01-01", endDate: "2027-01-31" }));
    const inWindow = await withFirm(firmId, tx => resolveApprover(tx, "leave", staff, "2027-01-15"));
    const outside = await withFirm(firmId, tx => resolveApprover(tx, "leave", staff, "2027-02-15"));
    expect(inWindow).toMatchObject({ approverId: delegate, onBehalfOfId: manager });
    expect(outside).toMatchObject({ approverId: manager, onBehalfOfId: null });
  });
});

describe("workflow engine", () => {
  const start = () => withFirm(firmId, tx => startWorkflow(tx, actor(staff), "leave_request", "leave_request", crypto.randomUUID(), { assigneeId: manager }));

  it("lets the assignee approve but never the requester", async () => {
    const inst = await start();
    expect(allowedActions(inst, manager, "staff", staff)).toEqual(["approve", "decline"]);
    expect(allowedActions(inst, staff, "staff", staff)).toEqual(["cancel"]);
    expect(allowedActions(inst, other, "staff", staff)).toEqual([]);
    expect(allowedActions(inst, admin, "admin", staff)).toEqual(["approve", "decline", "cancel"]);
  });

  it("refuses self-approval even by an admin", async () => {
    const inst = await withFirm(firmId, tx => startWorkflow(tx, actor(admin), "leave_request", "leave_request", crypto.randomUUID(), { assigneeId: director }));
    await expect(withFirm(firmId, tx => transition(tx, { instance: inst, action: "approve", actor: actor(admin), actorRole: "admin", ownerId: admin })))
      .rejects.toThrow(/Self-approval is disabled/);
  });

  it("records every step and lets only one of two concurrent approvers win", async () => {
    const inst = await start();
    const attempt = (who: string, role: string, action: string) => withFirm(firmId, tx =>
      transition(tx, { instance: inst, action, actor: actor(who), actorRole: role, ownerId: staff, comment: "x" })).then(() => "ok", e => e.message);
    const results = await Promise.all([attempt(manager, "staff", "approve"), attempt(admin, "admin", "decline")]);
    expect(results.filter(r => r === "ok")).toHaveLength(1);
    const steps = await withFirm(firmId, tx => tx.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.instanceId, inst.id)));
    expect(steps.map(s => s.action).sort()).toEqual(results[0] === "ok" ? ["approve", "start"] : ["decline", "start"]);
  });

  it("v2 cover step: colleague accepts, then the approver decides; declining cover needs a reason", async () => {
    const colleague = other;
    const inst = await withFirm(firmId, tx => startWorkflow(tx, actor(staff), "leave_request", "leave_request", crypto.randomUUID(), { assigneeId: colleague, initial: "awaiting_cover" }));
    expect(allowedActions(inst, colleague, "staff", staff)).toEqual(["accept_cover", "decline_cover"]);
    expect(allowedActions(inst, manager, "staff", staff)).toEqual([]);
    await expect(withFirm(firmId, tx => transition(tx, { instance: inst, action: "decline_cover", actor: actor(colleague), actorRole: "staff", ownerId: staff })))
      .rejects.toThrow(/comment is required/);
    const next = await withFirm(firmId, tx => transition(tx, { instance: inst, action: "accept_cover", actor: actor(colleague), actorRole: "staff", ownerId: staff, nextAssigneeId: manager }));
    expect(next.state).toBe("pending_approval");
    expect(allowedActions(next, manager, "staff", staff)).toEqual(["approve", "decline"]);
  });

  it("cannot move a terminal request", async () => {
    const inst = await start();
    const declined = await withFirm(firmId, tx => transition(tx, { instance: inst, action: "decline", actor: actor(manager), actorRole: "staff", ownerId: staff, comment: "Clashes with trial" }));
    await expect(withFirm(firmId, tx => transition(tx, { instance: declined, action: "approve", actor: actor(manager), actorRole: "staff", ownerId: staff })))
      .rejects.toThrow(/no longer/);
  });
});
