/**
 * /api/hr — the single data route the front-end talks to.
 * Contract (unchanged from the ChatGPT-hosted v1):
 *   GET  /api/hr            -> { me, people, documents, leave, calendar, today }
 *   GET  /api/hr?file=<id>  -> document download (owner or admin only)
 *   POST /api/hr  JSON { action, ... }   actions: profile | submit | leave | decision | add | onboard | document
 *   POST /api/hr  multipart { file, category }  -> document upload
 * Errors: { error } with 4xx.
 */
import { NextResponse } from "next/server";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentPerson } from "@/lib/auth";
import { saveUpload, readUpload } from "@/lib/storage";
import type { Person } from "@/db/schema";

export const runtime = "nodejs";
const { people, documents, leave, auditLog } = schema;

const DOC_CATEGORIES = ["CV", "ID", "Banking", "Qualifications", "LPC"];
const LEAVE_TYPES = ["Annual", "Sick", "Family responsibility", "Unpaid", "Other"];
const DEPARTMENTS = ["Legal", "Litigation", "Conveyancing", "Commercial", "Finance", "Administration", "Support"];
const ROLES = ["admin", "approver", "staff", "viewer"] as const;
type Role = (typeof ROLES)[number];

const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const todayZA = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const isISO = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

// Shape a Person for the client exactly as v1 expected (id + owner both present)
const shapePerson = (p: Person) => ({
  id: p.id, owner: p.id, name: p.name, email: p.email, role: p.role, status: p.status,
  admitted: p.admitted, phone: p.phone ?? "", title: p.title ?? "", department: p.department ?? "", start: p.start ?? "",
});

const audit = (actorId: string, action: string, collection: string, recordId?: string, detail?: unknown) =>
  db.insert(auditLog).values({ actorId, action, collection, recordId, detail: detail ?? null });

