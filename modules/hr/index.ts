/**
 * Later-release HR features for the full-product demo (scope register D1–D3, E–N). Each command validates with Zod,
 * checks permission, runs in one withFirm transaction, writes audit() and enqueues notifications (CLAUDE.md rule 3).
 * Approvals run on the workflow engine (rule 4) and follow the organogram (rule 5).
 */
import crypto from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, withFirm, type Tx } from "@/lib/db";
import { getBytes, putBytes, UserError } from "@/lib/storage";
import { decrypt, encrypt, lookupHash } from "@/lib/crypto";
import type { Person } from "@/db/schema";
import { audit, logAccess } from "../audit";
import { can } from "../permissions";
import type { Ctx } from "../identity/actor";
import { displayName } from "../people";
import { enqueue } from "../notifications";
import { allowedActions, getInstance, startWorkflow, transition } from "../workflow/engine";
import { directReportIds, resolveApprover } from "../workflow/routing";
import { balancesFor, todayIn } from "../leave";
import { addDays, addMonths, diffDays, longDate as ld } from "../leave/engine";
const longDate = (s?: string | null) => (s ? ld(s) : "—");

const who = (ctx: Ctx) => ({ id: ctx.person.id, role: ctx.person.role, isManager: ctx.isManager });
const need = (ok: boolean, msg = "Not allowed.") => { if (!ok) throw new UserError(msg, 403); };
const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isAdmin = (ctx: Ctx) => ctx.person.role === "admin";
const opt = (s: z.ZodString) => s.optional().or(z.literal("").transform(() => undefined));
const pgArray = (ids: string[]) => `{${ids.join(",")}}`;

async function personOr404(tx: Tx, id: string) {
  const [p] = await tx.select().from(schema.people).where(eq(schema.people.id, id));
  if (!p) throw new UserError("Person not found.", 404);
  return p;
}
async function nameMap(tx: Tx) {
  return new Map((await tx.select().from(schema.people)).map(p => [p.id, displayName(p)]));
}

// =====================================================================================================================
// Letters (M2, N5, L2, H1) — generated from templates on firm letterhead; stored so they can be reprinted.
// =====================================================================================================================

export const LETTER_TEMPLATES = {
  employment_letter: "Confirmation of employment",
  certificate_of_service: "Certificate of service (BCEA s42)",
  probation_confirmation: "Confirmation of appointment after probation",
  probation_extension: "Extension of probation",
  probation_termination: "Outcome of probation",
  hearing_notice: "Notice to attend a disciplinary hearing",
  grievance_acknowledgement: "Acknowledgement of grievance",
  outcome_letter: "Outcome of disciplinary process",
} as const;
export type LetterTemplate = keyof typeof LETTER_TEMPLATES;

async function letterBody(tx: Tx, ctx: Ctx, p: Person, template: LetterTemplate, extra: Record<string, string> = {}) {
  const today = longDate(todayIn(ctx.firm.timezone));
  const [dept] = p.departmentId ? await tx.select().from(schema.departments).where(eq(schema.departments.id, p.departmentId)) : [];
  const name = `${p.firstName} ${p.lastName}`;
  const head = `**${ctx.firm.legalName}**\n\n${today}\n\n`;
  const sign = `\n\nYours faithfully\n\n${displayName(ctx.person)}\n${ctx.person.jobTitle ?? "HR administrator"}`;
  const bodies: Record<LetterTemplate, string> = {
    employment_letter: `**To whom it may concern**\n\nThis confirms that ${name} is employed by ${ctx.firm.legalName} as ${p.jobTitle ?? "an employee"}${dept ? ` in ${dept.name}` : ""}, on a ${p.employmentType.replace("_", " ")} basis, since ${longDate(p.startDate)}.${extra.purpose ? `\n\nThis letter is issued for: ${extra.purpose}.` : ""}`,
    certificate_of_service: `**Certificate of service** (Basic Conditions of Employment Act, section 42)\n\nEmployee: ${name}\nEmployer: ${ctx.firm.legalName}\nDate of engagement: ${longDate(p.startDate)}\nDate of termination: ${longDate(p.lastWorkingDay ?? extra.lastDay ?? null)}\nJob title: ${p.jobTitle ?? "—"}\n${extra.reason ? `Reason for termination (at the employee's request): ${extra.reason}\n` : ""}`,
    probation_confirmation: `Dear ${p.firstName}\n\n**Confirmation of appointment**\n\nWe are pleased to confirm that you have successfully completed your probationary period. Your appointment as ${p.jobTitle ?? "an employee"} is confirmed with effect from ${extra.effective ?? today}.`,
    probation_extension: `Dear ${p.firstName}\n\n**Extension of probation**\n\nFollowing your probation review, your probationary period is extended to ${extra.until ?? "the date agreed"} for the reasons discussed with you:\n\n${extra.reason ?? ""}\n\nWe will support you with the steps agreed and review progress before that date.`,
    probation_termination: `Dear ${p.firstName}\n\n**Outcome of probation**\n\nFollowing the probation process, including the opportunity to respond, your employment will end on ${extra.lastDay ?? "the date stated"}. Reasons:\n\n${extra.reason ?? ""}\n\nYou may refer a dispute to the CCMA within the prescribed period.`,
    hearing_notice: `Dear ${p.firstName}\n\n**Notice to attend a disciplinary hearing**\n\nYou are required to attend a disciplinary hearing on ${extra.when ?? "[date and time]"} at ${extra.where ?? "[venue]"}.\n\nAllegation(s): ${extra.allegations ?? "[allegations]"}\n\nYou may be represented by a fellow employee, call witnesses, and use an interpreter. Please confirm receipt.`,
    grievance_acknowledgement: `Dear ${p.firstName}\n\n**Acknowledgement of grievance**\n\nWe acknowledge receipt of your grievance dated ${extra.dated ?? today}. It will be handled under the firm's grievance procedure, and a meeting will be arranged within five working days.`,
    outcome_letter: `Dear ${p.firstName}\n\n**Outcome of disciplinary process**\n\nAfter considering the evidence and your representations, the chairperson found: ${extra.finding ?? "[finding]"}.\n\nSanction: ${extra.sanction ?? "[sanction]"}.\n\nYou may appeal in terms of the firm's procedure within five working days.`,
  };
  return { title: LETTER_TEMPLATES[template], body: head + bodies[template] + sign };
}

export async function issueLetter(tx: Tx, ctx: Ctx, personId: string, template: LetterTemplate, extra: Record<string, string> = {}) {
  const p = await personOr404(tx, personId);
  const { title, body } = await letterBody(tx, ctx, p, template, extra);
  const [l] = await tx.insert(schema.letters).values({ firmId: ctx.firm.id, personId, template, title, body, issuedBy: ctx.person.id, createdBy: ctx.person.id }).returning();
  await audit(tx, ctx.actor, "letter.issue", "letter", l.id, { personId, template });
  return l;
}

export async function generateLetter(ctx: Ctx, raw: unknown) {
  need(isAdmin(ctx));
  const r = z.object({ personId: z.string().uuid(), template: z.enum(Object.keys(LETTER_TEMPLATES) as [LetterTemplate, ...LetterTemplate[]]), extra: z.record(z.string(), z.string()).default({}) }).safeParse(raw);
  if (!r.success) throw new UserError("Choose a person and a letter.");
  return withFirm(ctx.firm.id, tx => issueLetter(tx, ctx, r.data.personId, r.data.template, r.data.extra));
}

export async function getLetter(ctx: Ctx, id: string) {
  return withFirm(ctx.firm.id, async tx => {
    const [l] = await tx.select().from(schema.letters).where(eq(schema.letters.id, id));
    if (!l) throw new UserError("Letter not found.", 404);
    need(l.personId === ctx.person.id || isAdmin(ctx));
    await logAccess(tx, ctx.actor, "letter", l.id, "view");
    return l;
  });
}

// =====================================================================================================================
// Employee profile (D1, D3) and employment history (D2)
// =====================================================================================================================

const dec = (firmId: string, b: Buffer | null) => (b ? decrypt(firmId, b) : "");
const mask = (s: string) => (s.length > 4 ? `${"•".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}` : s);

export async function profile(ctx: Ctx, personId: string, opts: { reveal?: boolean } = {}) {
  return withFirm(ctx.firm.id, async tx => {
    const p = await personOr404(tx, personId);
    const self = p.id === ctx.person.id, admin = isAdmin(ctx);
    need(can(who(ctx), "profile.view", { personId: p.id, managerId: p.reportsToId }));
    const names = await nameMap(tx);
    const [dept] = p.departmentId ? await tx.select().from(schema.departments).where(eq(schema.departments.id, p.departmentId)) : [];
    const today = todayIn(ctx.firm.timezone);
    const seesPrivate = self || admin;

    // Class S (doc 08 §2): owner and HR only; masked unless revealed; every reveal is access-logged.
    let sensitive: Record<string, string> | null = null;
    if (seesPrivate) {
      const [s] = await tx.select().from(schema.personSensitive).where(eq(schema.personSensitive.personId, p.id));
      if (s) {
        const f = ctx.firm.id;
        const raw = { idNumber: dec(f, s.idNumberEnc), passportNo: dec(f, s.passportNoEnc), dateOfBirth: dec(f, s.dateOfBirthEnc), taxNumber: dec(f, s.taxNumberEnc),
          bankAccount: dec(f, s.bankAccountEnc), branchCode: dec(f, s.bankBranchCodeEnc), address: dec(f, s.addressEnc) };
        sensitive = { ...(opts.reveal ? raw : Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, k === "address" || k === "dateOfBirth" ? v : mask(v)]))),
          nationality: s.nationality ?? "", permitExpiry: s.permitExpiry ?? "", bankName: s.bankName ?? "", bankAccountType: s.bankAccountType ?? "" };
        await logAccess(tx, ctx.actor, "person_sensitive", p.id, "view");
      } else sensitive = {};
    }

    const [contacts, history, creds, docs, reviewsRows, assigned, reqs, letterRows, offb, balances] = await Promise.all([
      tx.select().from(schema.emergencyContacts).where(eq(schema.emergencyContacts.personId, p.id)),
      tx.select().from(schema.employmentEvents).where(eq(schema.employmentEvents.personId, p.id)).orderBy(desc(schema.employmentEvents.effectiveDate)),
      tx.select().from(schema.credentials).where(eq(schema.credentials.personId, p.id)).orderBy(asc(schema.credentials.expiresOn)),
      seesPrivate ? tx.select({ d: schema.documents, code: schema.documentCategories.code, label: schema.documentCategories.label }).from(schema.documents)
        .innerJoin(schema.documentCategories, eq(schema.documentCategories.id, schema.documents.categoryId))
        .where(and(eq(schema.documents.personId, p.id), sql`${schema.documents.status} <> 'superseded'`)).orderBy(desc(schema.documents.createdAt)) : Promise.resolve([]),
      tx.select({ r: schema.reviews, w: schema.workflowInstances }).from(schema.reviews)
        .leftJoin(schema.workflowInstances, eq(schema.workflowInstances.id, schema.reviews.workflowInstanceId)).where(eq(schema.reviews.personId, p.id)).orderBy(desc(schema.reviews.periodStart)),
      tx.select({ a: schema.assetAssignments, asset: schema.assets }).from(schema.assetAssignments)
        .innerJoin(schema.assets, eq(schema.assets.id, schema.assetAssignments.assetId)).where(eq(schema.assetAssignments.personId, p.id)),
      seesPrivate || can(who(ctx), "leave.view", { personId: p.id, managerId: p.reportsToId }) ? tx.select({ r: schema.hrRequests, w: schema.workflowInstances }).from(schema.hrRequests)
        .leftJoin(schema.workflowInstances, eq(schema.workflowInstances.id, schema.hrRequests.workflowInstanceId)).where(eq(schema.hrRequests.personId, p.id)).orderBy(desc(schema.hrRequests.createdAt)) : Promise.resolve([]),
      seesPrivate ? tx.select().from(schema.letters).where(eq(schema.letters.personId, p.id)).orderBy(desc(schema.letters.createdAt)) : Promise.resolve([]),
      tx.select().from(schema.offboardings).where(eq(schema.offboardings.personId, p.id)),
      balancesFor(tx, p, today),
    ]);
    return {
      id: p.id, name: displayName(p), firstName: p.firstName, lastName: p.lastName, preferredName: p.preferredName ?? "", email: p.workEmail, phone: p.phone ?? "",
      title: p.jobTitle ?? "", department: dept?.name ?? "", departmentId: p.departmentId, reportsToId: p.reportsToId, reportsTo: p.reportsToId ? names.get(p.reportsToId) ?? "" : "",
      directReports: (await directReportIds(tx, p.id)).map(id => ({ id, name: names.get(id) ?? "" })),
      role: p.role, employeeNo: p.employeeNo ?? "", employmentType: p.employmentType, employmentStatus: p.employmentStatus, isFeeEarner: p.isFeeEarner,
      isAdmittedAttorney: p.isAdmittedAttorney, workPattern: p.workPattern ?? [1, 2, 3, 4, 5], startDate: p.startDate, probationEndDate: p.probationEndDate,
      contractEndDate: p.contractEndDate, lastWorkingDay: p.lastWorkingDay, onboardingStatus: p.onboardingStatus,
      canEditContact: self || admin, canEditEmployment: admin, canSeePrivate: seesPrivate, revealed: !!opts.reveal,
      sensitive, contacts: contacts.map(c => ({ name: c.name, relationship: c.relationship, phone: c.phone, primary: c.isPrimary })),
      history: history.map(h => ({ date: h.effectiveDate, kind: h.kind, summary: h.summary })),
      credentials: creds.map(c => credentialView(c, today, names)),
      documents: docs.map(({ d, code, label }) => ({ id: d.id, category: code, label, name: d.fileName, status: d.status, uploaded: d.createdAt })),
      reviews: reviewsRows.map(({ r, w }) => ({ id: r.id, kind: r.kind, period: r.periodLabel, due: r.dueDate, state: w?.state ?? "", rating: r.rating, outcome: r.outcome })),
      assets: assigned.map(({ a, asset }) => ({ id: a.id, tag: asset.tag, type: asset.type, description: asset.description, assignedAt: a.assignedAt, receipt: !!a.receiptConfirmedAt, returnedAt: a.returnedAt })),
      requests: reqs.map(({ r, w }) => ({ id: r.id, kind: r.kind, title: r.title, state: w?.state ?? "", created: r.createdAt })),
      letters: letterRows.map(l => ({ id: l.id, title: l.title, created: l.createdAt })),
      offboarding: offb[0] ? { id: offb[0].id, type: offb[0].type, lastWorkingDay: offb[0].lastWorkingDay } : null,
      balances: balances.map(b => ({ code: b.code, label: b.label, available: b.available, taken: b.taken, projected: b.projected })),
    };
  });
}

