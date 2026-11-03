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
    personId: by("Ayanda").id, type: "annual", start: monday(-8), end: addDays(monday(-8), 4), note: "Family holiday",
    coverPersonId: by("Kagiso").id, coverItems: [{ matterRef: "LIT/2026/014", itemType: "filing_deadline", due: addDays(monday(-8), 2) }],
  }, URL);
  await decideLeave(ctx("Kagiso"), past.id, "accept_cover");
  await decideLeave(ctx("Lindiwe"), past.id, "approve");

  const sick = await requestLeave(ctx("Tamlyn"), { personId: by("Pieter").id, type: "sick", start: addDays(monday(-3), 1), end: addDays(monday(-3), 1) }, URL);
  await decideLeave(ctx("Johan"), sick.id, "approve");

  const fam = await requestLeave(ctx("Tamlyn"), { personId: by("Sarah").id, type: "family", start: addDays(monday(-5), 4), end: addDays(monday(-5), 4), reason: "Child ill" }, URL);
  await decideLeave(ctx("Lindiwe"), fam.id, "approve");

  // Sick leave needing a certificate (3 consecutive days) — waiting on the manager.
  await requestLeave(ctx("Tamlyn"), { personId: by("Ayanda").id, type: "sick", start: monday(-1), end: addDays(monday(-1), 2) }, URL);

  // Upcoming: approved with cover (shows on the calendar), pending approval, awaiting cover.
  const johan = await requestLeave(ctx("Johan"), {
    type: "annual", start: monday(4), end: addDays(monday(4), 4), note: "Year-end break", coverPersonId: by("Pieter").id,
    coverItems: [{ matterRef: "CONV/2026/221", itemType: "consultation", due: `${addDays(monday(4), 1)}T10:00`, location: "Boardroom 2" }],
  }, URL);
  await decideLeave(ctx("Pieter"), johan.id, "accept_cover");
  await decideLeave(ctx("Mpho"), johan.id, "approve");

  await requestLeave(ctx("Sarah"), { type: "annual", start: addDays(monday(3), 2), end: addDays(monday(3), 4), note: "Moving house" }, URL);
  await requestLeave(ctx("Kagiso"), {
    type: "annual", start: monday(5), end: addDays(monday(5), 1), startHalf: null, endHalf: "am", note: "Board exam preparation",
    coverPersonId: by("Ayanda").id, coverItems: [{ matterRef: "LIT/2026/031", itemType: "court_date", due: `${monday(5)}T09:30`, location: "Johannesburg High Court" }],
  }, URL);
  await requestLeave(ctx("Lindiwe"), { type: "annual", start: monday(6), end: addDays(monday(6), 2), coverPersonId: by("Ayanda").id }, URL).then(r => decideLeave(ctx("Ayanda"), r.id, "accept_cover"));
  await requestLeave(ctx("Mpho"), { type: "annual", start: addDays(monday(7), 3), end: addDays(monday(7), 4), coverPersonId: by("Lindiwe").id }, URL)
    .then(r => decideLeave(ctx("Lindiwe"), r.id, "accept_cover"));

  // Written particulars issued to everyone onboarded; most have acknowledged.
  for (const p of people.filter(x => x.onboardingStatus === "complete" || x.firstName === "Tamlyn")) {
    const doc = await issueParticulars(ctx("Tamlyn"), p.id);
    if (!["Kagiso", "Pieter"].includes(p.firstName)) await acknowledge(ctx(p.firstName), doc.id, { ip: "127.0.0.1", userAgent: "seed" });
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
