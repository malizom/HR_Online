/**
 * Notifications engine (doc 01 §4; feature M4 pulled into R1). Commands enqueue inside their transaction;
 * the dispatcher (jobs/dispatch-notifications) sends due rows. Reminders = notifications with a future send_after.
 */
import { and, eq, like, lte, sql } from "drizzle-orm";
import { schema, withFirm, type Tx } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import type { Firm } from "@/lib/tenancy";

export interface Enqueue {
  firmId: string; recipientId: string; templateKey: string; payload: Record<string, unknown>;
  dedupeKey: string; sendAfter?: Date; channels?: ("email" | "in_app")[];
}

export async function enqueue(tx: Tx, n: Enqueue) {
  for (const channel of n.channels ?? ["email", "in_app"]) {
    await tx.insert(schema.notifications).values({
      firmId: n.firmId, recipientId: n.recipientId, templateKey: n.templateKey, channel, payload: n.payload,
      sendAfter: n.sendAfter ?? new Date(), dedupeKey: `${n.dedupeKey}:${channel}`,
    }).onConflictDoNothing();
  }
}

/** Cancel queued notifications whose dedupe key starts with prefix (e.g. reminders for a cancelled request). */
export async function cancelQueued(tx: Tx, prefix: string) {
  await tx.update(schema.notifications).set({ status: "cancelled" })
    .where(and(eq(schema.notifications.status, "queued"), like(schema.notifications.dedupeKey, `${prefix}%`)));
}

/** Built-in templates; firms override via notification_templates (R1 S2). */
const TEMPLATES: Record<string, (p: Record<string, any>) => { subject: string; text: string }> = {
  "leave.submitted": p => ({ subject: `Leave request from ${p.requester}`, text: `${p.requester} has requested ${p.type} leave from ${p.start} to ${p.end}.\n\nReview it in the People portal: ${p.link}` }),
  "leave.approved": p => ({ subject: "Your leave was approved", text: `Your ${p.type} leave from ${p.start} to ${p.end} was approved by ${p.by}.` }),
  "leave.declined": p => ({ subject: "Your leave was declined", text: `Your ${p.type} leave from ${p.start} to ${p.end} was declined by ${p.by}.${p.comment ? `\n\nComment: ${p.comment}` : ""}` }),
  "onboarding.submitted": p => ({ subject: `${p.person} submitted onboarding for review`, text: `${p.person} has submitted their onboarding details and documents for HR review.\n\n${p.link}` }),
  "onboarding.complete": p => ({ subject: "Welcome — your onboarding is complete", text: `Your onboarding at ${p.firm} is complete. You can now request leave in the People portal.` }),
  "onboarding.invite": p => ({ subject: `Welcome to ${p.firm} — complete your onboarding`, text: `Hi ${p.person},\n\nPlease sign in with your work Microsoft account and complete your onboarding:\n${p.link}\n\nHave ready: your CV, ID, proof of banking and qualifications.` }),
};

export function render(templateKey: string, payload: Record<string, unknown>) {
  const t = TEMPLATES[templateKey];
  if (!t) throw new Error(`No template ${templateKey}`);
  return t(payload);
}

/** Send due email notifications for one firm. Returns counts. Idempotent: rows move queued -> sent/failed once. */
export async function dispatchDue(firm: Firm, limit = 100) {
  const stats = { sent: 0, failed: 0 };
  const due = await withFirm(firm.id, tx => tx.select({ n: schema.notifications, email: schema.people.workEmail })
    .from(schema.notifications).innerJoin(schema.people, eq(schema.people.id, schema.notifications.recipientId))
    .where(and(eq(schema.notifications.status, "queued"), eq(schema.notifications.channel, "email"), lte(schema.notifications.sendAfter, sql`now()`)))
    .limit(limit));
  for (const { n, email } of due) {
    try {
      const msg = render(n.templateKey, n.payload as Record<string, unknown>);
      const r = await sendMail(firm, { to: email, ...msg });
      await withFirm(firm.id, tx => tx.update(schema.notifications).set({ status: "sent", sentAt: new Date(), providerMessageId: r.providerMessageId }).where(eq(schema.notifications.id, n.id)));
      stats.sent++;
    } catch (e: any) {
      await withFirm(firm.id, tx => tx.update(schema.notifications).set({ status: "failed", error: String(e.message).slice(0, 500) }).where(eq(schema.notifications.id, n.id)));
      stats.failed++;
    }
  }
  return stats;
}