const ContactInput = z.object({
  phone: opt(z.string().trim().max(30)), preferredName: opt(z.string().trim().max(60)), address: opt(z.string().trim().max(300)),
  emergencyName: opt(z.string().trim().max(80)), emergencyRelationship: opt(z.string().trim().max(40)), emergencyPhone: opt(z.string().trim().max(30)),
});

/** D3: the person edits their own contact fields; HR can too. Everything is audited. */
export async function updateContact(ctx: Ctx, personId: string, raw: unknown) {
  need(personId === ctx.person.id || isAdmin(ctx));
  const r = ContactInput.safeParse(raw);
  if (!r.success) throw new UserError("Check the contact details.");
  const d = r.data;
  await withFirm(ctx.firm.id, async tx => {
    // Only fields that were sent are changed (a partial update never blanks other details).
    const patch = Object.fromEntries(Object.entries({ phone: d.phone, preferredName: d.preferredName }).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length) await tx.update(schema.people).set({ ...patch, updatedAt: new Date() }).where(eq(schema.people.id, personId));
    if (d.address !== undefined) await upsertSensitive(tx, ctx, personId, { addressEnc: d.address ? encrypt(ctx.firm.id, d.address) : null });
    if (d.emergencyName && d.emergencyPhone) {
      const [c] = await tx.select().from(schema.emergencyContacts).where(and(eq(schema.emergencyContacts.personId, personId), eq(schema.emergencyContacts.isPrimary, true)));
      const v = { name: d.emergencyName, relationship: d.emergencyRelationship ?? "", phone: d.emergencyPhone };
      if (c) await tx.update(schema.emergencyContacts).set({ ...v, updatedAt: new Date() }).where(eq(schema.emergencyContacts.id, c.id));
      else await tx.insert(schema.emergencyContacts).values({ firmId: ctx.firm.id, personId, ...v, isPrimary: true, createdBy: ctx.person.id });
    }
    await audit(tx, ctx.actor, "person.contact", "person", personId, { phone: d.phone, preferredName: d.preferredName, address: d.address ? "changed" : undefined });
  });
}

async function upsertSensitive(tx: Tx, ctx: Ctx, personId: string, values: Partial<typeof schema.personSensitive.$inferInsert>) {
  const [s] = await tx.select({ id: schema.personSensitive.personId }).from(schema.personSensitive).where(eq(schema.personSensitive.personId, personId));
  if (s) await tx.update(schema.personSensitive).set({ ...values, updatedAt: new Date() }).where(eq(schema.personSensitive.personId, personId));
  else await tx.insert(schema.personSensitive).values({ personId, firmId: ctx.firm.id, ...values, createdBy: ctx.person.id });
}

const SensitiveInput = z.object({
  idNumber: opt(z.string().trim().regex(/^\d{13}$/, "SA ID numbers have 13 digits")), passportNo: opt(z.string().trim().max(20)),
  nationality: opt(z.string().trim().max(40)), permitExpiry: opt(ISO), dateOfBirth: opt(ISO), taxNumber: opt(z.string().trim().regex(/^\d{10}$/, "Tax numbers have 10 digits")),
  bankName: opt(z.string().trim().max(40)), bankAccount: opt(z.string().trim().regex(/^\d{6,16}$/)), branchCode: opt(z.string().trim().regex(/^\d{6}$/)),
  bankAccountType: opt(z.string().trim().max(20)),
});

