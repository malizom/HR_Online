/**
 * Demo data for the full employee profile and the later-release features (R2/R3), created through the real commands so
 * workflows, letters, audit and notifications behave exactly as in the product. Real names (public team page) only
 * carry neutral or positive records; anything negative (a lapsed credential, a grievance, a resignation, private
 * identity and banking details) is on clearly fictional staff.
 */
import type { Ctx } from "@/modules/identity/actor";
import * as hr from "@/modules/hr";
import { acknowledge } from "@/modules/admin";
import { addDays, weekday } from "@/modules/leave/engine";
import { withFirm, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

type Who = (first: string) => Ctx;

export async function seedDemoHr(firmId: string, ctx: Who, today: string) {
  const id = (first: string) => ctx(first).person.id;
  const hrCtx = ctx("Tamlyn");
  const monday = (weeks: number) => addDays(today, 7 * weeks - (weekday(today) - 1));
  const year = today.slice(0, 4);

  // ---------------------------------------------------------------- D1/D3: personal details (fictional staff only)
  await hr.updateContact(ctx("Sarah"), id("Sarah"), { address: "14 Example Road, Parkhurst, Johannesburg (fictional)",
    emergencyName: "Daniel Secretary", emergencyRelationship: "Spouse", emergencyPhone: "+27 82 555 0144" });
  await hr.updateSensitive(hrCtx, id("Sarah"), { idNumber: "8805120123087", nationality: "South African", dateOfBirth: "1988-05-12", taxNumber: "0123456789",
    bankName: "Example Bank", bankAccountType: "Cheque", bankAccount: "62012345678", branchCode: "250655" });
  await hr.updateContact(ctx("Pieter"), id("Pieter"), { address: "3 Sample Street, Brixton, Johannesburg (fictional)",
    emergencyName: "Anna Paralegal", emergencyRelationship: "Mother", emergencyPhone: "+27 83 555 0177" });
  await hr.updateSensitive(hrCtx, id("Pieter"), { passportNo: "A00000000", nationality: "Namibian", permitExpiry: addDays(today, 75), dateOfBirth: "1994-09-30",
    taxNumber: "0987654321", bankName: "Example Bank", bankAccountType: "Savings", bankAccount: "10012345678", branchCode: "198765" });

  // ---------------------------------------------------------------- D2: employment history
  const hires: [string, string, string][] = [
    ["Matodzi", "2015-03-01", "Founded the firm as Managing Director"], ["Tamlyn", "2023-03-01", "Joined as Office Manager"],
    ["Robyn", "2018-01-15", "Joined as Senior Associate"], ["Eduan", "2019-06-01", "Joined as Executive: Banking & Finance"],
    ["Ivan", "2022-02-01", "Joined as Candidate Attorney"], ["Tana", "2023-01-09", "Joined as Associate"],
    ["Muano", "2026-02-02", "Joined as Candidate Attorney"], ["Sarah", "2024-02-01", "Joined as Legal Secretary"], ["Pieter", "2024-02-01", "Joined as Paralegal (full time)"],
  ];
  for (const [first, date, summary] of hires) await hr.addEmploymentEvent(hrCtx, { personId: id(first), kind: "hire", effectiveDate: date, summary });
  await hr.addEmploymentEvent(hrCtx, { personId: id("Robyn"), kind: "promotion", effectiveDate: "2021-03-01", summary: "Senior Associate → Executive: Dispute Resolution" });
  await hr.addEmploymentEvent(hrCtx, { personId: id("Ivan"), kind: "promotion", effectiveDate: "2024-03-01", summary: "Candidate Attorney → Associate (admitted as an attorney)" });
  await hr.addEmploymentEvent(hrCtx, { personId: id("Tana"), kind: "transfer", effectiveDate: "2025-01-06", summary: "Department: Corporate & Commercial → Competition & Regulatory" });
  await hr.addEmploymentEvent(hrCtx, { personId: id("Pieter"), kind: "pattern_change", effectiveDate: "2025-07-01", summary: "Work pattern: Mon–Fri → Mon–Thu (part time)" });
  await hr.addEmploymentEvent(hrCtx, { personId: id("Pieter"), kind: "type_change", effectiveDate: "2025-07-01", summary: "Employment type: permanent → part time" });

  // ---------------------------------------------------------------- F1–F5: credentials
  const attorneys = ["Matodzi", "Robyn", "Eduan", "Fair", "Mashudu", "Maphanga", "Nonkosi", "Ivan", "Tana", "Tumelo"];
  for (const [i, first] of attorneys.entries()) {
    await hr.addCredential(hrCtx, { personId: id(first), kind: "lpc_admission", title: "Admitted as an attorney of the High Court", reference: `LPC-${41000 + i * 37}`, issuedOn: `${2008 + (i % 12)}-0${1 + (i % 8)}-15` });
    if (i < 7) await hr.addCredential(hrCtx, { personId: id(first), kind: "fidelity_fund", title: `Fidelity Fund Certificate ${year}`, reference: `FFC-${year}-${2200 + i}`, issuedOn: `${year}-01-01`, expiresOn: `${year}-12-31` });
    await hr.addCredential(ctx(first), { kind: "cpd", title: ["LSSA ethics update", "Practice management seminar", "Competition Act amendments webinar"][i % 3], provider: "LSSA", issuedOn: addDays(today, -30 - i * 11), hours: 2 + (i % 4) * 1.5 });
    await hr.addCredential(ctx(first), { kind: "fica_training", title: "FICA / RMCP annual training", provider: "MVR compliance", issuedOn: addDays(today, -200 + i), expiresOn: addDays(today, 165 + i) });
  }
  await hr.addCredential(hrCtx, { personId: id("Robyn"), kind: "right_of_appearance", title: "Right of appearance in the High Court", reference: "ROA-2016-118", issuedOn: "2016-05-20" });
  await hr.addCredential(hrCtx, { personId: id("Eduan"), kind: "conveyancer", title: "Admitted as a conveyancer", reference: "CONV-2012-77", issuedOn: "2012-08-01" });
  await hr.addCredential(hrCtx, { personId: id("Ivan"), kind: "commissioner_of_oaths", title: "Commissioner of oaths (ex officio)", issuedOn: "2024-03-01" });
  // Candidate attorneys: PVT contracts and board exams (F3).
  for (const first of ["Muano", "Malaika", "Siyabonga"]) {
    await hr.addCredential(hrCtx, { personId: id(first), kind: "pvt_contract", title: "Practical vocational training contract (24 months)", reference: `PVT-${first.toUpperCase()}-2026`, issuedOn: "2026-02-02", expiresOn: "2028-02-01", details: { status: "Registered with the LPC" } });
  }
  await hr.addCredential(hrCtx, { personId: id("Muano"), kind: "board_exam", title: "Board exams — Practice & Procedure, Wills & Estates", issuedOn: addDays(today, -60), details: { result: "2 of 4 papers passed" } });
  await hr.addCredential(ctx("Siyabonga"), { kind: "course", title: "School for Legal Practice (part time)", provider: "LEAD", issuedOn: "2026-03-01" });
  await hr.addCredential(ctx("Tiyiselani"), { kind: "cpd", title: "Administrative law update", provider: "LSSA", issuedOn: addDays(today, -45), hours: 4 });
  // Everyone with a real name has current FICA training; only fictional staff show gaps.
  for (const first of ["Tiyiselani", "Muano", "Malaika", "Siyabonga", "Tamlyn"])
    await hr.addCredential(ctx(first), { kind: "fica_training", title: "FICA / RMCP annual training", provider: "MVR compliance", issuedOn: addDays(today, -90), expiresOn: addDays(today, 275) });
  // Fictional: a lapsed FICA certificate and a work permit expiring soon (shown from the person file).
  await hr.addCredential(ctx("Pieter"), { kind: "fica_training", title: "FICA / RMCP annual training", provider: "MVR compliance", issuedOn: addDays(today, -400), expiresOn: addDays(today, -35) });

  // ---------------------------------------------------------------- E1/E3/I2/K1/M1/G4: requests
  const court = await hr.createRequest(ctx("Ivan"), { kind: "work_arrangement", title: "Court attendance", dateFrom: monday(0), dateTo: addDays(monday(0), 1), matterRef: "LIT/2026/031", details: { mode: "court", where: "Johannesburg High Court" } });
  await hr.decideRequest(ctx("Robyn"), court.id, "approve");
  const remote = await hr.createRequest(ctx("Tana"), { kind: "work_arrangement", title: "Remote work", dateFrom: addDays(monday(0), 4), dateTo: addDays(monday(0), 4), details: { mode: "remote" } });
  await hr.decideRequest(ctx("Maphanga"), remote.id, "approve");
  const court2 = await hr.createRequest(ctx("Robyn"), { kind: "work_arrangement", title: "Court attendance", dateFrom: addDays(monday(0), 2), dateTo: addDays(monday(0), 2), details: { mode: "court", where: "Labour Court, Braamfontein" } });
  await hr.decideRequest(ctx("Matodzi"), court2.id, "approve");
  await hr.createRequest(ctx("Sarah"), { kind: "overtime", title: "Trial bundle preparation", dateFrom: addDays(today, -3), hours: 3.5, matterRef: "LIT/2026/031", details: { reason: "Indexing and paginating the trial bundle" } });
  const exp = await hr.createRequest(ctx("Siyabonga"), { kind: "expense", title: "Travel to client (km)", dateFrom: addDays(today, -9), amount: 412.8, matterRef: "BF/2026/221", details: { category: "Travel (km)" } });
  await hr.decideRequest(ctx("Eduan"), exp.id, "approve");
  const exp2 = await hr.createRequest(ctx("Ivan"), { kind: "expense", title: "Court filing fees", dateFrom: addDays(today, -20), amount: 1250, matterRef: "LIT/2026/014", details: { category: "Court fees" } });
  await hr.decideRequest(ctx("Robyn"), exp2.id, "approve");
  await hr.decideRequest(hrCtx, exp2.id, "mark_paid");
  const trn = await hr.createRequest(ctx("Muano"), { kind: "training", title: "Advanced litigation skills course", amount: 3800, dateFrom: monday(8), details: { course: "Advanced litigation skills course", provider: "LSSA", reason: "Prepares for the remaining board exams." } });
  await hr.decideRequest(ctx("Robyn"), trn.id, "approve_manager");
  const letter = await hr.createRequest(ctx("Tumelo"), { kind: "employment_letter", details: { purpose: "Home-loan application" } });
  await hr.decideRequest(hrCtx, letter.id, "start");
  await hr.decideRequest(hrCtx, letter.id, "complete", undefined, "Your letter is ready to download.");
  await hr.createRequest(ctx("Malaika"), { kind: "hr_query", title: "Study leave for board exams", details: { subject: "Study leave for board exams", message: "How many days of study leave can I take before the February sitting?" } });
  const coi = await hr.createRequest(ctx("Tumelo"), { kind: "coi_declaration", title: "Director of a family trust", details: { party: "Mootane Family Trust", nature: "Trustee; no matters with the firm" } });
  await hr.decideRequest(ctx("Nonkosi"), coi.id, "approve");

  // ---------------------------------------------------------------- H1–H3: probation and reviews
  const muanoProb = await hr.startReview(hrCtx, { personId: id("Muano"), kind: "probation" });
  for (const m of [0, 1, 2]) await hr.reviewAction(ctx("Robyn"), muanoProb.id, { action: "milestone", milestone: m });
  await hr.reviewAction(hrCtx, muanoProb.id, { action: "confirm" });
  const malProb = await hr.startReview(hrCtx, { personId: id("Malaika"), kind: "probation" });
  await withFirm(firmId, tx => tx.update(schema.reviews).set({ dueDate: addDays(today, 9), periodEnd: addDays(today, 16) }).where(eq(schema.reviews.id, malProb.id)));
  await hr.reviewAction(ctx("Fair"), malProb.id, { action: "milestone", milestone: 0 });
  await hr.reviewAction(ctx("Fair"), malProb.id, { action: "milestone", milestone: 1 });

  const ivanRev = await hr.startReview(ctx("Robyn"), { personId: id("Ivan"), kind: "annual", periodLabel: `${year} annual review`, dueDate: addDays(today, 12) });
  await hr.reviewAction(ctx("Ivan"), ivanRev.id, { action: "submit_self", selfAssessment: "Ran two trials to judgment and took over the LIT/2026/014 matter. I want more exposure to arbitration.",
    goals: [{ goal: "First-chair an arbitration", measure: "Lead counsel on one matter by Q3", training: "AFSA arbitration course" }] });
  await hr.startReview(ctx("Maphanga"), { personId: id("Tana"), kind: "annual", periodLabel: `${year} annual review`, dueDate: addDays(today, 20) });
  const sarahRev = await hr.startReview(ctx("Robyn"), { personId: id("Sarah"), kind: "annual", periodLabel: `${Number(year) - 1} annual review`, periodStart: `${Number(year) - 1}-01-01`, periodEnd: `${Number(year) - 1}-12-31`, dueDate: `${year}-02-28` });
  await hr.reviewAction(ctx("Sarah"), sarahRev.id, { action: "submit_self", selfAssessment: "Took over the trial bundles and the new filing system." });
  await hr.reviewAction(ctx("Robyn"), sarahRev.id, { action: "submit_feedback", managerFeedback: "Reliable and well organised; the bundles were excellent.", rating: 4,
    goals: [{ goal: "Learn CaseLines e-filing", measure: "File independently by June", training: "CaseLines training" }] });
  await hr.reviewAction(ctx("Sarah"), sarahRev.id, { action: "acknowledge" });

  // ---------------------------------------------------------------- J1/J2: assets
  const kit: [string, "laptop" | "phone" | "access_card" | "keys" | "other", string, string | null, boolean][] = [
    ["MVR-LT-001", "laptop", "Dell Latitude 7450", "Ivan", true], ["MVR-LT-002", "laptop", "Dell Latitude 7450", "Tana", true],
    ["MVR-LT-003", "laptop", "Lenovo ThinkPad T14", "Siyabonga", false], ["MVR-LT-004", "laptop", "Lenovo ThinkPad T14", "Sarah", true],
    ["MVR-PH-001", "phone", "Samsung Galaxy A55", "Sarah", true], ["MVR-AC-017", "access_card", "Building access card (Sandton)", "Sarah", true],
    ["MVR-LT-005", "laptop", "Dell Latitude 5450", null, false], ["MVR-MN-002", "other", "Dell 27\" monitor", null, false],
  ];
  for (const [tag, type, description, holder, confirmed] of kit) {
    await hr.assetCommand(hrCtx, { op: "create", tag, type, description, serial: `SN${tag.slice(-3)}X${tag.length}` });
    if (!holder) continue;
    const [a] = await withFirm(firmId, tx => tx.select().from(schema.assets).where(eq(schema.assets.tag, tag)));
    await hr.assetCommand(hrCtx, { op: "assign", assetId: a.id, personId: id(holder), description });
    if (confirmed) {
      const [asg] = await withFirm(firmId, tx => tx.select().from(schema.assetAssignments).where(eq(schema.assetAssignments.assetId, a.id)));
      await hr.assetCommand(ctx(holder), { op: "confirm", assignmentId: asg.id });
    }
  }

  // ---------------------------------------------------------------- G2/G3: policies (one with two versions)
  await hr.publishPolicy(hrCtx, { title: "Remote and hybrid work policy", body: "**Purpose**\nSets out when staff may work away from the office.\n\n**Rules**\n1. Up to one remote day a week, approved by the person you report to.\n2. Court and client attendance is recorded in the portal so reception knows where you are." });
  const remoteV2 = await hr.publishPolicy(hrCtx, { title: "Remote and hybrid work policy", body: "**Purpose**\nSets out when staff may work away from the office.\n\n**Rules**\n1. Up to two remote days a week, approved by the person you report to.\n2. Court and client attendance is recorded in the portal so reception knows where you are.\n3. Client files may only be accessed through the firm’s secure systems.\n\n**Change in version 2:** remote days increased from one to two." });
  const popia = await hr.publishPolicy(hrCtx, { title: "Confidentiality and POPIA policy", body: "**Client confidentiality**\nEverything learnt about a client’s affairs is confidential and privileged.\n\n**Personal information**\nPersonal information is processed only for the purpose it was collected, kept secure, and never shared without a lawful basis (POPIA)." });
  const social = await hr.publishPolicy(hrCtx, { title: "Social media policy", body: "Do not comment on client matters, opposing parties or courts on social media. Do not identify yourself as speaking for the firm without the MD’s approval." });
  for (const first of ["Matodzi", "Robyn", "Eduan", "Ivan", "Tana", "Tumelo", "Muano", "Sarah"]) await acknowledge(ctx(first), popia.id, { ip: "127.0.0.1", userAgent: "seed" });
  for (const first of ["Matodzi", "Robyn", "Ivan", "Sarah"]) await acknowledge(ctx(first), remoteV2.id, { ip: "127.0.0.1", userAgent: "seed" });
  for (const first of ["Matodzi", "Robyn"]) await acknowledge(ctx(first), social.id, { ip: "127.0.0.1", userAgent: "seed" });

  // ---------------------------------------------------------------- M3: announcements
  await hr.createAnnouncement(hrCtx, { title: "Year-end office closure", body: `The office closes from 24 December and reopens on 4 January. The closure days come off annual leave — see your balance in My leave.`, pinned: true });
  await hr.createAnnouncement(hrCtx, { title: "Fidelity Fund certificates for next year", body: "Please send HR your applications for next year’s Fidelity Fund certificate by 30 November so they are issued before 1 January." });
  await hr.createAnnouncement(hrCtx, { title: "Welcome to our new candidate attorneys", body: "Please welcome Muano, Malaika and Siyabonga, who joined the firm’s articles programme this year." });

  // ---------------------------------------------------------------- L1/L2: a confidential case (fictional person)
  const kase = await hr.caseCommand(hrCtx, { op: "open", personId: id("Pieter"), kind: "grievance", summary: "Grievance about how overtime on the BF/2026/221 matter was allocated (fictional demo case)." });
  await hr.caseCommand(hrCtx, { op: "letter", id: kase.id, template: "grievance_acknowledgement", extra: {} });
  await hr.caseCommand(hrCtx, { op: "note", id: kase.id, text: "Met with the employee and the supervising executive. Agreed an overtime roster for the remaining trial weeks; follow-up in two weeks." });

  // ---------------------------------------------------------------- N1–N3: a resignation in progress (fictional person)
  const off = await hr.startOffboarding(hrCtx, { personId: id("Sarah"), type: "resignation", noticeDate: addDays(today, -6), lastWorkingDay: addDays(monday(4), 4) });
  await hr.offboardingCommand(hrCtx, off.id, { op: "check", key: "letter" });
  await hr.offboardingCommand(ctx("Robyn"), off.id, { op: "handover", matterRef: "LIT/2026/031 trial bundles", toPersonId: id("Ivan"), notes: "Index updated to volume 6" });
  await hr.offboardingCommand(ctx("Robyn"), off.id, { op: "handover", matterRef: "Filing diary", toPersonId: id("Muano"), notes: "Court deadlines to end of January" });
  await hr.offboardingCommand(ctx("Ivan"), off.id, { op: "accept", index: 0 });
}
