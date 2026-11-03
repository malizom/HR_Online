/**
 * /api/hr — thin adapter between the portal UI and the domain modules. No business logic here (doc 01 §4).
 *   GET                          -> portal state (me, nav, balances, leave, calendar, holidays, dashboards, settings for admins…)
 *   GET ?file=<id>               -> document download (owner or admin; access-logged)
 *   GET ?view=person&id= | reports&year= | audit&personId=&action= | myinfo
 *   POST JSON {action}: profile | submit | preview | leave | decision | handover | add | onboard | document | contact | acknowledge
 *        | delegate | revoke-delegation | branding | policy | holiday | closure-preview | closure | route | person | particulars
 *        | notice | import | payroll
 *   POST multipart {file, category}: upload
 */
import { NextResponse } from "next/server";
import { allow } from "@/lib/rate-limit";
import { withFirm } from "@/lib/db";
import { UserError } from "@/lib/storage";
import { currentCtx, type Ctx } from "@/modules/identity/actor";
import { addStaff, displayName, listDepartments, listPeople, updateOwnProfile } from "@/modules/people";
import { completeOnboarding, submitOnboarding } from "@/modules/onboarding";
import { downloadDocument, listCategories, listDocuments, reviewDocument, uploadDocument } from "@/modules/documents";
import { attachCertificate, balancesFor, calendar, confirmHandover, decideLeave, listHolidays, listLeave, listLeaveTypes, previewLeave, requestLeave } from "@/modules/leave";
import { acknowledge, adminDashboard, auditView, issueParticulars, managerDashboard, myInformation, payrollExport, pendingAcknowledgements, personFile, reports, saveEmergencyContact, setLastWorkingDay, updatePerson } from "@/modules/admin";
import { addHoliday, applyClosure, changePolicy, createDelegation, listDelegations, previewClosure, revokeDelegation, setRoute, settingsView, updateBranding } from "@/modules/settings";
import { runImport } from "@/modules/imports";
import { can, navFor } from "@/modules/permissions";
import { isDemoFirm } from "@/modules/identity/auth";
import { schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { directReportIds } from "@/modules/workflow/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (e: unknown) => {
  if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(e);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
};
const unauth = () => NextResponse.json({ error: "Sign in with your authorised account to continue." }, { status: 401 });

import { todayIn } from "@/modules/leave";
const portalUrl = (req: Request) => new URL("/", req.url).toString();

const ONBOARDING_LABEL: Record<string, string> = { invited: "Draft", draft: "Draft", in_review: "In review", complete: "Complete" };
const DOC_LABEL: Record<string, string> = { pending: "Pending", verified: "Verified", rejected: "Rejected", superseded: "Superseded" };