/** Class S fields: HR only (captured from verified documents), encrypted per firm, every change audited without values. */
export async function updateSensitive(ctx: Ctx, personId: string, raw: unknown) {
  need(isAdmin(ctx), "Only HR can change identity and banking details.");
  const r = SensitiveInput.safeParse(raw);
  if (!r.success) throw new UserError(r.error.issues[0]?.message ?? "Check the details.");
  const d = r.data, f = ctx.firm.id, enc = (v?: string) => (v ? encrypt(f, v) : undefined);
  await withFirm(f, async tx => {
    const values = Object.fromEntries(Object.entries({
      idNumberEnc: enc(d.idNumber), idNumberHmac: d.idNumber ? lookupHash(f, d.idNumber) : undefined, passportNoEnc: enc(d.passportNo), nationality: d.nationality,
      permitExpiry: d.permitExpiry, dateOfBirthEnc: enc(d.dateOfBirth), taxNumberEnc: enc(d.taxNumber), bankName: d.bankName, bankAccountEnc: enc(d.bankAccount),
      bankBranchCodeEnc: enc(d.branchCode), bankAccountType: d.bankAccountType,
    }).filter(([, v]) => v !== undefined));
    await upsertSensitive(tx, ctx, personId, values);
    await audit(tx, ctx.actor, "person.sensitive", "person", personId, { fields: Object.keys(values).map(k => k.replace(/Enc$|Hmac$/, "")) });
  });
}

/** D2: one timeline entry per employment change; called by the people module when HR edits employment fields. */
export async function recordEmploymentChanges(tx: Tx, ctx: Ctx, before: Person, after: Partial<Person>, effectiveDate: string) {
  const names = await nameMap(tx);
  const depts = new Map((await tx.select().from(schema.departments)).map(d => [d.id, d.name]));
  const days = (p?: number[] | null) => (p?.length ? p : [1, 2, 3, 4, 5]).map(d => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d - 1]).join(", ");
  const ev: { kind: typeof schema.employmentEventKind.enumValues[number]; summary: string }[] = [];
  if (after.jobTitle !== undefined && after.jobTitle !== before.jobTitle) ev.push({ kind: "title_change", summary: `Title: ${before.jobTitle ?? "—"} → ${after.jobTitle}` });
  if (after.departmentId !== undefined && after.departmentId !== before.departmentId) ev.push({ kind: "transfer", summary: `Department: ${depts.get(before.departmentId ?? "") ?? "—"} → ${depts.get(after.departmentId ?? "") ?? "—"}` });
  if (after.reportsToId !== undefined && after.reportsToId !== before.reportsToId) ev.push({ kind: "manager_change", summary: `Reports to: ${names.get(before.reportsToId ?? "") ?? "—"} → ${names.get(after.reportsToId ?? "") ?? "—"}` });
  if (after.workPattern !== undefined && JSON.stringify(after.workPattern) !== JSON.stringify(before.workPattern)) ev.push({ kind: "pattern_change", summary: `Work pattern: ${days(before.workPattern)} → ${days(after.workPattern)}` });
  if (after.employmentType !== undefined && after.employmentType !== before.employmentType) ev.push({ kind: "type_change", summary: `Employment type: ${before.employmentType.replace("_", " ")} → ${after.employmentType!.replace("_", " ")}` });
  if (after.role !== undefined && after.role === "manager" && before.role !== "manager") ev.push({ kind: "promotion", summary: "Now approves leave for a team" });
  for (const e of ev) await tx.insert(schema.employmentEvents).values({ firmId: ctx.firm.id, personId: before.id, kind: e.kind, effectiveDate, summary: e.summary, createdBy: ctx.person.id });
  return ev.length;
}

export async function addEmploymentEvent(ctx: Ctx, raw: unknown) {
  need(isAdmin(ctx));
  const r = z.object({ personId: z.string().uuid(), kind: z.enum(schema.employmentEventKind.enumValues), effectiveDate: ISO, summary: z.string().trim().min(3).max(200) }).safeParse(raw);
  if (!r.success) throw new UserError("A date, type and summary are required.");
  await withFirm(ctx.firm.id, async tx => {
    await tx.insert(schema.employmentEvents).values({ firmId: ctx.firm.id, ...r.data, createdBy: ctx.person.id });
    await audit(tx, ctx.actor, "person.history", "person", r.data.personId, { kind: r.data.kind });
  });
}

// =====================================================================================================================
// Credentials (F1–F5, I1, I3)
// =====================================================================================================================

export const CREDENTIAL_LABEL: Record<string, string> = {
  lpc_admission: "LPC admission", fidelity_fund: "Fidelity Fund Certificate", practising_certificate: "Practising certificate", right_of_appearance: "Right of appearance (High Court)",
  notary: "Notary admission", conveyancer: "Conveyancer admission", commissioner_of_oaths: "Commissioner of oaths", pvt_contract: "Practical vocational training contract",
  board_exam: "Board exam", admission_application: "Admission application", cpd: "CPD", fica_training: "FICA training (RMCP)", course: "Course",
};
function credentialView(c: typeof schema.credentials.$inferSelect, today: string, names: Map<string, string>) {
  const left = c.expiresOn ? diffDays(today, c.expiresOn) : null;
  const status = left == null ? "Recorded" : left < 0 ? "Lapsed" : left <= 90 ? "Expiring" : "Valid";
  return { id: c.id, personId: c.personId, person: names.get(c.personId) ?? "", kind: c.kind, kindLabel: CREDENTIAL_LABEL[c.kind], title: c.title, reference: c.reference ?? "",
    issuedOn: c.issuedOn, expiresOn: c.expiresOn, daysLeft: left, hours: c.hours, provider: c.provider ?? "", details: c.details, status, verified: !!c.verifiedAt };
}

const CredInput = z.object({
  personId: z.string().uuid().optional(), kind: z.enum(schema.credentialKind.enumValues), title: z.string().trim().min(2).max(120), reference: opt(z.string().trim().max(60)),
  issuedOn: opt(ISO), expiresOn: opt(ISO), hours: z.coerce.number().min(0).max(500).optional(), provider: opt(z.string().trim().max(80)),
  details: z.record(z.string(), z.string()).optional(),
});
const SELF_KINDS = ["cpd", "course", "fica_training", "board_exam"];

/** HR records any credential; staff record their own CPD, courses, FICA training and board exams (verified by HR). */
export async function addCredential(ctx: Ctx, raw: unknown) {
  const r = CredInput.safeParse(raw);
  if (!r.success) throw new UserError("Check the credential details.");
  const personId = r.data.personId ?? ctx.person.id;
  need(isAdmin(ctx) || (personId === ctx.person.id && SELF_KINDS.includes(r.data.kind)), "HR records admission and practising credentials.");
  return withFirm(ctx.firm.id, async tx => {
    const [c] = await tx.insert(schema.credentials).values({ firmId: ctx.firm.id, personId, kind: r.data.kind, title: r.data.title, reference: r.data.reference ?? null,
      issuedOn: r.data.issuedOn ?? null, expiresOn: r.data.expiresOn ?? null, hours: r.data.hours ?? null, provider: r.data.provider ?? null, details: r.data.details ?? {},
      verifiedBy: isAdmin(ctx) ? ctx.person.id : null, verifiedAt: isAdmin(ctx) ? new Date() : null, createdBy: ctx.person.id }).returning();
    await audit(tx, ctx.actor, "credential.add", "credential", c.id, { personId, kind: c.kind });
    return c;
  });
}

export async function verifyCredential(ctx: Ctx, id: string) {
  need(can(who(ctx), "credentials.manage"));
  await withFirm(ctx.firm.id, async tx => {
    await tx.update(schema.credentials).set({ verifiedBy: ctx.person.id, verifiedAt: new Date(), updatedAt: new Date() }).where(eq(schema.credentials.id, id));
    await audit(tx, ctx.actor, "credential.verify", "credential", id);
  });
}

/** F1/F2 firm register with Lapsed/Expiring flags, CPD totals per attorney (F4/I3) and FICA training coverage (F5). */
export async function credentialRegister(ctx: Ctx) {
  need(can(who(ctx), "credentials.manage"));
  return withFirm(ctx.firm.id, async tx => {
    const today = todayIn(ctx.firm.timezone);
    const names = await nameMap(tx);
    const rows = (await tx.select().from(schema.credentials).orderBy(asc(schema.credentials.expiresOn))).map(c => credentialView(c, today, names));
    const people = await tx.select().from(schema.people).where(and(eq(schema.people.status, "active"), isNull(schema.people.deactivatedAt), eq(schema.people.onboardingStatus, "complete")));
    const year = today.slice(0, 4);
    const cpd = people.filter(p => p.isAdmittedAttorney).map(p => ({ personId: p.id, name: displayName(p),
      hours: rows.filter(c => c.personId === p.id && c.kind === "cpd" && (c.issuedOn ?? "").startsWith(year)).reduce((s, c) => s + Number(c.hours ?? 0), 0) }));
    const fica = people.map(p => ({ personId: p.id, name: displayName(p), done: rows.some(c => c.personId === p.id && c.kind === "fica_training" && c.status !== "Lapsed") }));
    const cas = people.filter(p => p.employmentType === "candidate_attorney").map(p => ({ personId: p.id, name: displayName(p),
      items: rows.filter(c => c.personId === p.id && ["pvt_contract", "board_exam", "admission_application"].includes(c.kind)) }));
    return { rows, cpd, fica, candidateAttorneys: cas, summary: { lapsed: rows.filter(r => r.status === "Lapsed").length, expiring: rows.filter(r => r.status === "Expiring").length } };
  });
}

// =====================================================================================================================
// Requests (E1, E3, I2, K1, M1, G4) on the workflow engine
// =====================================================================================================================

