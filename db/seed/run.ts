/**
 * Seed entry point.
 *   npm run db:seed                       -> national holidays + demo tenant (dev/staging/CI)
 *   npm run db:seed -- --firm mvr --host people.mvrlaw.co.za --admin-email tamlyn@mvrlaw.co.za \
 *        --admin-name "Tamlyn Hulley" --name "MVR Attorneys" --legal "MVR Attorneys Inc."   -> provision a real firm
 * Idempotent: an existing slug is left untouched.
 */
import { eq, sql } from "drizzle-orm";
import * as schema from "../schema";
import { ownerDb, provisionFirm, seedNationalHolidays } from "./provision";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const { db, end } = ownerDb();
  try {
    const y = new Date().getUTCFullYear();
    await seedNationalHolidays(db, [y - 1, y, y + 1, y + 2]);
    console.log("national public holidays seeded");

    const slug = arg("firm");
    if (slug) {
      const [exists] = await db.select().from(schema.firms).where(eq(schema.firms.slug, slug));
      if (exists) { console.log(`firm ${slug} already exists`); return; }
      const [first, ...rest] = (arg("admin-name") ?? "HR Administrator").split(" ");
      const { firm } = await provisionFirm(db, {
        slug, legalName: arg("legal") ?? slug, displayName: arg("name") ?? slug, hosts: (arg("host") ?? `${slug}.localhost`).split(","),
        admin: { firstName: first, lastName: rest.join(" ") || "Administrator", email: arg("admin-email")! },
      });
      console.log(`provisioned ${firm.slug} (${firm.id})`);
      return;
    }
    await seedDemo(db);
  } finally { await end(); }
}

/** Demo tenant: a small firm with a real organogram, used by CI e2e, UAT rehearsal and sales demos. */
async function seedDemo(db: ReturnType<typeof ownerDb>["db"]) {
  const [exists] = await db.select().from(schema.firms).where(eq(schema.firms.slug, "demo"));
  if (exists) { console.log("demo firm already exists"); return; }
  const { firm, adminId } = await provisionFirm(db, {
    slug: "demo", legalName: "Demo Attorneys Inc.", displayName: "Demo Attorneys", hosts: ["demo.localhost"],
    admin: { firstName: "Tamlyn", lastName: "Demo", email: "hr@demo.test", jobTitle: "Office Manager" },
  });
  await db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.firm_id', ${firm.id}, true)`);
    const depts = Object.fromEntries((await tx.select().from(schema.departments)).map(d => [d.name, d.id]));
    const add = async (first: string, last: string, title: string, dept: string, reportsTo: string | null, extra: Partial<typeof schema.people.$inferInsert> = {}) => {
      const [p] = await tx.insert(schema.people).values({
        firmId: firm.id, firstName: first, lastName: last, workEmail: `${first}.${last}@demo.test`.toLowerCase(), jobTitle: title,
        departmentId: depts[dept], reportsToId: reportsTo, startDate: "2024-02-01", onboardingStatus: "complete", employmentStatus: "active", ...extra,
      }).returning();
      return p.id;
    };
    // Organogram: two directors at the top; managers approve their direct reports.
    const md = await add("Mpho", "Director", "Managing Director", "Legal", null, { role: "manager", isFeeEarner: true, isAdmittedAttorney: true });
    const lit = await add("Lindiwe", "Litigator", "Director: Litigation", "Litigation", md, { role: "manager", isFeeEarner: true, isAdmittedAttorney: true });
    const conv = await add("Johan", "Conveyancer", "Director: Conveyancing", "Conveyancing", md, { role: "manager", isFeeEarner: true, isAdmittedAttorney: true });
    await add("Ayanda", "Associate", "Associate", "Litigation", lit, { isFeeEarner: true, isAdmittedAttorney: true });
    await add("Kagiso", "Candidate", "Candidate Attorney", "Litigation", lit, { isFeeEarner: true, employmentType: "candidate_attorney" });
    await add("Sarah", "Secretary", "Legal Secretary", "Litigation", lit);
    await add("Pieter", "Paralegal", "Paralegal", "Conveyancing", conv, { isFeeEarner: true });
    await add("Naledi", "Reception", "Receptionist", "Administration", adminId, { role: "viewer" });
    await add("Thabo", "Newstarter", "Associate", "Commercial", md, { isFeeEarner: true, onboardingStatus: "invited", employmentStatus: "pre_start", startDate: null });
    // The admin reports to the managing director; MD (top of tree) is approved via an explicit route to the admin.
    await tx.update(schema.people).set({ reportsToId: md, departmentId: depts["Administration"] }).where(eq(schema.people.id, adminId));
    await tx.insert(schema.approvalRoutes).values({ firmId: firm.id, subjectType: "leave", scope: "person", scopeValue: md, approverKind: "person", approverValue: adminId });
  });
  console.log(`demo firm seeded (${firm.id}) — sign in at http://demo.localhost:3000 as hr@demo.test`);
}

main().catch(e => { console.error(e); process.exit(1); });