export async function GET(req: Request) {
  const ctx = await currentCtx();
  if (!ctx) return unauth();
  try {
    const fileId = new URL(req.url).searchParams.get("file");
    if (fileId) {
      const { doc, bytes } = await downloadDocument(ctx, fileId);
      return new NextResponse(new Uint8Array(bytes), { headers: {
        "Content-Type": doc.mime, "Content-Disposition": `inline; filename="${doc.fileName.replace(/[^\w.\- ]/g, "_")}"`, "Cache-Control": "private, no-store",
      } });
    }
    const q = new URL(req.url).searchParams;
    switch (q.get("view")) {
      case "person": return NextResponse.json(await personFile(ctx, String(q.get("id"))));
      case "reports": return NextResponse.json(await reports(ctx, Number(q.get("year")) || Number(todayIn(ctx.firm.timezone).slice(0, 4))));
      case "audit": return NextResponse.json(await auditView(ctx, Object.fromEntries([...q.entries()].filter(([k, v]) => k !== "view" && v))));
      case "myinfo": return new NextResponse(JSON.stringify(await myInformation(ctx), null, 2), { headers: {
        "Content-Type": "application/json", "Content-Disposition": `attachment; filename="my-information.json"`, "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json(await state(ctx));
  } catch (e) { return fail(e); }
}

async function state(ctx: Ctx) {
  const today = todayIn(ctx.firm.timezone);
  const isAdmin = ctx.person.role === "admin";
  const isViewer = ctx.person.role === "viewer";
  return withFirm(ctx.firm.id, async tx => {
    const reports = await directReportIds(tx, ctx.person.id);
    const who = { id: ctx.person.id, role: ctx.person.role, isManager: ctx.isManager };
    const year = Number(today.slice(0, 4));
    const [balances, holidays, acks, contacts, delegations, dashboard, team, settings, [branding], closures] = await Promise.all([
      isViewer ? Promise.resolve([]) : balancesFor(tx, ctx.person, today),
      listHolidays(tx, `${year - 1}-01-01`, `${year + 1}-12-31`),
      isViewer ? Promise.resolve([]) : pendingAcknowledgements(tx, ctx),
      tx.select().from(schema.emergencyContacts).where(eq(schema.emergencyContacts.personId, ctx.person.id)),
      isViewer ? Promise.resolve([]) : listDelegations(tx, ctx),
      isAdmin ? adminDashboard(tx, ctx) : Promise.resolve(null),
      ctx.isManager || isAdmin ? managerDashboard(tx, ctx) : Promise.resolve(null),
      isAdmin ? settingsView(tx) : Promise.resolve(null),
      tx.select().from(schema.firmSettings),
      tx.select().from(schema.firmClosures),
    ]);
    const allPeople = await listPeople(tx, { all: true });
    const [peopleRows, docRows, leave, cal, departments, leaveTypes, categories] = await Promise.all([
      Promise.resolve(isAdmin ? allPeople : allPeople.filter(r => [ctx.person.id, ...reports].includes(r.p.id))),
      isViewer ? Promise.resolve([]) : listDocuments(tx, { all: isAdmin, personId: ctx.person.id }),
      isViewer ? Promise.resolve([]) : listLeave(tx, ctx),
      calendar(tx, `${today.slice(0, 4)}-01-01`),
      listDepartments(tx), listLeaveTypes(tx), listCategories(tx),
    ]);
    const shape = (p: (typeof peopleRows)[number]["p"], dept: string | null) => ({
      id: p.id, owner: p.id, name: displayName(p), email: p.workEmail, role: p.role,
      status: ONBOARDING_LABEL[p.onboardingStatus], admitted: p.isAdmittedAttorney, phone: p.phone ?? "", title: p.jobTitle ?? "",
      department: dept ?? "", departmentId: p.departmentId, start: p.startDate ?? "", reportsToId: p.reportsToId,
    });
    const meRow = peopleRows.find(r => r.p.id === ctx.person.id);
    return {
      me: { ...shape(ctx.person, meRow?.dept ?? null), isManager: ctx.isManager, directReports: reports.length },
      people: peopleRows.map(r => shape(r.p, r.dept)),
      // Directory-level names for the cover picker and delegation (class P only; doc 08 §2).
      colleagues: isViewer ? [] : allPeople.filter(r => r.p.id !== ctx.person.id && r.p.onboardingStatus === "complete" && r.p.employmentStatus === "active")
        .map(r => ({ id: r.p.id, name: displayName(r.p), department: r.dept ?? "", isFeeEarner: r.p.isFeeEarner, title: r.p.jobTitle ?? "" })),
      documents: docRows.map(({ d, code }) => ({ id: d.id, owner: d.personId, category: code, name: d.fileName, status: DOC_LABEL[d.status], reason: d.rejectionReason ?? "" })),
      nav: navFor({ ...who, onboardingComplete: ctx.person.onboardingStatus === "complete" }),
      can: { onBehalf: can(who, "leave.request_on_behalf"), payroll: can(who, "payroll.export"), imports: can(who, "imports.run") },
      balances, holidays, acknowledgements: acks, delegations, dashboard, team, settings,
      closures: closures.filter(c => c.appliedAt).map(c => ({ name: c.name, start: c.startDate, end: c.endDate })),
      emergencyContact: contacts[0] ? { name: contacts[0].name, relationship: contacts[0].relationship, phone: contacts[0].phone } : null,
      leave, calendar: cal, today, departments, leaveTypes,
      categories: categories.filter(c => c.isRequired).map(c => ({ code: c.code, label: c.label, description: c.description ?? "", appliesWhen: c.appliesWhen, required: c.isRequired })),
      demo: isDemoFirm(ctx.firm),
      firm: { name: branding?.brandName ?? ctx.firm.displayName, primary: branding?.primaryColour ?? "#29553d", accent: branding?.accentColour ?? "#6a9872" },
    };
  });
}

export async function POST(req: Request) {
  const ctx = await currentCtx();
  if (!ctx) return unauth();
  try {
    const upload = (req.headers.get("content-type") || "").includes("multipart/form-data");
    if (!allow(`w:${ctx.person.id}`, 120, 60_000) || (upload && !allow(`u:${ctx.person.id}`, 20, 600_000)))
      throw new UserError("Too many requests — please wait a minute and try again.", 429);
    if (upload) {
      const fd = await req.formData();
      const file = fd.get("file");
      if (!(file instanceof File)) throw new UserError("No file received.");
      const leaveId = fd.get("leaveRequestId");
      const doc = await uploadDocument(ctx, file, leaveId ? "MEDCERT" : String(fd.get("category") || ""));
      if (leaveId) await attachCertificate(ctx, String(leaveId), doc.id);
      return NextResponse.json({ ok: true, id: doc.id });
    }
    const body = await req.json().catch(() => { throw new UserError("Invalid request."); });
    switch (body.action) {
      case "profile": await updateOwnProfile(ctx, { ...body, admitted: !!body.admitted }); break;
      case "submit": await submitOnboarding(ctx, portalUrl(req)); break;
      case "preview": return NextResponse.json(await previewLeave(ctx, body));
      case "leave": await requestLeave(ctx, body, portalUrl(req)); break;
      case "decision": await decideLeave(ctx, String(body.id), String(body.status), body.comment,
        { coverPersonId: body.coverPersonId, waiveCertificate: !!body.waiveCertificate, portalUrl: portalUrl(req) }); break;
      case "handover": await confirmHandover(ctx, String(body.id)); break;
      case "contact": await saveEmergencyContact(ctx, body); break;
      case "acknowledge": await acknowledge(ctx, String(body.id), { ip: req.headers.get("x-forwarded-for"), userAgent: req.headers.get("user-agent"), typedName: body.typedName }); break;
      case "delegate": await createDelegation(ctx, body); break;
      case "revoke-delegation": await revokeDelegation(ctx, String(body.id)); break;
      case "branding": await updateBranding(ctx, body); break;
      case "policy": await changePolicy(ctx, body); break;
      case "holiday": await addHoliday(ctx, body); break;
      case "closure-preview": return NextResponse.json(await previewClosure(ctx, body));
      case "closure": return NextResponse.json(await applyClosure(ctx, body));
      case "route": await setRoute(ctx, body); break;
      case "person": await updatePerson(ctx, String(body.id), body.changes); break;
      case "particulars": return NextResponse.json(await issueParticulars(ctx, String(body.id)));
      case "notice": await setLastWorkingDay(ctx, String(body.id), body); break;
      case "import": return NextResponse.json(await runImport(ctx, body.kind === "balances" ? "balances" : "staff", String(body.csv ?? ""), !!body.apply));
      case "payroll": return NextResponse.json(await payrollExport(ctx, body));
      case "add": await addStaff(ctx, body, portalUrl(req)); break;
      case "onboard": await completeOnboarding(ctx, String(body.id)); break;
      case "document": await reviewDocument(ctx, String(body.id), body.status === "Verified" ? "verified" : "rejected", body.reason); break;
      default: throw new UserError("Unknown action.");
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}