const APPROVAL_KINDS = ["work_arrangement", "overtime", "expense", "coi_declaration"] as const;
const SERVICE_KINDS = ["employment_letter", "certificate_of_service", "uif_forms", "hr_query"] as const;
export const REQUEST_LABEL: Record<string, string> = {
  work_arrangement: "Remote / hybrid / flexi", overtime: "Overtime", training: "Training request", expense: "Expense claim", employment_letter: "Employment letter",
  certificate_of_service: "Certificate of service", uif_forms: "UIF forms", hr_query: "HR query", coi_declaration: "Conflict-of-interest declaration",
};
const RequestInput = z.object({
  kind: z.enum(schema.requestKind.enumValues), title: opt(z.string().trim().max(120)), dateFrom: opt(ISO), dateTo: opt(ISO),
  amount: z.coerce.number().min(0).max(1_000_000).optional(), hours: z.coerce.number().min(0).max(200).optional(), matterRef: opt(z.string().trim().max(60)),
  details: z.record(z.string(), z.string()).default({}),
});

export async function createRequest(ctx: Ctx, raw: unknown) {
  need(can(who(ctx), "requests.submit"));
  const r = RequestInput.safeParse(raw);
  if (!r.success) throw new UserError("Check the request details.");
  const d = r.data;
  if (d.kind === "expense" && !d.amount) throw new UserError("Enter the amount claimed.");
  if (d.kind === "overtime" && !d.hours) throw new UserError("Enter the overtime hours.");
  if (d.kind === "work_arrangement" && !d.dateFrom) throw new UserError("Choose the date(s) of the arrangement.");
  return withFirm(ctx.firm.id, async tx => {
    const title = d.title || REQUEST_LABEL[d.kind];
    const [req] = await tx.insert(schema.hrRequests).values({ firmId: ctx.firm.id, personId: ctx.person.id, kind: d.kind, title, details: d.details, amount: d.amount ?? null,
      hours: d.hours ?? null, dateFrom: d.dateFrom ?? null, dateTo: d.dateTo ?? d.dateFrom ?? null, matterRef: d.matterRef ?? null, createdBy: ctx.person.id }).returning();
    let key = "hr_service", assignee: string | null = null;
    if ((APPROVAL_KINDS as readonly string[]).includes(d.kind) || d.kind === "training") {
      const route = await resolveApprover(tx, "leave", ctx.person.id, d.dateFrom ?? todayIn(ctx.firm.timezone));
      if (!route) throw new UserError("No approver could be found. Ask HR to set your manager.");
      key = d.kind === "training" ? "hr_approval_two_step" : "hr_approval"; assignee = route.approverId;
    }
    const inst = await startWorkflow(tx, ctx.actor, key, "hr_request", req.id, { assigneeId: assignee });
    await tx.update(schema.hrRequests).set({ workflowInstanceId: inst.id }).where(eq(schema.hrRequests.id, req.id));
    await audit(tx, ctx.actor, "request.create", "hr_request", req.id, { kind: d.kind });
    const recipients = assignee ? [assignee] : (await tx.select().from(schema.people).where(eq(schema.people.role, "admin"))).map(a => a.id);
    for (const to of recipients) await enqueue(tx, { firmId: ctx.firm.id, recipientId: to, templateKey: "request.submitted",
      payload: { requester: displayName(ctx.person), kind: REQUEST_LABEL[d.kind], title }, dedupeKey: `req:${req.id}:submitted:${to}` });
    return req;
  });
}

const SERVICE_LETTER: Record<string, LetterTemplate> = { employment_letter: "employment_letter", certificate_of_service: "certificate_of_service" };

export async function decideRequest(ctx: Ctx, id: string, action: string, comment?: string, response?: string) {
  await withFirm(ctx.firm.id, async tx => {
    const [req] = await tx.select().from(schema.hrRequests).where(eq(schema.hrRequests.id, id));
    if (!req) throw new UserError("Request not found.", 404);
    const inst = await getInstance(tx, "hr_request", req.id);
    if (!inst) throw new UserError("Request not found.", 404);
    const updated = await transition(tx, { instance: inst, action, actor: ctx.actor, actorRole: ctx.person.role, ownerId: req.personId, comment: comment ?? null,
      nextAssigneeId: action === "approve_manager" ? null : undefined });
    const patch: Partial<typeof schema.hrRequests.$inferInsert> = { updatedAt: new Date() };
    if (response) patch.response = response;
    if (action === "mark_paid") patch.paidAt = new Date();
    if (action === "complete" && SERVICE_LETTER[req.kind]) patch.letterId = (await issueLetter(tx, ctx, req.personId, SERVICE_LETTER[req.kind], req.details as Record<string, string>)).id;
    await tx.update(schema.hrRequests).set(patch).where(eq(schema.hrRequests.id, req.id));
    if (req.personId !== ctx.person.id) await enqueue(tx, { firmId: ctx.firm.id, recipientId: req.personId, templateKey: "request.updated",
      payload: { kind: REQUEST_LABEL[req.kind], title: req.title, state: updated.state.replace(/_/g, " "), by: displayName(ctx.person), comment: comment ?? response ?? "" }, dedupeKey: `req:${req.id}:${updated.state}` });
  });
}

export async function attachReceipt(ctx: Ctx, requestId: string, documentId: string) {
  await withFirm(ctx.firm.id, async tx => {
    const [r] = await tx.select().from(schema.hrRequests).where(eq(schema.hrRequests.id, requestId));
    if (!r || r.personId !== ctx.person.id) throw new UserError("Request not found.", 404);
    await tx.update(schema.hrRequests).set({ receiptDocumentId: documentId, updatedAt: new Date() }).where(eq(schema.hrRequests.id, r.id));
    await audit(tx, ctx.actor, "request.receipt", "hr_request", r.id);
  });
}

export async function listRequests(tx: Tx, ctx: Ctx) {
  const reports = await directReportIds(tx, ctx.person.id);
  const names = await nameMap(tx);
  const rows = await tx.select({ r: schema.hrRequests, w: schema.workflowInstances }).from(schema.hrRequests)
    .innerJoin(schema.workflowInstances, eq(schema.workflowInstances.id, schema.hrRequests.workflowInstanceId))
    .where(isAdmin(ctx) ? undefined : or(eq(schema.hrRequests.personId, ctx.person.id), eq(schema.workflowInstances.assigneeId, ctx.person.id),
      reports.length ? inArray(schema.hrRequests.personId, reports) : undefined))
    .orderBy(desc(schema.hrRequests.createdAt));
  return rows.map(({ r, w }) => ({
    id: r.id, kind: r.kind, kindLabel: REQUEST_LABEL[r.kind], title: r.title, owner: r.personId, name: names.get(r.personId) ?? "", state: w.state,
    assignee: w.assigneeId ? names.get(w.assigneeId) ?? "" : "HR", dateFrom: r.dateFrom, dateTo: r.dateTo, amount: r.amount, hours: r.hours, matterRef: r.matterRef ?? "",
    details: r.details as Record<string, string>, response: r.response ?? "", letterId: r.letterId, paid: !!r.paidAt, hasReceipt: !!r.receiptDocumentId,
    receiptId: r.personId === ctx.person.id || isAdmin(ctx) ? r.receiptDocumentId : null, created: r.createdAt,
    actions: allowedActions(w, ctx.person.id, ctx.person.role, r.personId),
  }));
}

// =====================================================================================================================
// Probation and reviews (H1–H3)
// =====================================================================================================================

/** H1: created at onboarding completion; milestones at 1 and 2 months, decision before the end date. */
export async function createProbation(tx: Tx, ctx: Ctx, p: Person, months = 3) {
  const start = p.startDate ?? todayIn(ctx.firm.timezone);
  const end = p.probationEndDate ?? addDays(addMonths(start, months), -1);
  if (!p.probationEndDate) await tx.update(schema.people).set({ probationEndDate: end }).where(eq(schema.people.id, p.id));
  const [rv] = await tx.insert(schema.reviews).values({ firmId: ctx.firm.id, personId: p.id, reviewerId: p.reportsToId, kind: "probation", periodLabel: "Probation",
    periodStart: start, periodEnd: end, dueDate: addDays(end, -7),
    milestones: [{ label: "1-month check-in", due: addMonths(start, 1), done: false }, { label: "2-month review", due: addMonths(start, 2), done: false },
      { label: "Probation decision", due: addDays(end, -7), done: false }], createdBy: ctx.person.id }).returning();
  const inst = await startWorkflow(tx, ctx.actor, "probation", "review", rv.id, { assigneeId: p.reportsToId });
  await tx.update(schema.reviews).set({ workflowInstanceId: inst.id }).where(eq(schema.reviews.id, rv.id));
  return rv;
}

export async function startReview(ctx: Ctx, raw: unknown) {
  const r = z.object({ personId: z.string().uuid(), kind: z.enum(["probation", "annual"]), periodLabel: opt(z.string().trim().max(40)), periodStart: opt(ISO), periodEnd: opt(ISO), dueDate: opt(ISO) }).safeParse(raw);
  if (!r.success) throw new UserError("Choose a person and review type.");
  return withFirm(ctx.firm.id, async tx => {
    const p = await personOr404(tx, r.data.personId);
    need(isAdmin(ctx) || (ctx.isManager && p.reportsToId === ctx.person.id), "Only HR or the person's manager can start a review.");
    if (r.data.kind === "probation") return createProbation(tx, ctx, p);
    const today = todayIn(ctx.firm.timezone);
    const [rv] = await tx.insert(schema.reviews).values({ firmId: ctx.firm.id, personId: p.id, reviewerId: p.reportsToId, kind: "annual",
      periodLabel: r.data.periodLabel ?? `${today.slice(0, 4)} annual review`, periodStart: r.data.periodStart ?? `${today.slice(0, 4)}-01-01`,
      periodEnd: r.data.periodEnd ?? `${today.slice(0, 4)}-12-31`, dueDate: r.data.dueDate ?? addDays(today, 21), createdBy: ctx.person.id }).returning();
    const inst = await startWorkflow(tx, ctx.actor, "review", "review", rv.id, { assigneeId: p.reportsToId });
    await tx.update(schema.reviews).set({ workflowInstanceId: inst.id }).where(eq(schema.reviews.id, rv.id));
    await enqueue(tx, { firmId: ctx.firm.id, recipientId: p.id, templateKey: "review.started", payload: { period: rv.periodLabel, due: longDate(rv.dueDate) }, dedupeKey: `review:${rv.id}:start` });
    await audit(tx, ctx.actor, "review.start", "review", rv.id, { personId: p.id, kind: "annual" });
    return rv;
  });
}

