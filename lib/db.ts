/**
 * Database access. Two entry points only:
 *   - platformDb: platform tables (firms, firm_domains, job_runs, sign_ins). No tenant data is reachable:
 *     every tenant table has FORCE ROW LEVEL SECURITY and returns zero rows without app.firm_id.
 *   - withFirm(firmId, fn): a transaction with app.firm_id set; the ONLY way to touch tenant tables.
 * Design doc 01 §3. Direct use of `pool` outside this file is forbidden (eslint + CI grep).
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { pgPassword } from "./pg-auth";

const g = globalThis as unknown as { __ppPool?: Pool };
const pool = g.__ppPool ?? new Pool({ connectionString: process.env.DATABASE_URL, password: pgPassword(process.env.DATABASE_URL), max: 10, ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: true } : undefined });
if (process.env.NODE_ENV !== "production") g.__ppPool = pool;

const base = drizzle(pool, { schema });

export type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];

/** Platform tables only. */
export const platformDb = base;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Run `fn` inside a transaction scoped to one firm. RLS enforces the scope in Postgres. */
export async function withFirm<T>(firmId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(firmId)) throw new Error("withFirm: invalid firm id");
  return base.transaction(async tx => {
    await tx.execute(sql`select set_config('app.firm_id', ${firmId}, true)`);
    return fn(tx);
  });
}

export { schema };

/** Test/maintenance hook to close the pool. */
export const closeDb = () => pool.end();
