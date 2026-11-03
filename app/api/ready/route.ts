// Readiness: database reachable (doc 01 §9). Used by Container Apps probes and the deploy smoke test.
import { sql } from "drizzle-orm";
import { platformDb } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try { await platformDb.execute(sql`select 1`); return Response.json({ ok: true }); }
  catch { return Response.json({ ok: false }, { status: 503 }); }
}