const ReviewAction = z.object({
  action: z.string(), selfAssessment: opt(z.string().trim().max(4000)), managerFeedback: opt(z.string().trim().max(4000)), rating: z.coerce.number().int().min(1).max(5).optional(),
  goals: z.array(z.object({ goal: z.string().trim().min(2).max(200), measure: z.string().trim().max(200).default(""), training: z.string().trim().max(120).default("") })).max(10).optional(),
  comment: opt(z.string().trim().max(1000)), until: opt(ISO), milestone: z.coerce.number().int().min(0).max(10).optional(),
});

export async function reviewAction(ctx: Ctx, id: string, raw: unknown) {
  const r = ReviewAction.safeParse(raw);
  if (!r.success) throw new UserError("Check the review details.");
  const d = r.data;
  await withFirm(ctx.firm.id, async tx => {
    const [rv] = await tx.select().from(schema.reviews).where(eq(schema.reviews.id, id));
    if (!rv) throw new UserError("Review not found.", 404);
    if (d.action === "milestone") {
      need(isAdmin(ctx) || rv.reviewerId === ctx.person.id);
      const ms = (rv.milestones as { label: string; due: string; done: boolean }[]).map((m, i) => i === d.milestone ? { ...m, done: !m.done } : m);
      await tx.update(schema.reviews).set({ milestones: ms, updatedAt: new Date() }).where(eq(schema.reviews.id, rv.id));
      return;
    }
    const inst = await getInstance(tx, "review", rv.id);
    if (!inst) throw new UserError("Review not found.", 404);
    await transition(tx, { instance: inst, action: d.action, actor: ctx.actor, actorRole: ctx.person.role, ownerId: rv.personId, comment: d.comment ?? null });
    const patch: Partial<typeof schema.reviews.$inferInsert> = { updatedAt: new Date() };
    if (d.action === "submit_self") { patch.selfAssessment = d.selfAssessment ?? ""; if (d.goals) patch.goals = d.goals; }
    if (d.action === "submit_feedback") { patch.managerFeedback = d.managerFeedback ?? ""; patch.rating = d.rating ?? null; if (d.goals) patch.goals = d.goals; }
    if (["confirm", "extend", "terminate"].includes(d.action)) {
      patch.outcome = d.action === "confirm" ? "Confirmed" : d.action === "extend" ? `Extended to ${d.until ?? "—"}` : "Ended";
      const template: LetterTemplate = d.action === "confirm" ? "probation_confirmation" : d.action === "extend" ? "probation_extension" : "probation_termination";
      patch.outcomeLetterId = (await issueLetter(tx, ctx, rv.personId, template, { reason: d.comment ?? "", until: d.until ? longDate(d.until) : "", effective: longDate(todayIn(ctx.firm.timezone)) })).id;
      if (d.action === "extend" && d.until) await tx.update(schema.people).set({ probationEndDate: d.until }).where(eq(schema.people.id, rv.personId));
    }
    await tx.update(schema.reviews).set(patch).where(eq(schema.reviews.id, rv.id));
    await audit(tx, ctx.actor, `review.${d.action}`, "review", rv.id);
  });
}

export async function listReviews(tx: Tx, ctx: Ctx) {
  const reports = await directReportIds(tx, ctx.person.id);
  const names = await nameMap(tx);
  const rows = await tx.select({ r: schema.reviews, w: schema.workflowInstances }).from(schema.reviews)
    .innerJoin(schema.workflowInstances, eq(schema.workflowInstances.id, schema.reviews.workflowInstanceId))
    .where(isAdmin(ctx) ? undefined : or(eq(schema.reviews.personId, ctx.person.id), eq(schema.reviews.reviewerId, ctx.person.id), reports.length ? inArray(schema.reviews.personId, reports) : undefined))
    .orderBy(asc(schema.reviews.dueDate));
  return rows.map(({ r, w }) => {
    const own = r.personId === ctx.person.id;
    // The rating and manager feedback are visible to the employee only once submitted to them.
    const showManager = !own || ["employee_ack", "locked"].includes(w.state);
    return {
      id: r.id, kind: r.kind, personId: r.personId, name: names.get(r.personId) ?? "", reviewer: r.reviewerId ? names.get(r.reviewerId) ?? "" : "", period: r.periodLabel,
      periodStart: r.periodStart, periodEnd: r.periodEnd, due: r.dueDate, state: w.state, milestones: r.milestones, selfAssessment: r.selfAssessment ?? "",
      managerFeedback: showManager ? r.managerFeedback ?? "" : "", rating: showManager ? r.rating : null, goals: r.goals, outcome: r.outcome ?? "", letterId: r.outcomeLetterId,
      actions: allowedActions(w, ctx.person.id, ctx.person.role, r.personId),
    };
  });
}

// =====================================================================================================================
// Assets (J1, J2)
// =====================================================================================================================

export async function assetRegister(tx: Tx, ctx: Ctx) {
  const names = await nameMap(tx);
  const list = await tx.select().from(schema.assets).where(eq(schema.assets.isActive, true)).orderBy(asc(schema.assets.tag));
  const asg = await tx.select().from(schema.assetAssignments).where(isNull(schema.assetAssignments.returnedAt));
  const mine = asg.filter(a => a.personId === ctx.person.id);
  const assetsById = new Map(list.map(a => [a.id, a]));
  return {
    assets: isAdmin(ctx) ? list.map(a => { const cur = asg.find(x => x.assetId === a.id);
      return { id: a.id, tag: a.tag, type: a.type, description: a.description, serial: a.serial ?? "", holder: cur ? names.get(cur.personId) ?? "" : "", holderId: cur?.personId ?? null,
        assignmentId: cur?.id ?? null, receipt: !!cur?.receiptConfirmedAt }; }) : [],
    mine: mine.map(a => ({ assignmentId: a.id, tag: assetsById.get(a.assetId)?.tag ?? "", description: assetsById.get(a.assetId)?.description ?? "", receipt: !!a.receiptConfirmedAt })),
  };
}

export async function assetCommand(ctx: Ctx, raw: unknown) {
  const r = z.object({ op: z.enum(["create", "assign", "confirm", "return"]), tag: opt(z.string().trim().max(30)), type: z.enum(schema.assetType.enumValues).optional(),
    description: opt(z.string().trim().max(120)), serial: opt(z.string().trim().max(60)), assetId: z.string().uuid().optional(), personId: z.string().uuid().optional(),
    assignmentId: z.string().uuid().optional(), condition: opt(z.string().trim().max(200)) }).safeParse(raw);
  if (!r.success) throw new UserError("Check the asset details.");
  const d = r.data;
  await withFirm(ctx.firm.id, async tx => {
    if (d.op === "confirm") {
      const [a] = await tx.select().from(schema.assetAssignments).where(eq(schema.assetAssignments.id, d.assignmentId!));
      if (!a || a.personId !== ctx.person.id) throw new UserError("Assignment not found.", 404);
      await tx.update(schema.assetAssignments).set({ receiptConfirmedAt: new Date(), updatedAt: new Date() }).where(eq(schema.assetAssignments.id, a.id));
      return audit(tx, ctx.actor, "asset.receipt", "asset_assignment", a.id);
    }
    need(can(who(ctx), "assets.manage"));
    if (d.op === "create") {
      if (!d.tag || !d.type || !d.description) throw new UserError("Tag, type and description are required.");
      const [a] = await tx.insert(schema.assets).values({ firmId: ctx.firm.id, tag: d.tag, type: d.type, description: d.description, serial: d.serial ?? null, createdBy: ctx.person.id }).returning();
      return audit(tx, ctx.actor, "asset.create", "asset", a.id, { tag: a.tag });
    }
    if (d.op === "assign") {
      const busy = await tx.select().from(schema.assetAssignments).where(and(eq(schema.assetAssignments.assetId, d.assetId!), isNull(schema.assetAssignments.returnedAt)));
      if (busy.length) throw new UserError("That asset is already assigned — record its return first.");
      const [a] = await tx.insert(schema.assetAssignments).values({ firmId: ctx.firm.id, assetId: d.assetId!, personId: d.personId!, createdBy: ctx.person.id }).returning();
      await enqueue(tx, { firmId: ctx.firm.id, recipientId: d.personId!, templateKey: "asset.assigned", payload: { what: d.description ?? "equipment" }, dedupeKey: `asset:${a.id}` });
      return audit(tx, ctx.actor, "asset.assign", "asset_assignment", a.id, { personId: d.personId });
    }
    await tx.update(schema.assetAssignments).set({ returnedAt: new Date(), returnCondition: d.condition ?? null, updatedAt: new Date() }).where(eq(schema.assetAssignments.id, d.assignmentId!));
    await audit(tx, ctx.actor, "asset.return", "asset_assignment", d.assignmentId!, { condition: d.condition });
  });
}

