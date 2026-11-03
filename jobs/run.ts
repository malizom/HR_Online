/**
 * Jobs runner (doc 01 §2 "Job path"). Same image as the web app; Azure runs it as a Container Apps Job
 * daily at 02:00 SAST and on demand. Each job is idempotent and recorded in job_runs per firm.
 *   npm run jobs                 -> all jobs for all active firms
 *   npm run jobs -- dispatch     -> one job
 * S1 adds: accrue, carry-over, rebuild-balances (consistency check); R2: retention, sage-export.
 */
import { eq } from "drizzle-orm";
import { closeDb, platformDb, schema } from "@/lib/db";
import type { Firm } from "@/lib/tenancy";
import { dispatchDue } from "@/modules/notifications";

type Job = (firm: Firm) => Promise<Record<string, unknown>>;

const JOBS: Record<string, Job> = {
  dispatch: firm => dispatchDue(firm),
};

async function runOne(key: string, firm: Firm) {
  const [run] = await platformDb.insert(schema.jobRuns).values({ firmId: firm.id, jobKey: key }).returning();
  try {
    const stats = await JOBS[key](firm);
    await platformDb.update(schema.jobRuns).set({ status: "succeeded", finishedAt: new Date(), stats }).where(eq(schema.jobRuns.id, run.id));
    console.log(JSON.stringify({ job: key, firm: firm.slug, status: "succeeded", ...stats }));
  } catch (e: any) {
    await platformDb.update(schema.jobRuns).set({ status: "failed", finishedAt: new Date(), error: String(e?.stack ?? e).slice(0, 2000) }).where(eq(schema.jobRuns.id, run.id));
    console.error(JSON.stringify({ job: key, firm: firm.slug, status: "failed", error: String(e?.message ?? e) }));
    process.exitCode = 1;
  }
}

async function main() {
  const only = process.argv[2];
  const keys = only ? [only] : Object.keys(JOBS);
  for (const k of keys) if (!JOBS[k]) throw new Error(`Unknown job ${k}`);
  const firms = await platformDb.select().from(schema.firms).where(eq(schema.firms.status, "active"));
  for (const firm of firms) for (const k of keys) await runOne(k, firm);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => closeDb());
