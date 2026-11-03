// Audit trail (doc 02 §7). Every command writes one row inside its own transaction.
import { schema, type Tx } from "@/lib/db";

export interface Actor { firmId: string; personId: string | null; kind: "person" | "operator" | "system"; supportSessionId?: string | null }

const SENSITIVE_KEYS = /id_?number|passport|bank|account|tax|date_?of_?birth|address|reason_?private/i;

export function redact(diff: Record<string, unknown> | undefined) {
  if (!diff) return null;
  return Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? "•••" : v]));
}

export async function audit(tx: Tx, actor: Actor, action: string, subjectType: string, subjectId: string | null, diff?: Record<string, unknown>) {
  await tx.insert(schema.auditEvents).values({
    firmId: actor.firmId, actorKind: actor.kind, actorId: actor.personId, supportSessionId: actor.supportSessionId ?? null,
    action, subjectType, subjectId, diff: redact(diff),
  });
}

export async function logAccess(tx: Tx, actor: Actor, resourceKind: string, resourceId: string | null, purpose: "view" | "download" | "export") {
  await tx.insert(schema.accessLog).values({ firmId: actor.firmId, actorId: actor.personId, resourceKind, resourceId, purpose });
}