// =====================================================================================================================
// Confidential HR cases (L1, L2): named officers only; invisible to other admins; every access logged.
// =====================================================================================================================

export async function listCases(ctx: Ctx) {
  need(can(who(ctx), "cases.open"));
  return withFirm(ctx.firm.id, async tx => {
    const names = await nameMap(tx);
    const rows = await tx.select().from(schema.hrCases).where(sql`${ctx.person.id}::uuid = any(${schema.hrCases.officerIds})`).orderBy(desc(schema.hrCases.createdAt));
    for (const c of rows) await logAccess(tx, ctx.actor, "hr_case", c.id, "view");
    return rows.map(c => ({ id: c.id, caseNo: c.caseNo, personId: c.personId, person: names.get(c.personId) ?? "", kind: c.kind, summary: c.summary, status: c.status,
      officers: c.officerIds.map(o => names.get(o) ?? ""), notes: (c.notes as { at: string; by: string; text: string }[]).map(n => ({ ...n, by: names.get(n.by) ?? "" })), opened: c.createdAt }));
  });
}

export async function caseCommand(ctx: Ctx, raw: unknown) {
  need(can(who(ctx), "cases.open"));
  const r = z.object({ op: z.enum(["open", "note", "close", "letter"]), id: z.string().uuid().optional(), personId: z.string().uuid().optional(),
    kind: z.enum(schema.caseKind.enumValues).optional(), summary: opt(z.string().trim().max(500)), officerIds: z.array(z.string().uuid()).optional(),
    text: opt(z.string().trim().max(4000)), template: z.enum(["hearing_notice", "grievance_acknowledgement", "outcome_letter"]).optional(), extra: z.record(z.string(), z.string()).default({}) }).safeParse(raw);
  if (!r.success) throw new UserError("Check the case details.");
  const d = r.data;
  return withFirm(ctx.firm.id, async tx => {
    if (d.op === "open") {
      if (!d.personId || !d.kind || !d.summary) throw new UserError("Person, type and summary are required.");
      const n = (await tx.execute(sql`select count(*)::int + 1 as n from hr_cases`)).rows[0] as { n: number };
      const officers = [...new Set([ctx.person.id, ...(d.officerIds ?? [])])].filter(o => o !== d.personId);
      const [c] = await tx.insert(schema.hrCases).values({ firmId: ctx.firm.id, caseNo: `HR-${todayIn(ctx.firm.timezone).slice(0, 4)}-${String(n.n).padStart(3, "0")}`,
        personId: d.personId, kind: d.kind, summary: d.summary, officerIds: officers, createdBy: ctx.person.id }).returning();
      await audit(tx, ctx.actor, "case.open", "hr_case", c.id, { kind: c.kind });
      return { id: c.id };
    }
    const [c] = await tx.select().from(schema.hrCases).where(eq(schema.hrCases.id, d.id!));
    if (!c || !c.officerIds.includes(ctx.person.id)) throw new UserError("Case not found.", 404); // invisible to non-officers, even admins
    await logAccess(tx, ctx.actor, "hr_case", c.id, "view");
    if (d.op === "note") {
      if (!d.text) throw new UserError("Write the note.");
      await tx.update(schema.hrCases).set({ notes: [...(c.notes as unknown[]), { at: new Date().toISOString(), by: ctx.person.id, text: d.text }], updatedAt: new Date() }).where(eq(schema.hrCases.id, c.id));
    } else if (d.op === "close") {
      await tx.update(schema.hrCases).set({ status: "closed", updatedAt: new Date() }).where(eq(schema.hrCases.id, c.id));
    } else {
      const l = await issueLetter(tx, ctx, c.personId, d.template!, d.extra);
      await tx.update(schema.hrCases).set({ notes: [...(c.notes as unknown[]), { at: new Date().toISOString(), by: ctx.person.id, text: `Letter issued: ${l.title}` }] }).where(eq(schema.hrCases.id, c.id));
      await audit(tx, ctx.actor, `case.${d.op}`, "hr_case", c.id);
      return { letterId: l.id };
    }
    await audit(tx, ctx.actor, `case.${d.op}`, "hr_case", c.id);
    return {};
  });
}

// =====================================================================================================================
// Announcements (M3) and the policy library (G2, G3)
// =====================================================================================================================

export async function listAnnouncements(tx: Tx, ctx: Ctx) {
  const today = todayIn(ctx.firm.timezone);
  const rows = await tx.select().from(schema.announcements).orderBy(desc(schema.announcements.pinned), desc(schema.announcements.publishedAt));
  return rows.filter(a => (!a.expiresOn || a.expiresOn >= today) && (isAdmin(ctx) || a.audience === "all" ||
    (a.audience === "department" && a.audienceValue === ctx.person.departmentId) || (a.audience === "role" && a.audienceValue === ctx.person.role)))
    .map(a => ({ id: a.id, title: a.title, body: a.body, pinned: a.pinned, audience: a.audience, published: a.publishedAt }));
}

export async function createAnnouncement(ctx: Ctx, raw: unknown) {
  need(can(who(ctx), "announcements.manage"));
  const r = z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(2000), audience: z.enum(["all", "department", "role"]).default("all"),
    audienceValue: opt(z.string().max(60)), pinned: z.boolean().default(false), expiresOn: opt(ISO) }).safeParse(raw);
  if (!r.success) throw new UserError("A title and message are required.");
  await withFirm(ctx.firm.id, async tx => {
    const [a] = await tx.insert(schema.announcements).values({ firmId: ctx.firm.id, ...r.data, audienceValue: r.data.audienceValue ?? null, expiresOn: r.data.expiresOn ?? null, createdBy: ctx.person.id }).returning();
    await audit(tx, ctx.actor, "announcement.create", "announcement", a.id);
  });
}

/** G2/G3: a firm-wide acknowledgement document; a new version supersedes the old and re-issues acknowledgement to everyone. */
export async function publishPolicy(ctx: Ctx, raw: unknown) {
  need(can(who(ctx), "policies.manage"));
  const r = z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(10).max(50_000) }).safeParse(raw);
  if (!r.success) throw new UserError("A title and the policy text are required.");
  return withFirm(ctx.firm.id, async tx => {
    const prior = await tx.select().from(schema.ackDocuments).where(and(eq(schema.ackDocuments.kind, "policy"), isNull(schema.ackDocuments.personId),
      eq(schema.ackDocuments.title, r.data.title), isNull(schema.ackDocuments.supersededById)));
    const bytes = Buffer.from(r.data.body, "utf8");
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const blobPath = `${ctx.firm.id}/policies/${sha256}.md`;
    await putBytes(ctx.firm.id, blobPath, bytes, "text/markdown");
    const [doc] = await tx.insert(schema.ackDocuments).values({ firmId: ctx.firm.id, kind: "policy", personId: null, title: r.data.title,
      version: (prior[0]?.version ?? 0) + 1, blobPath, sha256, createdBy: ctx.person.id }).returning();
    for (const o of prior) await tx.update(schema.ackDocuments).set({ supersededById: doc.id, updatedAt: new Date() }).where(eq(schema.ackDocuments.id, o.id));
    const staff = await tx.select().from(schema.people).where(and(eq(schema.people.status, "active"), isNull(schema.people.deactivatedAt), eq(schema.people.onboardingStatus, "complete")));
    for (const p of staff) await enqueue(tx, { firmId: ctx.firm.id, recipientId: p.id, templateKey: "ack.issued", payload: { title: `${doc.title} (version ${doc.version})`, firm: ctx.firm.displayName }, dedupeKey: `ack:${doc.id}:${p.id}` });
    await audit(tx, ctx.actor, "policy.publish", "ack_document", doc.id, { title: doc.title, version: doc.version });
    return doc;
  });
}

export async function listPolicies(tx: Tx, ctx: Ctx) {
  const docs = await tx.select().from(schema.ackDocuments).where(and(eq(schema.ackDocuments.kind, "policy"), isNull(schema.ackDocuments.personId), isNull(schema.ackDocuments.supersededById)))
    .orderBy(asc(schema.ackDocuments.title));
  const acks = docs.length ? await tx.select().from(schema.acknowledgements).where(inArray(schema.acknowledgements.ackDocumentId, docs.map(d => d.id))) : [];
  const staff = isAdmin(ctx) ? (await tx.select({ id: schema.people.id }).from(schema.people).where(and(eq(schema.people.status, "active"), eq(schema.people.onboardingStatus, "complete")))).length : 0;
  const out = [];
  for (const d of docs) {
    const mine = acks.find(a => a.ackDocumentId === d.id && a.personId === ctx.person.id);
    out.push({ id: d.id, title: d.title, version: d.version, issuedAt: d.issuedAt, text: (await getBytes(ctx.firm.id, d.blobPath)).toString("utf8"),
      acknowledgedAt: mine?.acknowledgedAt ?? null, ackCount: acks.filter(a => a.ackDocumentId === d.id).length, staffCount: staff });
  }
  return out;
}

// =====================================================================================================================
// Offboarding (N1–N3, N5)
// =====================================================================================================================

