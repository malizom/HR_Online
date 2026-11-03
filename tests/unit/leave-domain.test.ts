// Leave commands against a real database: ledger writes, reservations, reversal, cover step, certificate, jobs (doc 04, doc 05 §1).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, platformDb, schema, withFirm } from "@/lib/db";
import { ownerDb, provisionFirm, seedNationalHolidays } from "@/db/seed/provision";
import type { Ctx } from "@/modules/identity/actor";
import { accrueAll, balancesFor, cycleEndAll, decideLeave, listLeave, previewLeave, requestLeave, todayIn } from "@/modules/leave";

let firmId = "";
const ids: Record<string, string> = {};
const today = todayIn();

async function ctxFor(personId: string): Promise<Ctx> {
  const [firm] = await platformDb.select().from(schema.firms).where(eq(schema.firms.id, firmId));
  const person = await withFirm(firmId, async tx => (await tx.select().from(schema.people).where(eq(schema.people.id, personId)))[0]);
  return { firm, person, actor: { firmId, personId, kind: "person" }, isManager: false };
}
const balanceOf = async (who: string, code: string) => {
  const c = await ctxFor(ids[who]);
  return withFirm(firmId, async tx => (await balancesFor(tx, c.person, today)).find(b => b.code === code)!);
};
const ledger = (who: string) => withFirm(firmId, tx => tx.select().from(schema.leaveLedger).where(eq(schema.leaveLedger.personId, ids[who])));

beforeAll(async () => {
  const { db, end } = ownerDb();
  await seedNationalHolidays(db, [2026, 2027]);
  const r = await provisionFirm(db, {
    slug: `ld-${crypto.randomBytes(4).toString("hex")}`, legalName: "Leave Test", displayName: "Leave Test", hosts: [`ld-${crypto.randomUUID()}.test`],
    admin: { firstName: "Hr", lastName: "Admin", email: `hr-${crypto.randomUUID()}@ld.test` },
  });
  firmId = r.firm.id; ids.admin = r.adminId;
  await db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.firm_id', ${firmId}, true)`);
    const [dept] = await tx.select().from(schema.departments).where(eq(schema.departments.name, "Litigation"));
    const mk = async (first: string, reportsToId: string | null, extra: Record<string, unknown> = {}) => (await tx.insert(schema.people).values({
      firmId, firstName: first, lastName: "T", workEmail: `${first}-${crypto.randomUUID()}@ld.test`, reportsToId, departmentId: dept.id,
      startDate: "2024-02-01", onboardingStatus: "complete", employmentStatus: "active", ...extra,
    }).returning())[0].id;
    ids.manager = await mk("Manager", null, { role: "manager" });
    ids.staff = await mk("Staff", ids.manager);
    ids.fee = await mk("Fee", ids.manager, { isFeeEarner: true });
    ids.colleague = await mk("Colleague", ids.manager, { isFeeEarner: true });
  });
  await end();
});
afterAll(() => closeDb());

describe("annual leave through the ledger", () => {
  let reqId = "";
  it("preview counts working days and shows balance before/after (accrual not yet posted is included)", async () => {
    const p = await previewLeave(await ctxFor(ids.staff), { type: "annual", start: "2026-12-07", end: "2026-12-11" });
    expect(p.total).toBe(5);
    expect(p.validation.ok).toBe(true);
    const b = await balanceOf("staff", "annual");
    expect(p.balance!.before).toBe(b.available);
    expect(p.balance!.after).toBe(b.available - 5);
  });

  it("request reserves days; approval writes taken; cancel writes a reversal (E14)", async () => {
    const before = (await balanceOf("staff", "annual")).available;
    const r = await requestLeave(await ctxFor(ids.staff), { type: "annual", start: "2026-12-07", end: "2026-12-11" }, "http://x/");
    reqId = r.id;
    expect((await balanceOf("staff", "annual")).available).toBe(before - 5); // reserved
    await expect(requestLeave(await ctxFor(ids.staff), { type: "annual", start: "2026-12-10", end: "2026-12-10" }, "http://x/")).rejects.toThrow(/already have/);

    await decideLeave(await ctxFor(ids.manager), reqId, "approve");
    expect((await ledger("staff")).filter(l => l.entryKind === "taken").map(l => l.days)).toEqual([-5]);
    const after = await balanceOf("staff", "annual");
    expect(after.available).toBe(before - 5);
    expect(after.reserved).toBe(0);

    await decideLeave(await ctxFor(ids.staff), reqId, "cancel");
    expect((await ledger("staff")).filter(l => l.entryKind === "reversal").map(l => l.days)).toEqual([5]);
    expect((await balanceOf("staff", "annual")).available).toBe(before);
  });

  it("E13 — over balance refused with the shortfall offered as unpaid", async () => {
    const avail = (await balanceOf("staff", "annual")).available;
    const p = await previewLeave(await ctxFor(ids.staff), { type: "annual", start: "2027-01-04", end: "2027-01-29" });
    expect(p.total).toBe(20);
    expect(p.validation.ok).toBe(false);
    const f = (n: number) => (Number.isInteger(Math.round(n * 100) / 10) ? n.toFixed(1) : n.toFixed(2)); // quarter days are never rounded away
    expect(p.validation.error).toBe(`You have ${f(avail)} days available; this request needs 20.0. You can request ${f(20 - avail)} days as unpaid.`);
  });

  it("declining needs a comment", async () => {
    const r = await requestLeave(await ctxFor(ids.staff), { type: "annual", start: "2027-01-11", end: "2027-01-11" }, "http://x/");
    await expect(decideLeave(await ctxFor(ids.manager), r.id, "decline")).rejects.toThrow(/comment is required/);
    await decideLeave(await ctxFor(ids.manager), r.id, "decline", "Trial week");
  });
});

