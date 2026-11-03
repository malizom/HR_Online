/**
 * Demo activity: leave history, pending approvals, cover requests and balances, created through the real
 * domain commands (so every number is engine-computed and every row is audited). Dates are relative to the
 * day the seed runs, so the demo always looks current.
 */
import { eq } from "drizzle-orm";
import { platformDb, schema, withFirm } from "@/lib/db";
import type { Ctx } from "@/modules/identity/actor";
import { accrueAll, decideLeave, requestLeave, rebuildBalances, todayIn } from "@/modules/leave";
import { acknowledge, issueParticulars } from "@/modules/admin";
import { putBytes } from "@/lib/storage";
import { addDays, weekday } from "@/modules/leave/engine";

const URL = "http://demo.localhost:3000/";

/** Jobs entry: seed once, only for demo firms (DEMO_FIRMS), and only while the firm has no leave yet. */
export async function seedDemoIfEmpty(firm: { id: string; slug: string }) {
  const demo = (process.env.DEMO_FIRMS ?? "").split(",").map(s => s.trim()).includes(firm.slug);
  if (!demo) return { skipped: "not a demo firm" };
  const [any] = await withFirm(firm.id, tx => tx.select({ id: schema.leaveRequests.id }).from(schema.leaveRequests).limit(1));
  if (any) return { skipped: "already seeded" };
  await seedDemoActivity(firm.id);
  return { seeded: true };
}

export async function seedDemoActivity(firmId: string) {
  const [firm] = await platformDb.select().from(schema.firms).where(eq(schema.firms.id, firmId));
  const people = await withFirm(firmId, tx => tx.select().from(schema.people));
  const by = (first: string) => people.find(p => p.firstName === first)!;
  const ctx = (first: string): Ctx => {
    const person = by(first);
    return { firm, person, actor: { firmId, personId: person.id, kind: "person" }, isManager: person.role === "manager" };
  };
  const today = todayIn(firm.timezone);
  const monday = (weeks: number) => addDays(today, 7 * weeks - (weekday(today) - 1));

  await accrueAll(firmId, today);

  // History (raised by HR on behalf, so the notice rule warns instead of refusing).
  const past = await requestLeave(ctx("Tamlyn"), {
    personId: by("Ivan").id, type: "annual", start: monday(-8), end: addDays(monday(-8), 4), note: "Family holiday",
    coverPersonId: by("Muano").id, coverItems: [{ matterRef: "LIT/2026/014", itemType: "filing_deadline", due: addDays(monday(-8), 2) }],
  }, URL);
  await decideLeave(ctx("Muano"), past.id, "accept_cover");
  await decideLeave(ctx("Robyn"), past.id, "approve");

  const tana = await requestLeave(ctx("Tamlyn"), { personId: by("Tana").id, type: "annual", start: monday(-4), end: addDays(monday(-4), 2),
    coverPersonId: by("Tumelo").id }, URL);
  await decideLeave(ctx("Tumelo"), tana.id, "accept_cover");
  await decideLeave(ctx("Maphanga"), tana.id, "approve");

  // Sensitive scenarios — fictional people only.
  const sick = await requestLeave(ctx("Tamlyn"), { personId: by("Pieter").id, type: "sick", start: addDays(monday(-3), 1), end: addDays(monday(-3), 1) }, URL);
  await decideLeave(ctx("Eduan"), sick.id, "approve");
  const fam = await requestLeave(ctx("Tamlyn"), { personId: by("Sarah").id, type: "family", start: addDays(monday(-5), 4), end: addDays(monday(-5), 4), reason: "Child ill" }, URL);
  await decideLeave(ctx("Robyn"), fam.id, "approve");
  await requestLeave(ctx("Tamlyn"), { personId: by("Sarah").id, type: "sick", start: monday(-1), end: addDays(monday(-1), 2) }, URL);

  // Upcoming: approved with cover (on the calendar), pending approval, awaiting cover.
  const eduan = await requestLeave(ctx("Eduan"), {
    type: "annual", start: monday(4), end: addDays(monday(4), 4), note: "Year-end break", coverPersonId: by("Siyabonga").id,
    coverItems: [{ matterRef: "BF/2026/221", itemType: "consultation", due: `${addDays(monday(4), 1)}T10:00`, location: "Boardroom 2" }],
  }, URL);
  await decideLeave(ctx("Siyabonga"), eduan.id, "accept_cover");
  await decideLeave(ctx("Matodzi"), eduan.id, "approve");

  await requestLeave(ctx("Sarah"), { type: "annual", start: addDays(monday(3), 2), end: addDays(monday(3), 4), note: "Moving house" }, URL);
  await requestLeave(ctx("Muano"), {
    type: "annual", start: monday(5), end: addDays(monday(5), 1), startHalf: null, endHalf: "am", note: "Board exam preparation",
    coverPersonId: by("Ivan").id, coverItems: [{ matterRef: "LIT/2026/031", itemType: "court_date", due: `${monday(5)}T09:30`, location: "Johannesburg High Court" }],
  }, URL);
  await requestLeave(ctx("Malaika"), { type: "annual", start: monday(6), end: addDays(monday(6), 1), coverPersonId: by("Mashudu").id }, URL)
    .then(r => decideLeave(ctx("Mashudu"), r.id, "accept_cover"));
  await requestLeave(ctx("Robyn"), { type: "annual", start: monday(6), end: addDays(monday(6), 2), coverPersonId: by("Ivan").id }, URL).then(r => decideLeave(ctx("Ivan"), r.id, "accept_cover"));
  await requestLeave(ctx("Matodzi"), { type: "annual", start: addDays(monday(7), 3), end: addDays(monday(7), 4), coverPersonId: by("Robyn").id }, URL)
    .then(r => decideLeave(ctx("Robyn"), r.id, "accept_cover"));

  // Written particulars issued to everyone onboarded; most have acknowledged.
  for (const p of people.filter(x => x.onboardingStatus === "complete" || x.firstName === "Tamlyn")) {
    const doc = await issueParticulars(ctx("Tamlyn"), p.id);
    if (!["Siyabonga", "Pieter"].includes(p.firstName)) await acknowledge(ctx(p.firstName), doc.id, { ip: "127.0.0.1", userAgent: "seed" });
  }

  // A newly invited associate has submitted details and an ID document that HR has not yet reviewed.
  const thabo = by("Thabo");
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const blobPath = `${firmId}/${thabo.id}/demo-id.pdf`;
  await putBytes(firmId, blobPath, pdf, "application/pdf");
  await withFirm(firmId, async tx => {
    const [cat] = await tx.select().from(schema.documentCategories).where(eq(schema.documentCategories.code, "CV"));
    await tx.insert(schema.documents).values({ firmId, personId: thabo.id, categoryId: cat.id, fileName: "Thabo-Newstarter-CV.pdf", mime: "application/pdf",
      sizeBytes: pdf.length, blobPath, sha256: "demo" });
  });

  await rebuildBalances(firmId, today);
}
