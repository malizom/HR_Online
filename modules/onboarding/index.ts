// Onboarding submit/complete through the workflow engine (doc 02 §4, ADR-07).
import { createProbation } from "../hr";
import { accruePerson, todayIn } from "../leave";
import { and, eq, isNull, ne } from "drizzle-orm";
import { schema, withFirm, type Tx } from "@/lib/db";
import { UserError } from "@/lib/storage";
import { enqueue } from "../notifications";
import { getInstance, startWorkflow, transition } from "../workflow/engine";
import { displayName } from "../people";
import type { Ctx } from "../identity/actor";

const STATUS_FROM_STATE = { draft: "draft", in_review: "in_review", complete: "complete" } as const;

async function instanceFor(tx: Tx, ctx: Ctx, personId: string, currentStatus: string) {
  return (await getInstance(tx, "person", personId))
    ?? startWorkflow(tx, ctx.actor, "onboarding", "person", personId, { initial: currentStatus === "in_review" ? "in_review" : currentStatus === "complete" ? "complete" : "draft" });
}

export async function submitOnboarding(ctx: Ctx, portalUrl: string) {
  if (ctx.person.role === "viewer") throw new UserError("Calendar viewers cannot make changes.", 403);
  if (["in_review", "complete"].includes(ctx.person.onboardingStatus)) throw new UserError("Onboarding has already been submitted.");
  if (!ctx.person.jobTitle || !ctx.person.startDate) throw new UserError("Complete your personal and employment details first.");
  await withFirm(ctx.firm.id, async tx => {
    const inst = await instanceFor(tx, ctx, ctx.person.id, ctx.person.onboardingStatus);
    const next = await transition(tx, { instance: inst, action: "submit", actor: ctx.actor, actorRole: ctx.person.role, ownerId: ctx.person.id });
    await tx.update(schema.people).set({ onboardingStatus: STATUS_FROM_STATE[next.state as keyof typeof STATUS_FROM_STATE], updatedAt: new Date() }).where(eq(schema.people.id, ctx.person.id));
    await tx.update(schema.onboardingChecklists).set({ submittedAt: new Date() }).where(eq(schema.onboardingChecklists.personId, ctx.person.id));
    const admins = await tx.select({ id: schema.people.id }).from(schema.people)
      .where(and(eq(schema.people.role, "admin"), eq(schema.people.status, "active"), isNull(schema.people.deactivatedAt), ne(schema.people.id, ctx.person.id)));
    for (const a of admins) await enqueue(tx, { firmId: ctx.firm.id, recipientId: a.id, templateKey: "onboarding.submitted",
      payload: { person: displayName(ctx.person), link: portalUrl }, dedupeKey: `onboarding-submitted:${ctx.person.id}:${a.id}` });
  });
}

export async function completeOnboarding(ctx: Ctx, personId: string) {
  if (ctx.person.role !== "admin") throw new UserError("Not allowed.", 403);
  await withFirm(ctx.firm.id, async tx => {
    const [p] = await tx.select().from(schema.people).where(eq(schema.people.id, personId));
    if (!p) throw new UserError("Person not found.", 404);
    if (p.onboardingStatus !== "in_review") throw new UserError("Only submissions in review can be completed.");
    const inst = await instanceFor(tx, ctx, p.id, p.onboardingStatus);
    // An admin completing their OWN onboarding is allowed only when they are the firm's sole admin (bootstrap).
    const ownerId = p.id === ctx.person.id && (await soleAdmin(tx, ctx.person.id)) ? "__bootstrap__" : p.id;
    await transition(tx, { instance: inst, action: "complete", actor: ctx.actor, actorRole: ctx.person.role, ownerId });
    // Completion creates balances (doc 05 §3). A missing start date defaults to today so the leave cycle has an anchor.
    const today = todayIn(ctx.firm.timezone);
    const [done] = await tx.update(schema.people).set({ onboardingStatus: "complete", employmentStatus: "active", startDate: p.startDate ?? today, updatedAt: new Date() })
      .where(eq(schema.people.id, p.id)).returning();
    await accruePerson(tx, ctx.firm.id, done, today);
    // H1: probation tracking starts at completion for new permanent and fixed-term staff.
    if (["permanent", "fixed_term"].includes(done.employmentType)) await createProbation(tx, ctx, done);
    await tx.insert(schema.employmentEvents).values({ firmId: ctx.firm.id, personId: done.id, kind: "hire", effectiveDate: done.startDate ?? today,
      summary: `Joined as ${done.jobTitle ?? "employee"}`, createdBy: ctx.person.id });
    await tx.update(schema.onboardingChecklists).set({ completedAt: new Date(), completedBy: ctx.person.id }).where(eq(schema.onboardingChecklists.personId, p.id));
    await enqueue(tx, { firmId: ctx.firm.id, recipientId: p.id, templateKey: "onboarding.complete", channels: ["email"],
      payload: { firm: ctx.firm.displayName }, dedupeKey: `onboarding-complete:${p.id}` });
  });
}

async function soleAdmin(tx: Tx, personId: string) {
  const admins = await tx.select({ id: schema.people.id }).from(schema.people)
    .where(and(eq(schema.people.role, "admin"), eq(schema.people.status, "active"), isNull(schema.people.deactivatedAt)));
  return admins.length === 1 && admins[0].id === personId;
}