type CheckItem = { key: string; label: string; owner: string; done: boolean; doneAt?: string };
type Handover = { matterRef: string; toPersonId: string; notes: string; accepted: boolean; acceptedAt?: string };

export async function startOffboarding(ctx: Ctx, raw: unknown) {
  need(can(who(ctx), "offboarding.manage"));
  const r = z.object({ personId: z.string().uuid(), type: z.enum(schema.offboardingType.enumValues), noticeDate: ISO, lastWorkingDay: ISO }).safeParse(raw);
  if (!r.success) throw new UserError("Choose the person, type, notice date and last working day.");
  if (r.data.personId === ctx.person.id) throw new UserError("You cannot offboard yourself.");
  return withFirm(ctx.firm.id, async tx => {
    const p = await personOr404(tx, r.data.personId);
    const open = await tx.select({ a: schema.assetAssignments, asset: schema.assets }).from(schema.assetAssignments)
      .innerJoin(schema.assets, eq(schema.assets.id, schema.assetAssignments.assetId)).where(and(eq(schema.assetAssignments.personId, p.id), isNull(schema.assetAssignments.returnedAt)));
    const checklist: CheckItem[] = [
      { key: "letter", label: "Resignation / termination letter on file", owner: "HR", done: false },
      ...(p.isFeeEarner ? [{ key: "matters", label: "All matters handed over and accepted", owner: "Manager", done: false }] : []),
      ...open.map(o => ({ key: `asset:${o.a.id}`, label: `Return ${o.asset.tag} — ${o.asset.description}`, owner: "Employee", done: false })),
      { key: "access", label: "Microsoft 365, practice-management and building access removed on the last day", owner: "IT", done: false },
      { key: "final_pay", label: "Final pay incl. untaken annual leave (BCEA s40) sent to payroll", owner: "Finance", done: false },
      { key: "certificate", label: "Certificate of service issued (BCEA s42)", owner: "HR", done: false },
      { key: "ui19", label: "UI-19 completed for UIF", owner: "HR", done: false },
      { key: "exit_interview", label: "Exit interview completed", owner: "Employee", done: false },
      ...(p.isAdmittedAttorney ? [{ key: "lpc", label: "LPC and Fidelity Fund notified of change of practice", owner: "HR", done: false }] : []),
    ];
    const [o] = await tx.insert(schema.offboardings).values({ firmId: ctx.firm.id, personId: p.id, type: r.data.type, noticeDate: r.data.noticeDate,
      lastWorkingDay: r.data.lastWorkingDay, checklist, handovers: [], createdBy: ctx.person.id }).returning();
    await tx.update(schema.people).set({ lastWorkingDay: r.data.lastWorkingDay, employmentStatus: "on_notice", updatedAt: new Date() }).where(eq(schema.people.id, p.id));
    await tx.insert(schema.employmentEvents).values({ firmId: ctx.firm.id, personId: p.id, kind: "exit", effectiveDate: r.data.lastWorkingDay,
      summary: `${r.data.type.replace("_", " ")} — notice given ${longDate(r.data.noticeDate)}`, createdBy: ctx.person.id });
    await audit(tx, ctx.actor, "offboarding.start", "offboarding", o.id, { personId: p.id, type: o.type });
    return o;
  });
}

export async function offboardingCommand(ctx: Ctx, id: string, raw: unknown) {
  const r = z.object({ op: z.enum(["check", "handover", "accept", "exit_interview", "sign_off", "certificate"]), key: z.string().optional(),
    matterRef: opt(z.string().trim().max(60)), toPersonId: z.string().uuid().optional(), notes: opt(z.string().trim().max(500)), index: z.coerce.number().int().optional(),
    answers: z.record(z.string(), z.string().max(2000)).optional() }).safeParse(raw);
  if (!r.success) throw new UserError("Check the details.");
  const d = r.data;
  return withFirm(ctx.firm.id, async tx => {
    const [o] = await tx.select().from(schema.offboardings).where(eq(schema.offboardings.id, id));
    if (!o) throw new UserError("Offboarding not found.", 404);
    const p = await personOr404(tx, o.personId);
    const admin = isAdmin(ctx), self = o.personId === ctx.person.id, mgr = p.reportsToId === ctx.person.id;
    const checklist = o.checklist as CheckItem[], handovers = o.handovers as Handover[];
    const now = new Date().toISOString();
    if (d.op === "check") {
      const item = checklist.find(c => c.key === d.key);
      if (!item) throw new UserError("Item not found.");
      need(admin || (self && item.owner === "Employee") || (mgr && item.owner === "Manager"));
      item.done = !item.done; item.doneAt = item.done ? now : undefined;
      if (item.key.startsWith("asset:") && item.done) await tx.update(schema.assetAssignments).set({ returnedAt: new Date() }).where(eq(schema.assetAssignments.id, item.key.slice(6)));
    } else if (d.op === "handover") {
      need(admin || self || mgr);
      if (!d.matterRef || !d.toPersonId) throw new UserError("Matter and receiving colleague are required.");
      handovers.push({ matterRef: d.matterRef, toPersonId: d.toPersonId, notes: d.notes ?? "", accepted: false });
      await enqueue(tx, { firmId: ctx.firm.id, recipientId: d.toPersonId, templateKey: "handover.offboarding", payload: { from: displayName(p), matter: d.matterRef }, dedupeKey: `offb:${o.id}:${d.matterRef}` });
    } else if (d.op === "accept") {
      const h = handovers[d.index ?? -1];
      if (!h || h.toPersonId !== ctx.person.id) throw new UserError("Handover not found.", 404);
      h.accepted = true; h.acceptedAt = now;
    } else if (d.op === "exit_interview") {
      need(self || admin);
      await tx.update(schema.offboardings).set({ exitInterview: { ...(d.answers ?? {}), submittedAt: now } }).where(eq(schema.offboardings.id, o.id));
      const item = checklist.find(c => c.key === "exit_interview"); if (item) { item.done = true; item.doneAt = now; }
    } else if (d.op === "sign_off") {
      need(admin || mgr);
      if (handovers.some(h => !h.accepted)) throw new UserError("Every matter handover must be accepted before sign-off.");
      await tx.update(schema.offboardings).set({ managerSignedOffAt: new Date() }).where(eq(schema.offboardings.id, o.id));
      const item = checklist.find(c => c.key === "matters"); if (item) { item.done = true; item.doneAt = now; }
    } else {
      need(admin);
      await issueLetter(tx, ctx, o.personId, "certificate_of_service", { lastDay: o.lastWorkingDay, reason: o.type.replace("_", " ") });
      const item = checklist.find(c => c.key === "certificate"); if (item) { item.done = true; item.doneAt = now; }
    }
    await tx.update(schema.offboardings).set({ checklist, handovers, updatedAt: new Date() }).where(eq(schema.offboardings.id, o.id));
    await audit(tx, ctx.actor, `offboarding.${d.op}`, "offboarding", o.id, { key: d.key });
    return {};
  });
}

export async function listOffboardings(tx: Tx, ctx: Ctx) {
  const names = await nameMap(tx);
  const reports = await directReportIds(tx, ctx.person.id);
  const rows = await tx.select().from(schema.offboardings).orderBy(desc(schema.offboardings.lastWorkingDay));
  return rows.filter(o => isAdmin(ctx) || o.personId === ctx.person.id || reports.includes(o.personId) || (o.handovers as Handover[]).some(h => h.toPersonId === ctx.person.id))
    .map(o => ({
      id: o.id, personId: o.personId, name: names.get(o.personId) ?? "", type: o.type, noticeDate: o.noticeDate, lastWorkingDay: o.lastWorkingDay,
      checklist: o.checklist as CheckItem[], handovers: (o.handovers as Handover[]).map((h, i) => ({ ...h, index: i, to: names.get(h.toPersonId) ?? "" })),
      exitInterviewDone: !!o.exitInterview, exitInterview: isAdmin(ctx) ? o.exitInterview : null, signedOff: !!o.managerSignedOffAt,
      progress: Math.round(100 * (o.checklist as CheckItem[]).filter(c => c.done).length / Math.max(1, (o.checklist as CheckItem[]).length)),
    }));
}

// =====================================================================================================================
// Court / office roster for reception (E4) and the payroll change report (K2)
// =====================================================================================================================

