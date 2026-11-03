/**
 * Seed entry point.
 *   npm run db:seed                       -> national holidays + demo tenant (dev/staging/CI)
 *   npm run db:seed -- --firm mvr --host people.mvrlaw.co.za --admin-email tamlyn@mvrlaw.co.za \
 *        --admin-name "Tamlyn Hulley" --name "MVR Attorneys" --legal "MVR Attorneys Inc."   -> provision a real firm
 * Idempotent: an existing slug is left untouched (its hosts are still added).
 * Env: SEED_DEMO=false skips the demo firm (production); DEMO_HOSTS=a,b sets its hosts; SEED_DEMO_ACTIVITY=false leaves
 * the leave history to the jobs container ("seed-demo"), which has storage access in Azure.
 */
import { eq, sql } from "drizzle-orm";
import * as schema from "../schema";
import { ownerDb, provisionFirm, seedNationalHolidays } from "./provision";
import { seedDemoActivity } from "./demo-activity";
import { closeDb } from "@/lib/db";

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
    if (process.env.SEED_DEMO !== "false") await seedDemo(db);
  } finally { await end(); await closeDb(); }
}

/** Demo tenant: a small firm with a real organogram, used by CI e2e, UAT rehearsal and sales demos. */
async function seedDemo(db: ReturnType<typeof ownerDb>["db"]) {
  const hosts = (process.env.DEMO_HOSTS ?? "demo.localhost").split(",").map(h => h.trim().toLowerCase()).filter(Boolean);
  const [exists] = await db.select().from(schema.firms).where(eq(schema.firms.slug, "demo"));
  if (exists) {
    for (const host of hosts) await db.insert(schema.firmDomains).values({ firmId: exists.id, host, isPrimary: false, verifiedAt: new Date() }).onConflictDoNothing();
    console.log("demo firm already exists; hosts ensured"); return;
  }
  // Real names and titles from mvrlaw.co.za/our-team (public), for MVR's own demo. Emails are fictional (@demo.test),
  // so nothing ever reaches a real inbox. Sensitive demo scenarios (sick leave, private reasons, rejected documents)
  // are given to clearly fictional support staff only — never to a real person's name.
  const { firm, adminId } = await provisionFirm(db, {
    slug: "demo", legalName: "MVR Attorneys Inc. (demo)", displayName: "MVR Attorneys", hosts,
    admin: { firstName: "Tamlyn", lastName: "Hulley", email: "tamlyn.hulley@demo.test", jobTitle: "Office Manager" },
    departments: ["Corporate & Commercial", "Dispute Resolution", "Banking & Finance", "Labour Law", "Competition & Regulatory", "Energy", "Public Law", "Administration"],
  });
  await db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.firm_id', ${firm.id}, true)`);
    const depts = Object.fromEntries((await tx.select().from(schema.departments)).map(d => [d.name, d.id]));
    let no = 1;
    const add = async (first: string, last: string, title: string, dept: string, reportsTo: string | null, extra: Partial<typeof schema.people.$inferInsert> = {}) => {
      const [p] = await tx.insert(schema.people).values({ employeeNo: `MVR${String(++no).padStart(4, "0")}`, phone: "+27 11 555 01" + String(no).padStart(2, "0"),
        firmId: firm.id, firstName: first, lastName: last, workEmail: `${first}.${last}@demo.test`.toLowerCase().replace(/\s+/g, ""), jobTitle: title,
        departmentId: depts[dept], reportsToId: reportsTo, startDate: "2024-02-01", onboardingStatus: "complete", employmentStatus: "active", ...extra,
      }).returning();
      return p.id;
    };
    const admitted = { isFeeEarner: true, isAdmittedAttorney: true };
    const exec = { role: "manager" as const, ...admitted };
    // Organogram: the managing director at the top; executives approve for their teams.
    const md = await add("Matodzi", "Ratshimbilani", "Managing Director", "Corporate & Commercial", null, exec);
    const robyn = await add("Robyn", "Adams", "Executive: Dispute Resolution", "Dispute Resolution", md, exec);
    const eduan = await add("Eduan", "Kapp", "Executive: Banking & Finance", "Banking & Finance", md, exec);
    const fair = await add("Fair", "Manikai", "Executive: Labour Law", "Labour Law", md, exec);
    await add("Mashudu", "Mundalamo", "Executive: Labour Law", "Labour Law", md, exec);
    const maphanga = await add("Maphanga", "Maseko", "Executive: Competition & Regulatory", "Competition & Regulatory", md, exec);
    const nonkosi = await add("Nonkosi", "Koranteng", "Executive: Energy", "Energy", md, exec);
    await add("Tiyiselani", "Sono", "Consultant: Public Law & Regulatory", "Public Law", md, { ...admitted, employmentType: "contractor" });
    await add("Ivan", "Phahle", "Associate", "Dispute Resolution", robyn, admitted);
    await add("Tana", "Patsa", "Associate", "Competition & Regulatory", maphanga, admitted);
    await add("Tumelo", "Mootane", "Associate", "Energy", nonkosi, admitted);
    await add("Muano", "Ramurunzi", "Candidate Attorney", "Dispute Resolution", robyn, { isFeeEarner: true, employmentType: "candidate_attorney", startDate: "2026-02-02" });
    await add("Malaika", "Mazibuko", "Candidate Attorney", "Labour Law", fair, { isFeeEarner: true, employmentType: "candidate_attorney", startDate: "2026-02-02" });
    await add("Siyabonga", "Majija", "Candidate Attorney", "Banking & Finance", eduan, { isFeeEarner: true, employmentType: "candidate_attorney", startDate: "2026-02-02" });
    // Fictional support staff (carry the sensitive demo scenarios).
    await add("Sarah", "Secretary", "Legal Secretary (fictional)", "Dispute Resolution", robyn);
    await add("Pieter", "Paralegal", "Paralegal (fictional)", "Banking & Finance", eduan, { isFeeEarner: true, workPattern: [1, 2, 3, 4], employmentType: "part_time" });
    await add("Naledi", "Reception", "Receptionist (fictional)", "Administration", adminId, { role: "viewer" });
    await add("Thabo", "Newstarter", "Associate (fictional new starter)", "Corporate & Commercial", md, { isFeeEarner: true, onboardingStatus: "invited", employmentStatus: "pre_start", startDate: null });
    // HR administrator reports to the MD; the MD (top of tree) is approved via an explicit route to HR.
    await tx.update(schema.people).set({ reportsToId: md, departmentId: depts["Administration"], employeeNo: "MVR0001", startDate: "2023-03-01",
      onboardingStatus: "complete", employmentStatus: "active" }).where(eq(schema.people.id, adminId));
    await tx.insert(schema.approvalRoutes).values({ firmId: firm.id, subjectType: "leave", scope: "person", scopeValue: md, approverKind: "person", approverValue: adminId });
  });
  if (process.env.SEED_DEMO_ACTIVITY !== "false") await seedDemoActivity(firm.id);
  console.log(`demo firm seeded (${firm.id}) — sign in at http://demo.localhost:3000`);
}

main().catch(e => { console.error(e); process.exit(1); });
