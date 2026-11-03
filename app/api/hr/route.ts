/**
 * /api/hr — thin adapter between the portal UI and the domain modules. No business logic here (doc 01 §4).
 *   GET              -> { me, people, documents, leave, calendar, today, departments, leaveTypes, categories }
 *   GET ?file=<id>   -> document download (owner or admin; access-logged)
 *   POST JSON {action}: profile | submit | leave | decision | add | onboard | document
 *   POST multipart {file, category}: upload
 */
import { NextResponse } from "next/server";
import { withFirm } from "@/lib/db";
import { UserError } from "@/lib/storage";
import { currentCtx, type Ctx } from "@/modules/identity/actor";
import { addStaff, displayName, listDepartments, listPeople, updateOwnProfile } from "@/modules/people";
import { completeOnboarding, submitOnboarding } from "@/modules/onboarding";
import { downloadDocument, listCategories, listDocuments, reviewDocument, uploadDocument } from "@/modules/documents";
import { calendar, decideLeave, listLeave, listLeaveTypes, requestLeave } from "@/modules/leave";
import { directReportIds } from "@/modules/workflow/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (e: unknown) => {
  if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(e);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
};
const unauth = () => NextResponse.json({ error: "Sign in with your authorised account to continue." }, { status: 401 });

const todayIn = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
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
    return NextResponse.json(await state(ctx));
  } catch (e) { return fail(e); }
}

async function state(ctx: Ctx) {
  const today = todayIn(ctx.firm.timezone);
  const isAdmin = ctx.person.role === "admin";
  const isViewer = ctx.person.role === "viewer";
  return withFirm(ctx.firm.id, async tx => {
    const reports = await directReportIds(tx, ctx.person.id);
    const [peopleRows, docRows, leave, cal, departments, leaveTypes, categories] = await Promise.all([
      listPeople(tx, { all: isAdmin, ids: [ctx.person.id, ...reports] }),
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
      documents: docRows.map(({ d, code }) => ({ id: d.id, owner: d.personId, category: code, name: d.fileName, status: DOC_LABEL[d.status] })),
      leave, calendar: cal, today, departments, leaveTypes,
      categories: categories.map(c => ({ code: c.code, label: c.label, description: c.description ?? "", appliesWhen: c.appliesWhen, required: c.isRequired })),
      firm: { name: ctx.firm.displayName },
    };
  });
}

export async function POST(req: Request) {
  const ctx = await currentCtx();
  if (!ctx) return unauth();
  try {
    if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
      const fd = await req.formData();
      const file = fd.get("file");
      if (!(file instanceof File)) throw new UserError("No file received.");
      const doc = await uploadDocument(ctx, file, String(fd.get("category") || ""));
      return NextResponse.json({ ok: true, id: doc.id });
    }
    const body = await req.json().catch(() => { throw new UserError("Invalid request."); });
    switch (body.action) {
      case "profile": await updateOwnProfile(ctx, { ...body, admitted: !!body.admitted }); break;
      case "submit": await submitOnboarding(ctx, portalUrl(req)); break;
      case "leave": await requestLeave(ctx, body, portalUrl(req)); break;
      case "decision": await decideLeave(ctx, String(body.id), String(body.status), body.comment); break;
      case "add": await addStaff(ctx, body, portalUrl(req)); break;
      case "onboard": await completeOnboarding(ctx, String(body.id)); break;
      case "document": await reviewDocument(ctx, String(body.id), body.status === "Verified" ? "verified" : "rejected", body.reason); break;
      default: throw new UserError("Unknown action.");
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}
