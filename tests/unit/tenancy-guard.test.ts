// Fails the build if any table escapes the tenancy rules (doc 01 §3 isolation enforcement 1–3).
import { afterAll, describe, expect, it } from "vitest";
import { PLATFORM_TABLES } from "@/db/schema";
import { ownerClient } from "./_fixtures";
import pg from "pg";

let c: pg.Client;
afterAll(async () => { await c?.end(); });

describe("tenancy guard", () => {
  it("every non-platform table has firm_id, RLS enabled and forced, and a policy", async () => {
    c = await ownerClient();
    const { rows } = await c.query(`
      select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
        exists (select 1 from information_schema.columns col where col.table_schema='public' and col.table_name=c.relname and col.column_name='firm_id') as has_firm,
        (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname)::int as policies
      from pg_class c where c.relkind='r' and c.relnamespace='public'::regnamespace and c.relname not like '\\_\\_%'`);
    const platform = new Set<string>(PLATFORM_TABLES);
    const offenders = rows.filter(r => !platform.has(r.name) && !(r.rls && r.forced && r.has_firm && r.policies > 0)).map(r => r.name);
    expect(offenders).toEqual([]);
  });

  it("the application role is not a superuser and cannot bypass RLS", async () => {
    const { rows: [r] } = await c.query(`select rolsuper, rolbypassrls from pg_roles where rolname='pp_app'`);
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("append-only tables cannot be updated or deleted by the application role", async () => {
    const { rows } = await c.query(`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee='pp_app' and privilege_type in ('UPDATE','DELETE')
        and table_name in ('audit_events','access_log','leave_ledger','acknowledgements','workflow_steps','sign_ins')`);
    expect(rows).toEqual([]);
  });

  it("no table grants DELETE to the application role", async () => {
    const { rows } = await c.query(`select table_name from information_schema.role_table_grants where grantee='pp_app' and privilege_type='DELETE'`);
    expect(rows).toEqual([]);
  });
});
