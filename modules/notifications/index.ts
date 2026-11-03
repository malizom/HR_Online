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
  "document.rejected": p => ({ subject: "Please upload your document again", text: `HR could not accept ${p.file}.\n\nReason: ${p.reason}\n\nUpload a new copy in the People portal.` }),
  "ack.issued": p => ({ subject: `${p.title} — please read and acknowledge`, text: `${p.firm} has issued your ${p.title}. Please read it and acknowledge receipt in the People portal.` }),
  "leave.reminder": p => ({ subject: `Reminder: leave request from ${p.requester} is waiting`, text: `${p.requester}'s ${p.type} leave from ${p.start} to ${p.end} has been waiting for your decision for 3 working days.\n\n${p.link}` }),
  "leave.escalated": p => ({ subject: `Leave request waiting 5 working days: ${p.requester}`, text: `${p.requester}'s ${p.type} leave from ${p.start} to ${p.end} has not been decided after 5 working days. It is still with ${p.approver}. Nothing is approved automatically.\n\n${p.link}` }),
  "leave.cancelled": p => ({ subject: `Leave cancelled: ${p.requester}`, text: `${p.requester}'s ${p.type} leave from ${p.start} to ${p.end} has been cancelled.` }),
  "leave.approved.cover": p => ({ subject: `You are covering for ${p.requester}`, text: `${p.requester}'s ${p.type} leave from ${p.start} to ${p.end} was approved. You agreed to cover their matters; they will confirm the handover before they go.\n\n${p.link}` }),
  "cover.requested": p => ({ subject: `${p.requester} asked you to cover while they are away`, text: `${p.requester} has asked you to cover their matters during ${p.type} leave from ${p.start} to ${p.end} (${p.days} working days).\n\nAccept or decline in the People portal: ${p.link}` }),
  "cover.declined": p => ({ subject: "Your cover request was declined", text: `${p.by} cannot cover your matters from ${p.start} to ${p.end}.${p.comment ? `\n\nReason: ${p.comment}` : ""}\n\nNominate another colleague in the People portal: ${p.link}` }),
  "handover.due": p => ({ subject: "Confirm your handover", text: `Your ${p.type} leave starts ${p.start}. Please confirm that your matters have been handed over to your covering colleague.\n\n${p.link}` }),
  "balance.forfeit_proposal": p => ({ subject: `Leave forfeiture to review: ${p.person}`, text: `${p.person} has ${p.days} days of ${p.type} leave ${p.why} (${p.cycleEnd}). Nothing has been removed. Confirm forfeiture in the People portal only if they had a reasonable opportunity to take it.` }),
  "leave.approved": p => ({ subject: "Your leave was approved", text: `Your ${p.type} leave from ${p.start} to ${p.end} was approved by ${p.by}.` }),
  "leave.declined": p => ({ subject: "Your leave was declined", text: `Your ${p.type} leave from ${p.start} to ${p.end} was declined by ${p.by}.${p.comment ? `\n\nComment: ${p.comment}` : ""}` }),
  "onboarding.submitted": p => ({ subject: `${p.person} submitted onboarding for review`, text: `${p.person} has submitted their onboarding details and documents for HR review.\n\n${p.link}` }),
  "onboarding.complete": p => ({ subject: "Welcome — your onboarding is complete", text: `Your onboarding at ${p.firm} is complete. You can now request leave in the People portal.` }),
  "onboarding.invite": p => ({ subject: `Welcome to ${p.firm} — complete your onboarding`, text: `Hi ${p.person},\n\nPlease sign in with your work Microsoft account and complete your onboarding:\n${p.link}\n\nHave ready: your CV, ID, proof of banking and qualifications.` }),
  // Later releases (R2/R3)
  "request.submitted": p => ({ subject: `${p.kind} from ${p.requester}`, text: `${p.requester} submitted a ${p.kind}: ${p.title}.\n\nReview it in the People portal.` }),
  "request.updated": p => ({ subject: `Your ${p.kind} is ${p.state}`, text: `Your ${p.kind} (${p.title}) is now ${p.state} — ${p.by}.${p.comment ? `\n\n${p.comment}` : ""}` }),
  "review.started": p => ({ subject: `${p.period} has started`, text: `Your ${p.period} has started. Please complete your self-assessment by ${p.due}.` }),
  "asset.assigned": p => ({ subject: "Equipment issued to you", text: `${p.what} has been issued to you. Please confirm receipt in the People portal.` }),
  "handover.offboarding": p => ({ subject: `Matter handover from ${p.from}`, text: `${p.from} is leaving the firm and has handed over ${p.matter} to you. Please accept the handover in the People portal.` }),
  "credential.expiring": p => ({ subject: `${p.what} ${p.lapsed ? "has lapsed" : "expires soon"}: ${p.person}`, text: `${p.person}'s ${p.what} ${p.lapsed ? "lapsed on" : "expires on"} ${p.when}. Upload the renewed certificate in the People portal.` }),
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
