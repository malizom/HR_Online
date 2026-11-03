// S0 exit gate: "a second tenant provably invisible to the first" (doc 00 §4).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { platformDb, schema, withFirm, closeDb } from "@/lib/db";
import { firmByHost, clearTenantCache } from "@/lib/tenancy";
import { makeFirm, ownerClient } from "./_fixtures";

let A: Awaited<ReturnType<typeof makeFirm>>, B: Awaited<ReturnType<typeof makeFirm>>;

beforeAll(async () => {
  const c = await ownerClient();
  A = await makeFirm(c, "firm-a");
  B = await makeFirm(c, "firm-b");
  await c.end();
});
afterAll(async () => { await closeDb(); });

describe("tenant isolation", () => {
  it("resolves a firm from its host and nothing from an unknown host", async () => {
    clearTenantCache();
    expect((await firmByHost(A.host))?.id).toBe(A.id);
    expect((await firmByHost(`${B.host}:443`))?.id).toBe(B.id);
    expect(await firmByHost("unknown.example")).toBeNull();
  });

  it("sees only its own rows inside withFirm, even with no where-clause", async () => {
    const rowsA = await withFirm(A.id, tx => tx.select().from(schema.people));
    const rowsB = await withFirm(B.id, tx => tx.select().from(schema.people));
    expect(rowsA.every(p => p.firmId === A.id)).toBe(true);
    expect(rowsB.every(p => p.firmId === B.id)).toBe(true);
    expect(rowsA.some(p => p.id === B.personId)).toBe(false);
  });

  it("cannot read another firm's row by id", async () => {
    const rows = await withFirm(A.id, tx => tx.select().from(schema.people).where(eq(schema.people.id, B.personId)));
    expect(rows).toHaveLength(0);
  });

  it("fails closed: tenant tables return nothing outside withFirm", async () => {
    const rows = await platformDb.select().from(schema.people);
    expect(rows).toHaveLength(0);
  });

  it("cannot write a row into another firm", async () => {
    const err = await withFirm(A.id, tx => tx.insert(schema.people).values({
      firmId: B.id, firstName: "Mallory", lastName: "X", workEmail: "m@x.test",
    })).then(() => null, e => e);
    expect(String(err?.cause?.message ?? err?.message)).toMatch(/row-level security/);
  });

  it("cannot update another firm's row (silently affects zero rows)", async () => {
    const res = await withFirm(A.id, tx =>
      tx.update(schema.people).set({ jobTitle: "hijacked" }).where(eq(schema.people.id, B.personId)).returning());
    expect(res).toHaveLength(0);
  });

  it("does not leak across concurrent transactions", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => {
      const f = i % 2 ? A : B;
      return withFirm(f.id, async tx => {
        await tx.execute(sql`select pg_sleep(0.01)`);
        const r = await tx.select().from(schema.people);
        return r.every(p => p.firmId === f.id);
      });
    }));
    expect(results.every(Boolean)).toBe(true);
  });

  it("app.firm_id does not persist on the pooled connection after the transaction", async () => {
    await withFirm(A.id, async () => {});
    const r = await platformDb.execute(sql`select nullif(current_setting('app.firm_id', true), '') as v`);
    expect(r.rows[0].v).toBeNull();
  });
});
