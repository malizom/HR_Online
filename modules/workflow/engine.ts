/**
 * Generic workflow engine (ADR-07). Business state lives here; subjects (leave requests, onboarding…)
 * reference their instance. Every transition is permission-checked, recorded in workflow_steps and audited.
 */
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/lib/db";
import { UserError } from "@/lib/storage";
import { audit, type Actor } from "../audit";
import { definition } from "./definitions";

export type Instance = typeof schema.workflowInstances.$inferSelect;

export async function startWorkflow(tx: Tx, actor: Actor, key: string, subjectType: string, subjectId: string,
  opts: { assigneeId?: string | null; context?: Record<string, unknown>; initial?: string } = {}): Promise<Instance> {
  const def = definition(key);
  const state = opts.initial ?? def.initial;
  const [inst] = await tx.insert(schema.workflowInstances).values({
    firmId: actor.firmId, definitionKey: key, definitionVersion: def.version, subjectType, subjectId,
    state, assigneeId: opts.assigneeId ?? null, context: opts.context ?? {},
  }).returning();
  await tx.insert(schema.workflowSteps).values({ firmId: actor.firmId, instanceId: inst.id, fromState: null, toState: state, action: "start", actorId: actor.personId });
  await audit(tx, actor, `${key}.start`, subjectType, subjectId, { state, assigneeId: opts.assigneeId ?? null });
  return inst;
}

export async function getInstance(tx: Tx, subjectType: string, subjectId: string): Promise<Instance | null> {
  const [i] = await tx.select().from(schema.workflowInstances)
    .where(and(eq(schema.workflowInstances.subjectType, subjectType), eq(schema.workflowInstances.subjectId, subjectId)));
  return i ?? null;
}

export interface TransitionInput {
  instance: Instance; action: string; actor: Actor; actorRole: string; ownerId: string;
  comment?: string | null; onBehalfOfId?: string | null; nextAssigneeId?: string | null;
}

/** Which actions may this actor take on this instance right now? Used by both the server and the UI. */
export function allowedActions(instance: Instance, actorId: string, actorRole: string, ownerId: string): string[] {
  const def = definition(instance.definitionKey);
  return def.transitions.filter(t => t.from.includes(instance.state) && t.who.some(w =>
    (w === "owner" && actorId === ownerId) ||
    (w === "assignee" && actorId === instance.assigneeId && actorId !== ownerId) ||
    (w === "admin" && actorRole === "admin" && actorId !== ownerId),
  )).map(t => t.action);
}

export async function transition(tx: Tx, input: TransitionInput): Promise<Instance> {
  const { instance, action, actor } = input;
  const def = definition(instance.definitionKey);
  const t = def.transitions.find(x => x.action === action && x.from.includes(instance.state));
  if (!t) throw new UserError(`This item can no longer be ${action === "cancel" ? "cancelled" : action + "d"}.`);
  if (!actor.personId || !allowedActions(instance, actor.personId, input.actorRole, input.ownerId).includes(action)) {
    throw new UserError(input.ownerId === actor.personId && action !== "cancel" && action !== "submit"
      ? "Self-approval is disabled." : "You are not allowed to do that.", 403);
  }
  if (t.requiresComment && !input.comment?.trim()) throw new UserError("A comment is required.");

  // Optimistic guard: only move from the state we read (concurrent approvers cannot both win).
  const [updated] = await tx.update(schema.workflowInstances).set({
    state: t.to, assigneeId: input.nextAssigneeId !== undefined ? input.nextAssigneeId : instance.assigneeId,
    closedAt: def.terminal.includes(t.to) ? new Date() : null, updatedAt: new Date(),
  }).where(and(eq(schema.workflowInstances.id, instance.id), eq(schema.workflowInstances.state, instance.state))).returning();
  if (!updated) throw new UserError("This item was changed by someone else. Please refresh.", 409);

  await tx.insert(schema.workflowSteps).values({
    firmId: actor.firmId, instanceId: instance.id, fromState: instance.state, toState: t.to, action,
    actorId: actor.personId, onBehalfOfId: input.onBehalfOfId ?? null, comment: input.comment ?? null,
  });
  await audit(tx, actor, `${instance.definitionKey}.${action}`, instance.subjectType, instance.subjectId, { from: instance.state, to: t.to });
  return updated;
}
