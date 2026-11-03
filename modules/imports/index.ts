/**
 * Go-live imports (doc 07 §5; doc 06 F6): staff CSV and opening-balances CSV.
 * Validate first (row-numbered report); apply only when there are zero errors. Every run is recorded in `imports`.
 */
import { eq } from "drizzle-orm";
import { schema, withFirm, type Tx } from "@/lib/db";
import { putBytes, UserError } from "@/lib/storage";
import { audit } from "../audit";
import { can } from "../permissions";
import type { Ctx } from "../identity/actor";
import { loadPolicies } from "../leave";
import { cycleFor, resolvePolicy } from "../leave/engine";
import { startWorkflow } from "../workflow/engine";

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some(c => c.trim())) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some(c => c.trim())) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map(h => h.trim().toLowerCase());
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

const DAYS: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
function parsePattern(s: string): number[] | null {
  if (!s) return null;
  const m = s.toLowerCase().match(/^(mon|tue|wed|thu|fri|sat|sun)-(mon|tue|wed|thu|fri|sat|sun)$/);
  if (m) { const a = DAYS[m[1]], b = DAYS[m[2]]; return a <= b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : null; }
  const parts = s.toLowerCase().split(/[,; ]+/).map(x => DAYS[x.slice(0, 3)]);
  return parts.every(Boolean) ? parts : null;
}
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const YN = (s: string) => /^(y|yes|true|1)$/i.test(s);
const ROLES = ["admin", "manager", "staff", "viewer"];
const TYPES = ["permanent", "fixed_term", "candidate_attorney", "contractor", "part_time"];
const LEAVE_CODES: Record<string, string> = { ANN: "annual", SICK: "sick", FAM: "family", STUDY: "study" };

export interface ImportReport { kind: string; rows: number; errors: { row: number; message: string }[]; applied?: number }

async function validateStaff(tx: Tx, rows: Record<string, string>[]) {
  const errors: ImportReport["errors"] = [];
  const existing = await tx.select().from(schema.people);
  const depts = new Map((await tx.select().from(schema.departments)).map(d => [d.name.toLowerCase(), d.id]));
  const emails = new Set<string>(), nos = new Set<string>();
  const known = new Set([...existing.map(p => p.workEmail.toLowerCase()), ...rows.map(r => (r.work_email ?? "").toLowerCase())]);
  rows.forEach((r, i) => {
    const n = i + 2, e = (r.work_email ?? "").toLowerCase();
    const err = (m: string) => errors.push({ row: n, message: m });
    if (!r.first_name || !r.last_name) err("first_name and last_name are required");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) err("work_email is not a valid email");
    if (emails.has(e)) err(`duplicate email ${e} in the file`); emails.add(e);
    if (existing.some(p => p.workEmail.toLowerCase() === e)) err(`${e} already exists in the portal`);
    if (r.employee_no) { if (nos.has(r.employee_no) || existing.some(p => p.employeeNo === r.employee_no)) err(`duplicate employee_no ${r.employee_no}`); nos.add(r.employee_no); }
    if (r.department && !depts.has(r.department.toLowerCase())) err(`department "${r.department}" does not exist`);
    if (r.reports_to_email && !known.has(r.reports_to_email.toLowerCase())) err(`reports_to_email ${r.reports_to_email} is not in the file or the firm`);
    if (r.role && !ROLES.includes(r.role)) err(`role must be one of ${ROLES.join(", ")}`);
    if (r.employment_type && !TYPES.includes(r.employment_type)) err(`employment_type must be one of ${TYPES.join(", ")}`);
    if (r.start_date && !isDate(r.start_date)) err("start_date must be YYYY-MM-DD");
    if (r.work_pattern && !parsePattern(r.work_pattern)) err("work_pattern must look like Mon-Fri or Mon,Tue,Wed,Thu");
  });
  // Reporting cycles within the file.
  const up = new Map(rows.map(r => [(r.work_email ?? "").toLowerCase(), (r.reports_to_email ?? "").toLowerCase()]));
  rows.forEach((r, i) => {
    let cur = up.get((r.work_email ?? "").toLowerCase()), steps = 0;
    while (cur && steps++ < 100) { if (cur === (r.work_email ?? "").toLowerCase()) { errors.push({ row: i + 2, message: "reporting loop" }); break; } cur = up.get(cur); }
  });
  return { errors, depts };
}

async function validateBalances(tx: Tx, rows: Record<string, string>[]) {
  const errors: ImportReport["errors"] = [];
  const people = new Map((await tx.select().from(schema.people)).filter(p => p.employeeNo).map(p => [p.employeeNo!, p]));
  const prior = await tx.select().from(schema.leaveLedger).where(eq(schema.leaveLedger.entryKind, "opening"));
  rows.forEach((r, i) => {
    const err = (m: string) => errors.push({ row: i + 2, message: m });
    const p = people.get(r.employee_no);
    if (!p) err(`employee_no ${r.employee_no} not found`);
    if (!LEAVE_CODES[r.leave_code?.toUpperCase()]) err(`leave_code must be one of ${Object.keys(LEAVE_CODES).join(", ")}`);
    if (!isDate(r.as_at_date)) err("as_at_date must be YYYY-MM-DD");
    if (isNaN(Number(r.available_days))) err("available_days must be a number");
    if (p && prior.some(l => l.personId === p.id && l.effectiveDate === r.as_at_date)) err("opening balance already imported for this date — use an adjustment instead");
  });
  return { errors, people };
}