export async function roster(ctx: Ctx, weekStart?: string) {
  need(can(who(ctx), "roster.view"));
  return withFirm(ctx.firm.id, async tx => {
    const today = todayIn(ctx.firm.timezone);
    const ws = weekStart ?? addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    const days = [0, 1, 2, 3, 4].map(i => addDays(ws, i));
    const people = await tx.select().from(schema.people).where(and(eq(schema.people.status, "active"), isNull(schema.people.deactivatedAt), eq(schema.people.onboardingStatus, "complete")))
      .orderBy(asc(schema.people.firstName));
    const leave = await tx.execute(sql`select r.person_id, d.date::text as date from leave_request_days d join leave_requests r on r.id = d.request_id
      join workflow_instances w on w.id = r.workflow_instance_id where w.state in ('approved','completed') and d.fraction > 0 and d.date between ${days[0]} and ${days[4]}`);
    const arr = await tx.select({ r: schema.hrRequests }).from(schema.hrRequests).innerJoin(schema.workflowInstances, eq(schema.workflowInstances.id, schema.hrRequests.workflowInstanceId))
      .where(and(eq(schema.hrRequests.kind, "work_arrangement"), eq(schema.workflowInstances.state, "approved"), lte(schema.hrRequests.dateFrom, days[4]), gte(schema.hrRequests.dateTo, days[0])));
    const hol = await tx.select().from(schema.publicHolidays).where(and(gte(schema.publicHolidays.observedDate, days[0]), lte(schema.publicHolidays.observedDate, days[4])));
    const away = new Set((leave.rows as { person_id: string; date: string }[]).map(x => `${x.person_id}|${x.date}`));
    return {
      days: days.map(d => ({ date: d, label: longDate(d), holiday: hol.find(h => h.observedDate === d)?.name ?? "" })),
      people: people.map(p => ({ id: p.id, name: displayName(p), title: p.jobTitle ?? "", cells: days.map(d => {
        if (hol.some(h => h.observedDate === d)) return "Holiday";
        if (!(p.workPattern?.length ? p.workPattern : [1, 2, 3, 4, 5]).includes(((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1)) return "Not working";
        if (away.has(`${p.id}|${d}`)) return "Away";
        const a = arr.find(x => x.r.personId === p.id && x.r.dateFrom! <= d && x.r.dateTo! >= d);
        if (a) return (a.r.details as Record<string, string>).mode === "court" ? `Court${(a.r.details as Record<string, string>).where ? ` — ${(a.r.details as Record<string, string>).where}` : ""}` : "Remote";
        return "Office";
      }) })),
    };
  });
}

export async function payrollChanges(ctx: Ctx, raw: unknown) {
  need(can(who(ctx), "payroll.changes"));
  const r = z.object({ from: ISO, to: ISO }).safeParse(raw);
  if (!r.success || r.data.to < r.data.from) throw new UserError("Choose a valid period.");
  const { from, to } = r.data;
  return withFirm(ctx.firm.id, async tx => {
    const names = await nameMap(tx);
    const people = await tx.select().from(schema.people);
    const lines: { employeeNo: string; name: string; change: string; detail: string; quantity: string }[] = [];
    const add = (p: Person, change: string, detail: string, quantity = "") => lines.push({ employeeNo: p.employeeNo ?? "", name: displayName(p), change, detail, quantity });
    for (const p of people) {
      if (p.startDate && p.startDate >= from && p.startDate <= to) add(p, "Hire", `Starts ${longDate(p.startDate)} as ${p.jobTitle ?? "—"}`);
      if (p.lastWorkingDay && p.lastWorkingDay >= from && p.lastWorkingDay <= to) {
        const annual = (await balancesFor(tx, p, p.lastWorkingDay)).find(b => b.code === "annual");
        add(p, "Exit", `Last working day ${longDate(p.lastWorkingDay)}`);
        if (annual && annual.available > 0) add(p, "Leave payout", "Untaken annual leave (BCEA s40)", `${annual.available} days`);
      }
    }
    const unpaid = await tx.execute(sql`select r.person_id, sum(d.fraction)::float as days from leave_request_days d join leave_requests r on r.id = d.request_id
      join leave_types t on t.id = r.leave_type_id join workflow_instances w on w.id = r.workflow_instance_id
      where w.state in ('approved','completed') and t.is_paid = false and d.date between ${from} and ${to} group by r.person_id`);
    for (const u of unpaid.rows as { person_id: string; days: number }[]) { const p = people.find(x => x.id === u.person_id)!; add(p, "Unpaid leave", "Deduct", `${u.days} days`); }
    const reqs = await tx.select({ r: schema.hrRequests, w: schema.workflowInstances }).from(schema.hrRequests)
      .innerJoin(schema.workflowInstances, eq(schema.workflowInstances.id, schema.hrRequests.workflowInstanceId))
      .where(and(inArray(schema.hrRequests.kind, ["overtime", "expense"]), inArray(schema.workflowInstances.state, ["approved", "paid"])));
    for (const { r: q, w } of reqs) {
      const when = q.dateFrom ?? q.createdAt.toISOString().slice(0, 10);
      if (when < from || when > to) continue;
      const p = people.find(x => x.id === q.personId)!;
      if (q.kind === "overtime") add(p, "Overtime", q.title, `${q.hours} hours`);
      else add(p, "Reimbursement", `${q.title}${q.matterRef ? ` (${q.matterRef})` : ""}${w.state === "paid" ? " — already paid" : ""}`, `R ${Number(q.amount).toFixed(2)}`);
    }
    await audit(tx, ctx.actor, "export.payroll_changes", "export", null, { from, to, lines: lines.length });
    void names;
    const csv = ["employee_no,name,change,detail,quantity", ...lines.map(l => [l.employeeNo, l.name, l.change, l.detail, l.quantity].map(v => /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(","))].join("\n") + "\n";
    return { lines, csv, fileName: `payroll-changes-${from}-to-${to}.csv` };
  });
}

// =====================================================================================================================
// Reminders on Home (M4) — one engine shared by credentials, probation, policies, reviews, assets, handovers, requests.
// =====================================================================================================================

export async function reminders(tx: Tx, ctx: Ctx) {
  const today = todayIn(ctx.firm.timezone);
  const out: { text: string; page: string; level: "info" | "warn" | "alert" }[] = [];
  const names = await nameMap(tx);
  const creds = await tx.select().from(schema.credentials).where(sql`${schema.credentials.expiresOn} is not null`);
  const others = new Map<string, { kind: string; date: string; left: number; people: string[] }>();
  for (const c of creds) {
    const left = diffDays(today, c.expiresOn!);
    const mine = c.personId === ctx.person.id;
    if (left > 90 || (!mine && !isAdmin(ctx))) continue;
    if (mine) { out.push({ text: `Your ${CREDENTIAL_LABEL[c.kind]} ${left < 0 ? `lapsed on ${longDate(c.expiresOn)}` : `expires in ${left} days`}`, page: "My profile", level: left < 0 ? "alert" : left <= 30 ? "warn" : "info" }); continue; }
    // HR: one line per credential type and date (e.g. every Fidelity Fund certificate ends on 31 December).
    const key = `${c.kind}|${c.expiresOn}`;
    const g = others.get(key) ?? { kind: c.kind, date: c.expiresOn!, left, people: [] };
    g.people.push(names.get(c.personId) ?? ""); others.set(key, g);
  }
  for (const g of others.values()) {
    const who = g.people.length === 1 ? `${g.people[0]}’s` : `${g.people.length} people’s`;
    out.push({ text: `${who} ${CREDENTIAL_LABEL[g.kind]}${g.people.length > 1 ? "s" : ""} ${g.left < 0 ? `lapsed on ${longDate(g.date)}` : `expire${g.people.length > 1 ? "" : "s"} in ${g.left} days`}`,
      page: "Credentials", level: g.left < 0 ? "alert" : g.left <= 30 ? "warn" : "info" });
  }
  out.sort((a, b) => ["alert", "warn", "info"].indexOf(a.level) - ["alert", "warn", "info"].indexOf(b.level));
  for (const r of await listReviews(tx, ctx)) {
    if (r.actions.length && !["locked", "confirmed", "terminated"].includes(r.state))
      out.push({ text: r.kind === "probation" ? `Probation decision for ${r.name} due ${longDate(r.due)}` : `${r.period}: ${r.state === "self_assessment" ? "your self-assessment" : r.state === "manager_review" ? `feedback for ${r.name}` : "acknowledge your review"}`,
        page: "Performance", level: r.due < today ? "alert" : diffDays(today, r.due) <= 14 ? "warn" : "info" });
  }
  for (const p of await listPolicies(tx, ctx)) if (!p.acknowledgedAt) out.push({ text: `Read and acknowledge: ${p.title} (v${p.version})`, page: "Policies", level: "warn" });
  for (const a of (await assetRegister(tx, ctx)).mine) if (!a.receipt) out.push({ text: `Confirm you received ${a.tag} — ${a.description}`, page: "My profile", level: "info" });
  for (const o of await listOffboardings(tx, ctx)) for (const h of o.handovers) if (h.toPersonId === ctx.person.id && !h.accepted)
    out.push({ text: `Accept handover of ${h.matterRef} from ${o.name}`, page: "Offboarding", level: "warn" });
  for (const q of await listRequests(tx, ctx)) if (q.actions.some(a => ["approve", "approve_manager", "start", "complete"].includes(a)))
    out.push({ text: `${q.kindLabel} from ${q.name} is waiting for you`, page: "Requests", level: "info" });
  return out;
}

/** Daily job: credential expiry emails at 90/60/30/7 days to the person and HR (F2), idempotent by dedupe key. */
export async function credentialReminders(firmId: string, today: string) {
  return withFirm(firmId, async tx => {
    const admins = await tx.select().from(schema.people).where(eq(schema.people.role, "admin"));
    const names = await nameMap(tx);
    let sent = 0;
    for (const c of await tx.select().from(schema.credentials).where(sql`${schema.credentials.expiresOn} is not null`)) {
      const left = diffDays(today, c.expiresOn!);
      const step = [90, 60, 30, 7].find(s => left <= s && left > s - 30 && left >= 0) ?? (left < 0 ? 0 : null);
      if (step == null) continue;
      for (const to of [c.personId, ...admins.map(a => a.id)]) {
        await enqueue(tx, { firmId, recipientId: to, templateKey: "credential.expiring", dedupeKey: `cred:${c.id}:${step}:${to}`,
          payload: { person: names.get(c.personId), what: CREDENTIAL_LABEL[c.kind], when: longDate(c.expiresOn), lapsed: left < 0 } });
        sent++;
      }
    }
    return { queued: sent };
  });
}

