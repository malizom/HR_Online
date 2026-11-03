/**
 * Tenant provisioning (doc 01 §3 "Tenant lifecycle"; doc 02 §9 "Seed data").
 * Runs with the migration (owner) connection. Because tenant tables FORCE row-level security,
 * every write sets app.firm_id for the firm being provisioned — the same rule the app obeys.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../schema";
import { saPublicHolidays } from "./holidays";

export function ownerDb() {
  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL });
  return { db: drizzle(pool, { schema }), end: () => pool.end() };
}
type Db = ReturnType<typeof ownerDb>["db"];

export async function seedNationalHolidays(db: Db, years: number[]) {
  await db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.platform', 'on', true)`);
    for (const y of years) for (const h of saPublicHolidays(y)) {
      await tx.insert(schema.publicHolidays).values({ firmId: null, date: h.date, observedDate: h.observedDate, name: h.name, source: "statute" })
        .onConflictDoNothing();
    }
  });
}

export interface ProvisionInput {
  slug: string; legalName: string; displayName: string; hosts: string[];
  admin: { firstName: string; lastName: string; email: string; jobTitle?: string };
  departments?: string[];
}

const DEFAULT_DEPARTMENTS = ["Legal", "Litigation", "Conveyancing", "Commercial", "Finance", "Administration", "Support"];
const PDF_IMG = ["application/pdf", "image/jpeg", "image/png"];

export async function provisionFirm(db: Db, input: ProvisionInput) {
  const [firm] = await db.insert(schema.firms).values({
    slug: input.slug, legalName: input.legalName, displayName: input.displayName, status: "active", mailMode: "console",
  }).returning();
  for (const [i, host] of input.hosts.entries()) {
    await db.insert(schema.firmDomains).values({ firmId: firm.id, host: host.toLowerCase(), isPrimary: i === 0, verifiedAt: new Date() });
  }

  const adminId = await db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.firm_id', ${firm.id}, true)`);
    const f = firm.id;
    await tx.insert(schema.firmSettings).values({ firmId: f, brandName: input.displayName });
    await tx.insert(schema.departments).values((input.departments ?? DEFAULT_DEPARTMENTS).map(name => ({ firmId: f, name })));
    await tx.insert(schema.documentCategories).values([
      { firmId: f, code: "CV", label: "Full personal CV", description: "Your complete professional history.", acceptedMime: PDF_IMG, sort: 1 },
      { firmId: f, code: "ID", label: "Identity document", description: "A clear, legible copy of your ID.", acceptedMime: PDF_IMG, isSensitive: true, sort: 2 },
      { firmId: f, code: "Banking", label: "Proof of banking details", description: "Bank confirmation or proof of account.", acceptedMime: PDF_IMG, isSensitive: true, sort: 3 },
      { firmId: f, code: "Qualifications", label: "Qualifications & admission", description: "All qualifications, including admission documents.", acceptedMime: PDF_IMG, sort: 4 },
      { firmId: f, code: "MEDCERT", label: "Medical certificate", description: "For sick leave (BCEA s23). HR only.", acceptedMime: PDF_IMG, isSensitive: true, isRequired: false, sort: 9 },
      { firmId: f, code: "LPC", label: "LPC registration", description: "Required for already admitted attorneys.", acceptedMime: PDF_IMG, appliesWhen: "admitted", sort: 5 },
    ]);
    // BCEA-based leave types (B13/B14) and default policies (design doc 04 §2, pending MVR decision D1).
    const types = await tx.insert(schema.leaveTypes).values([
      { firmId: f, code: "annual", label: "Annual", category: "annual", sort: 1 },
      // Sick and family responsibility leave are unplanned: the manager arranges cover, so no colleague acceptance step.
      { firmId: f, code: "sick", label: "Sick", category: "sick", requiresCover: false, reasonVisibleTo: "hr_only", sort: 2 },
      { firmId: f, code: "family", label: "Family responsibility", category: "family_responsibility", requiresCover: false, reasonVisibleTo: "hr_only", sort: 3 },
      // One parental type for birth, adoption and surrogacy: Van Wyk v Minister of Employment and Labour [2025] ZACC 20
      // (interim regime from 3 Oct 2025: 4 months + 10 days shared between employed parents). Design doc 04 §6.
      { firmId: f, code: "parental", label: "Parental (birth, adoption, surrogacy)", category: "parental", isPaid: false, allowsHalfDay: false, requiresCover: true, sort: 4 },
      { firmId: f, code: "study", label: "Study / exam", category: "study", sort: 5 },
      { firmId: f, code: "unpaid", label: "Unpaid", category: "unpaid", isPaid: false, sort: 6 },
      { firmId: f, code: "other", label: "Other", category: "special", sort: 7 },
    ]).returning();
    const typeId = (code: string) => types.find(t => t.code === code)!.id;
    const policies = await tx.insert(schema.leavePolicies).values([
      { firmId: f, leaveTypeId: typeId("annual"), name: "Annual leave", effectiveFrom: "2020-01-01", entitlement: 15, cycleKind: "annual", cycleAnchor: "start_date",
        accrualMethod: "monthly", carryOverCap: 5, carryOverExpiryMonths: 6, minNoticeDays: 5, maxAdvanceDays: 365 },
      { firmId: f, leaveTypeId: typeId("sick"), name: "Sick leave (BCEA s22)", effectiveFrom: "2020-01-01", entitlement: 30, cycleKind: "three_year", cycleAnchor: "start_date",
        accrualMethod: "upfront", firstMonthsRule: { months: 6, perDaysWorked: 26 }, certificateAfterDays: 2, certificateOccasionsRule: { occasions: 2, weeks: 8 } },
      { firmId: f, leaveTypeId: typeId("family"), name: "Family responsibility (BCEA s27)", effectiveFrom: "2020-01-01", entitlement: 3, cycleKind: "annual", cycleAnchor: "start_date",
        accrualMethod: "upfront", minServiceMonths: 4, minDaysPerWeek: 4 },
      { firmId: f, leaveTypeId: typeId("study"), name: "Study / exam leave", effectiveFrom: "2020-01-01", entitlement: 5, cycleKind: "annual", cycleAnchor: "start_date",
        accrualMethod: "upfront", minNoticeDays: 10 },
    ]).returning();
    await tx.insert(schema.policyAssignments).values(policies.map(p => ({ firmId: f, policyId: p.id, appliesTo: "all" as const })));
    await tx.insert(schema.inductionTemplates).values([
      { firmId: f, label: "Firm orientation with HR", owner: "hr", sort: 1 },
      { firmId: f, label: "Laptop, email and practice-management access set up", owner: "hr", sort: 2 },
      { firmId: f, label: "Read the leave policy and POPIA notice", owner: "staff", sort: 3 },
    ]);
    await tx.insert(schema.retentionPolicies).values([
      { firmId: f, retentionClass: "employment_record", years: 3, basis: "after_last_entry" },
      { firmId: f, retentionClass: "payroll_related", years: 5, basis: "after_last_entry" },
      { firmId: f, retentionClass: "audit", years: 5, basis: "after_last_entry" },
      { firmId: f, retentionClass: "transient", years: 0, basis: "after_last_entry" },
    ]);
    const [admin] = await tx.insert(schema.people).values({
      firmId: f, firstName: input.admin.firstName, lastName: input.admin.lastName, workEmail: input.admin.email.toLowerCase(),
      role: "admin", jobTitle: input.admin.jobTitle ?? "HR administrator", onboardingStatus: "draft", employmentStatus: "active",
    }).returning();
    await tx.insert(schema.onboardingChecklists).values({ firmId: f, personId: admin.id, invitedAt: new Date() });
    await tx.insert(schema.auditEvents).values({ firmId: f, actorKind: "system", action: "firm.provision", subjectType: "firm", subjectId: f });
    return admin.id;
  });
  return { firm, adminId };
}