export async function runImport(ctx: Ctx, kind: "staff" | "balances", csv: string, apply: boolean): Promise<ImportReport> {
  if (!can({ id: ctx.person.id, role: ctx.person.role, isManager: ctx.isManager }, "imports.run")) throw new UserError("Not allowed.", 403);
  const rows = parseCsv(csv);
  if (!rows.length) throw new UserError("The file has no data rows.");
  if (rows.length > 2000) throw new UserError("Import at most 2,000 rows at a time.");
  return withFirm(ctx.firm.id, async tx => {
    const report: ImportReport = { kind, rows: rows.length, errors: [] };
    const v = kind === "staff" ? await validateStaff(tx, rows) : await validateBalances(tx, rows);
    report.errors = v.errors;
    const blobPath = `${ctx.firm.id}/imports/${kind}-${Date.now()}.csv`;
    await putBytes(ctx.firm.id, blobPath, Buffer.from(csv), "text/csv");
    const canApply = apply && !report.errors.length;
    if (canApply && kind === "staff") {
      const { depts } = v as Awaited<ReturnType<typeof validateStaff>>;
      const byEmail = new Map<string, string>();
      for (const r of rows) {
        const [p] = await tx.insert(schema.people).values({
          firmId: ctx.firm.id, employeeNo: r.employee_no || null, firstName: r.first_name, lastName: r.last_name, workEmail: r.work_email.toLowerCase(),
          jobTitle: r.job_title || null, departmentId: r.department ? depts.get(r.department.toLowerCase()) ?? null : null, role: (r.role || "staff") as any,
          employmentType: (r.employment_type || "permanent") as any, isFeeEarner: YN(r.is_fee_earner), isAdmittedAttorney: YN(r.is_admitted_attorney),
          startDate: r.start_date || null, workPattern: parsePattern(r.work_pattern), onboardingStatus: "invited", createdBy: ctx.person.id,
        }).returning();
        byEmail.set(p.workEmail, p.id);
        await tx.insert(schema.onboardingChecklists).values({ firmId: ctx.firm.id, personId: p.id, invitedAt: new Date(), createdBy: ctx.person.id });
        await startWorkflow(tx, ctx.actor, "onboarding", "person", p.id);
      }
      const all = new Map((await tx.select().from(schema.people)).map(p => [p.workEmail.toLowerCase(), p.id]));
      for (const r of rows) if (r.reports_to_email) await tx.update(schema.people).set({ reportsToId: all.get(r.reports_to_email.toLowerCase()) }).where(eq(schema.people.id, byEmail.get(r.work_email.toLowerCase())!));
      report.applied = rows.length;
    }
    if (canApply && kind === "balances") {
      const { people } = v as Awaited<ReturnType<typeof validateBalances>>;
      const { policies, assignments } = await loadPolicies(tx);
      const types = new Map((await tx.select().from(schema.leaveTypes)).map(t => [t.code, t]));
      let n = 0;
      for (const r of rows) {
        const p = people.get(r.employee_no)!, t = types.get(LEAVE_CODES[r.leave_code.toUpperCase()])!;
        const facts = { id: p.id, startDate: p.startDate, pattern: p.workPattern, employmentType: p.employmentType, departmentId: p.departmentId };
        const pol = resolvePolicy(policies, assignments, facts, t.id, r.as_at_date);
        if (!pol) continue;
        const c = cycleFor(pol, facts, r.as_at_date);
        await tx.insert(schema.leaveLedger).values({ firmId: ctx.firm.id, personId: p.id, leaveTypeId: t.id, cycleStart: c.start, cycleEnd: c.end, entryKind: "opening",
          days: Number(r.available_days), effectiveDate: r.as_at_date, sourceKind: "import", reason: `Opening balance as at ${r.as_at_date}`, policyId: pol.id, policyVersion: pol.version, createdBy: ctx.person.id });
        n++;
      }
      report.applied = n;
    }
    await tx.insert(schema.imports).values({ firmId: ctx.firm.id, kind, blobPath, status: canApply ? "applied" : report.errors.length ? "failed" : "validated",
      rowCount: rows.length, errorCount: report.errors.length, report, validatedAt: new Date(), appliedAt: canApply ? new Date() : null, appliedBy: canApply ? ctx.person.id : null });
    await audit(tx, ctx.actor, `import.${kind}.${canApply ? "apply" : "validate"}`, "import", null, { rows: rows.length, errors: report.errors.length });
    return report;
  });
}