/* ------------------------------------------------------------------ GET */
export async function GET(req: Request) {
  const me = await currentPerson();
  if (!me) return bad("Sign in with your authorised account to continue.", 401);

  const fileId = new URL(req.url).searchParams.get("file");
  if (fileId) {
    const doc = await db.query.documents.findFirst({ where: eq(documents.id, fileId) });
    if (!doc) return bad("Document not found.", 404);
    if (doc.ownerId !== me.id && me.role !== "admin") return bad("Not allowed.", 403);
    const buf = await readUpload(doc.path);
    await audit(me.id, "download", "document", doc.id);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": doc.mime, "Content-Disposition": `inline; filename="${doc.name.replace(/"/g, "")}"` },
    });
  }

  const today = todayZA();
  const isAdmin = me.role === "admin";
  const canApprove = isAdmin || me.role === "approver";

  const [peopleRows, docRows, leaveRows, approvedRows] = await Promise.all([
    isAdmin ? db.select().from(people).where(eq(people.active, true)).orderBy(asc(people.name)) : Promise.resolve([me]),
    isAdmin ? db.select().from(documents).orderBy(desc(documents.createdAt))
      : me.role === "viewer" ? Promise.resolve([])
      : db.select().from(documents).where(eq(documents.ownerId, me.id)).orderBy(desc(documents.createdAt)),
    me.role === "viewer" ? Promise.resolve([]) :
      db.select({ l: leave, name: people.name }).from(leave).innerJoin(people, eq(people.id, leave.ownerId))
        .where(canApprove ? undefined : eq(leave.ownerId, me.id)).orderBy(desc(leave.start)),
    db.select({ l: leave, name: people.name }).from(leave).innerJoin(people, eq(people.id, leave.ownerId))
      .where(and(eq(leave.status, "Approved"), gte(leave.end, today.slice(0, 4) + "-01-01"))),
  ]);

  return NextResponse.json({
    me: shapePerson(me),
    people: peopleRows.map(shapePerson),
    documents: docRows.map(d => ({ id: d.id, owner: d.ownerId, category: d.category, name: d.name, status: d.status })),
    leave: leaveRows.map(({ l, name }) => ({ id: l.id, owner: l.ownerId, name, type: l.type, start: l.start, end: l.end, note: l.note ?? "", status: l.status })),
    calendar: approvedRows.map(({ l, name }) => ({ id: l.id, name, start: l.start, end: l.end })),
    today,
  });
}

/* ----------------------------------------------------------------- POST */
export async function POST(req: Request) {
  const me = await currentPerson();
  if (!me) return bad("Sign in with your authorised account to continue.", 401);
  if (me.role === "viewer") return bad("Calendar viewers cannot make changes.", 403);
  const isAdmin = me.role === "admin";
  const canApprove = isAdmin || me.role === "approver";

  // ---- multipart: document upload
  if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
    const fd = await req.formData();
    const file = fd.get("file");
    const category = String(fd.get("category") || "");
    if (!(file instanceof File)) return bad("No file received.");
    if (!DOC_CATEGORIES.includes(category)) return bad("Unknown document category.");
    if (category === "LPC" && !me.admitted) return bad("LPC registration applies to admitted attorneys only.");
    try {
      const rel = await saveUpload(file, me.id);
      const [doc] = await db.insert(documents)
        .values({ ownerId: me.id, category, name: file.name, mime: file.type, size: file.size, path: rel }).returning();
      await audit(me.id, "upload", "document", doc.id, { category });
      return NextResponse.json({ ok: true, id: doc.id });
    } catch (e: any) { return bad(e.message); }
  }

  let body: any;
  try { body = await req.json(); } catch { return bad("Invalid request."); }
  const action = String(body.action || "");

  switch (action) {
    /* ---- own profile (onboarding step 1) */
    case "profile": {
      const name = String(body.name || "").trim();
      const title = String(body.title || "").trim();
      if (!name || !title) return bad("Full name and job title are required.");
      if (!isISO(body.start)) return bad("Employment start date is required.");
      const department = DEPARTMENTS.includes(body.department) ? body.department : "Legal";
      await db.update(people).set({
        name, title, department, phone: String(body.phone || "").trim() || null, start: body.start, admitted: !!body.admitted, updatedAt: new Date(),
      }).where(eq(people.id, me.id));
      await audit(me.id, "profile", "person", me.id);
      return NextResponse.json({ ok: true });
    }

    /* ---- submit onboarding for HR review */
    case "submit": {
      if (me.status !== "Draft") return bad("Onboarding has already been submitted.");
      if (!me.title || !me.start) return bad("Complete your personal and employment details first.");
      await db.update(people).set({ status: "In review", updatedAt: new Date() }).where(eq(people.id, me.id));
      await audit(me.id, "submit", "person", me.id);
      return NextResponse.json({ ok: true });
    }

    /* ---- leave request */
    case "leave": {
      if (me.status !== "Complete") return bad("Complete your onboarding before submitting leave requests.");
      if (!LEAVE_TYPES.includes(body.type)) return bad("Choose a leave type.");
      if (!isISO(body.start) || !isISO(body.end)) return bad("Valid From and To dates are required.");
      if (body.end < body.start) return bad("The To date cannot be before the From date.");
      const clash = await db.query.leave.findFirst({
        where: and(eq(leave.ownerId, me.id), inArray(leave.status, ["Pending", "Approved"]), lte(leave.start, body.end), gte(leave.end, body.start)),
      });
      if (clash) return bad("You already have a pending or approved request covering those dates.");
      const [l] = await db.insert(leave)
        .values({ ownerId: me.id, type: body.type, start: body.start, end: body.end, note: String(body.note || "").trim() || null }).returning();
      await audit(me.id, "leave.request", "leave", l.id);
      return NextResponse.json({ ok: true, id: l.id });
    }

    /* ---- approve / decline / cancel */
    case "decision": {
      const l = await db.query.leave.findFirst({ where: eq(leave.id, String(body.id || "")) });
      if (!l) return bad("Leave request not found.", 404);
      const status = body.status as string;
      if (status === "Cancelled") {
        if (l.ownerId !== me.id) return bad("Only the requester can cancel.", 403);
        if (!["Pending", "Approved"].includes(l.status)) return bad("This request can no longer be cancelled.");
      } else if (status === "Approved" || status === "Declined") {
        if (!canApprove) return bad("Not allowed.", 403);
        if (l.ownerId === me.id) return bad("Self-approval is disabled.", 403);
        if (l.status !== "Pending") return bad("This request has already been decided.");
      } else return bad("Unknown decision.");
      await db.update(leave).set({ status: status as any, decidedBy: me.id, decidedAt: new Date() }).where(eq(leave.id, l.id));
      await audit(me.id, `leave.${status.toLowerCase()}`, "leave", l.id);
      return NextResponse.json({ ok: true });
    }

    /* ---- admin: add staff member */
    case "add": {
      if (!isAdmin) return bad("Not allowed.", 403);
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const role: Role = (ROLES as readonly string[]).includes(body.role) ? body.role : "staff";
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("A full name and a valid sign-in email are required.");
      if (await db.query.people.findFirst({ where: eq(people.email, email) })) return bad("Someone with that email already exists.");
      const [p] = await db.insert(people).values({ name, email, role }).returning();
      await audit(me.id, "add", "person", p.id, { role });
      return NextResponse.json({ ok: true, id: p.id });
    }

    /* ---- admin: complete onboarding */
    case "onboard": {
      if (!isAdmin) return bad("Not allowed.", 403);
      const p = await db.query.people.findFirst({ where: eq(people.id, String(body.id || "")) });
      if (!p) return bad("Person not found.", 404);
      if (p.status !== "In review") return bad("Only submissions in review can be completed.");
      await db.update(people).set({ status: "Complete", updatedAt: new Date() }).where(eq(people.id, p.id));
      await audit(me.id, "onboard", "person", p.id);
      return NextResponse.json({ ok: true });
    }

    /* ---- admin: verify / reject document */
    case "document": {
      if (!isAdmin) return bad("Not allowed.", 403);
      const d = await db.query.documents.findFirst({ where: eq(documents.id, String(body.id || "")) });
      if (!d) return bad("Document not found.", 404);
      if (!["Verified", "Rejected"].includes(body.status)) return bad("Unknown document status.");
      await db.update(documents).set({ status: body.status }).where(eq(documents.id, d.id));
      await audit(me.id, `document.${String(body.status).toLowerCase()}`, "document", d.id);
      return NextResponse.json({ ok: true });
    }

    default:
      return bad("Unknown action.");
  }
}
