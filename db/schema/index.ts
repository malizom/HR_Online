export * from "./platform";
export * from "./org";
export * from "./onboarding";
export * from "./leave";
export * from "./workflow";
export * from "./ops";

/**
 * Tables without RLS. Everything else is a tenant table and MUST have firm_id + an RLS policy;
 * tests/unit/tenancy-guard.test.ts fails the build if a table is missing from both lists.
 */
export const PLATFORM_TABLES = ["firms", "firm_domains", "operators", "support_sessions", "job_runs", "sign_ins"] as const;
/** Tenant tables where firm_id may be NULL for shared platform rows (readable by every firm). */
export const SHARED_ROW_TABLES = ["public_holidays"] as const;
