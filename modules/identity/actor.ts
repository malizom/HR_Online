/**
 * The current actor for a request: firm (from host) + person (from session), re-validated on every request.
 * A session minted on firm A's domain is rejected on firm B's domain.
 */
import { and, eq, isNull } from "drizzle-orm";
import { schema, withFirm } from "@/lib/db";
import { currentFirm, type Firm } from "@/lib/tenancy";
import type { Person } from "@/db/schema";
import type { Actor } from "../audit";
import { auth } from "./auth";

export interface Ctx { firm: Firm; person: Person; actor: Actor; isManager: boolean }

export async function currentCtx(): Promise<Ctx | null> {
  const firm = await currentFirm();
  if (!firm) return null;
  const session = await auth();
  const s = session as unknown as { personId?: string; firmId?: string } | null;
  if (!s?.personId || s.firmId !== firm.id) return null;

  return withFirm(firm.id, async tx => {
    const [person] = await tx.select().from(schema.people)
      .where(and(eq(schema.people.id, s.personId!), eq(schema.people.status, "active"), isNull(schema.people.deactivatedAt)));
    if (!person) return null;
    const [report] = await tx.select({ id: schema.people.id }).from(schema.people).where(eq(schema.people.reportsToId, person.id)).limit(1);
    return {
      firm, person, isManager: !!report || person.role === "manager",
      actor: { firmId: firm.id, personId: person.id, kind: "person" as const },
    };
  });
}
