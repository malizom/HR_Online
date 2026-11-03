/**
 * Approver resolution — follows the organogram (decision 3 Nov 2026: managers approve; no approver role).
 *   1. the requester's manager (people.reports_to_id), if active;
 *   2. otherwise an explicit approval_routes row for that person (top-of-tree, e.g. a director);
 *   3. otherwise the HR administrator(s) — fallback.
 * An active delegation substitutes the delegate and records on whose behalf they act (feature R3).
 */
import { and, asc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/lib/db";

export interface Resolved { approverId: string; onBehalfOfId: string | null; via: "manager" | "route" | "fallback" }

const isActive = (p: { status: string; deactivatedAt: Date | null } | undefined) => !!p && p.status === "active" && !p.deactivatedAt;

export async function resolveApprover(tx: Tx, subjectType: string, requesterId: string, onDate: string): Promise<Resolved | null> {
  const { people, approvalRoutes } = schema;
  const [requester] = await tx.select().from(people).where(eq(people.id, requesterId));
  if (!requester) return null;

  let approverId: string | null = null;
  let via: Resolved["via"] = "fallback";

  if (requester.reportsToId) {
    const [mgr] = await tx.select().from(people).where(eq(people.id, requester.reportsToId));
    if (isActive(mgr)) { approverId = mgr.id; via = "manager"; }
  }

  if (!approverId) {
    const [route] = await tx.select().from(approvalRoutes)
      .where(and(eq(approvalRoutes.subjectType, subjectType), eq(approvalRoutes.scope, "person"), eq(approvalRoutes.scopeValue, requesterId), eq(approvalRoutes.approverKind, "person")))
      .orderBy(asc(approvalRoutes.priority)).limit(1);
    if (route?.approverValue && route.approverValue !== requesterId) { approverId = route.approverValue; via = "route"; }
  }

  if (!approverId) {
    const [admin] = await tx.select({ id: people.id }).from(people)
      .where(and(eq(people.role, "admin"), eq(people.status, "active"), isNull(people.deactivatedAt), ne(people.id, requesterId)))
      .orderBy(asc(people.createdAt)).limit(1);
    if (admin) approverId = admin.id;
  }
  if (!approverId) return null;

  // Delegation: the approver may have handed approvals to someone for this date.
  const [del] = await tx.select().from(schema.delegations).where(and(
    eq(schema.delegations.delegatorId, approverId), isNull(schema.delegations.revokedAt),
    lte(schema.delegations.startDate, onDate), gte(schema.delegations.endDate, onDate),
    sql`${subjectType} = any(${schema.delegations.subjectTypes})`,
  )).limit(1);
  if (del && del.delegateId !== requesterId) return { approverId: del.delegateId, onBehalfOfId: approverId, via };

  return { approverId, onBehalfOfId: null, via };
}

/** People who report to `managerId` (direct reports only). */
export async function directReportIds(tx: Tx, managerId: string): Promise<string[]> {
  const rows = await tx.select({ id: schema.people.id }).from(schema.people).where(eq(schema.people.reportsToId, managerId));
  return rows.map(r => r.id);
}