describe("cover step for fee-earners (doc 05 §1–2)", () => {
  it("needs a colleague; colleague accepts; then the manager approves", async () => {
    await expect(requestLeave(await ctxFor(ids.fee), { type: "annual", start: "2026-12-14", end: "2026-12-15" }, "http://x/")).rejects.toThrow(/colleague to cover/);
    const r = await requestLeave(await ctxFor(ids.fee), {
      type: "annual", start: "2026-12-14", end: "2026-12-15", coverPersonId: ids.colleague,
      coverItems: [{ matterRef: "MVR/123", itemType: "court_date", due: "2026-12-15T09:30", location: "Johannesburg High Court" }, { matterRef: "MVR/999", itemType: "other", due: "2027-02-01" }],
    }, "http://x/");
    const colleagueView = await withFirm(firmId, async tx => listLeave(tx, await ctxFor(ids.colleague)));
    const item = colleagueView.find(l => l.id === r.id)!;
    expect(item.state).toBe("awaiting_cover");
    expect(item.actions).toEqual(["accept_cover", "decline_cover"]);
    expect(item.cover!.items.map(i => i.matterRef)).toEqual(["MVR/123"]); // items outside the leave window are not required
    await expect(decideLeave(await ctxFor(ids.manager), r.id, "approve")).rejects.toThrow();
    await decideLeave(await ctxFor(ids.colleague), r.id, "accept_cover");
    await decideLeave(await ctxFor(ids.manager), r.id, "approve");
    const mine = (await withFirm(firmId, async tx => listLeave(tx, await ctxFor(ids.fee)))).find(l => l.id === r.id)!;
    expect(mine.state).toBe("approved");
    expect(mine.actions).toContain("confirm_handover");
  });
});

describe("sick leave certificate (V9)", () => {
  it("three consecutive days cannot be approved without a certificate; HR may waive", async () => {
    const r = await requestLeave(await ctxFor(ids.staff), { type: "sick", start: "2026-11-09", end: "2026-11-11" }, "http://x/");
    await expect(decideLeave(await ctxFor(ids.manager), r.id, "approve")).rejects.toThrow(/medical certificate/);
    await decideLeave(await ctxFor(ids.admin), r.id, "approve", "Certificate seen on paper", { waiveCertificate: true });
  });
});

describe("jobs are idempotent", () => {
  it("accrue writes once", async () => {
    const first = await accrueAll(firmId, today);
    const second = await accrueAll(firmId, today);
    expect(first.entries).toBeGreaterThan(0);
    expect(second.entries).toBe(0);
  });

  it("cycle end carries up to the cap and proposes the excess to HR once (E7 shape)", async () => {
    await accrueAll(firmId, "2027-01-31");
    const s1 = await cycleEndAll(firmId, "2027-02-01");
    const s2 = await cycleEndAll(firmId, "2027-02-01");
    expect(s1.carried).toBeGreaterThan(0);
    expect(s2.carried).toBe(0);
    const carried = (await ledger("staff")).filter(l => l.entryKind === "carry_over_in");
    expect(carried.map(l => l.days)).toEqual([5]);
    expect(carried[0].reason).toMatch(/expires 2027-07-31/);
    const proposals = await withFirm(firmId, tx => tx.select().from(schema.notifications)
      .where(and(eq(schema.notifications.templateKey, "balance.forfeit_proposal"), eq(schema.notifications.channel, "email"))));
    expect(proposals.filter(n => (n.payload as any).person === "Staff T")).toHaveLength(1);
  });
});
