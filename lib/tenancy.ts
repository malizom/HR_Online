/**
 * Tenant resolution: request host -> firm. The firm id never comes from the client.
 * Design doc 01 §3 "Tenant identity".
 */
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { platformDb, schema } from "./db";

export type Firm = typeof schema.firms.$inferSelect;

const cache = new Map<string, { firm: Firm | null; at: number }>();
const TTL_MS = 60_000;

export function normaliseHost(host: string | null | undefined): string {
  return (host || "").toLowerCase().split(":")[0].trim();
}

export async function firmByHost(hostRaw: string): Promise<Firm | null> {
  const host = normaliseHost(hostRaw);
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.firm;

  let firm: Firm | null = null;
  const [row] = await platformDb
    .select({ firm: schema.firms })
    .from(schema.firmDomains)
    .innerJoin(schema.firms, eq(schema.firms.id, schema.firmDomains.firmId))
    .where(eq(schema.firmDomains.host, host))
    .limit(1);
  if (row) firm = row.firm;

  // Development only: localhost maps to DEV_FIRM_SLUG so the app runs without DNS.
  if (!firm && process.env.NODE_ENV !== "production" && process.env.DEV_FIRM_SLUG && ["localhost", "127.0.0.1"].includes(host)) {
    const [f] = await platformDb.select().from(schema.firms).where(eq(schema.firms.slug, process.env.DEV_FIRM_SLUG)).limit(1);
    firm = f ?? null;
  }

  if (firm && firm.status !== "active") firm = null; // suspended/exported firms resolve to nothing
  cache.set(host, { firm, at: Date.now() });
  return firm;
}

export async function firmBySlug(slug: string): Promise<Firm | null> {
  const [f] = await platformDb.select().from(schema.firms).where(and(eq(schema.firms.slug, slug), eq(schema.firms.status, "active"))).limit(1);
  return f ?? null;
}

/** Resolve the firm for the current server request. */
export async function currentFirm(): Promise<Firm | null> {
  const h = await headers();
  return firmByHost(h.get("x-forwarded-host") || h.get("host") || "");
}

export const clearTenantCache = () => cache.clear();
