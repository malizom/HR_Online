/**
 * Migrations + role wiring. Used locally, in CI, and by the pp-migrate Container Apps Job in Azure.
 *   Azure:  PG_ENTRA_AUTH=true, MIGRATION_DATABASE_URL without password (token used), APP_DB_PRINCIPAL=<app managed identity name>
 *   Local/CI: DEV_APP_LOGIN_PASSWORD set -> ensures pp_app_login exists for DATABASE_URL.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { pgPassword } from "../lib/pg-auth";

async function main() {
  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, password: pgPassword(process.env.MIGRATION_DATABASE_URL) });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./db/migrations" });
    console.log("migrations applied");

    const principal = process.env.APP_DB_PRINCIPAL;
    if (principal) {
      // Azure Database for PostgreSQL: map the app's managed identity to a login, member of pp_app.
      await pool.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${principal.replace(/'/g, "")}') THEN
          PERFORM pgaadauth_create_principal('${principal.replace(/'/g, "")}', false, false);
        END IF; END $$;`);
      await pool.query(`GRANT pp_app TO "${principal.replace(/"/g, "")}"`);
      console.log(`granted pp_app to ${principal}`);
    }

    const devPw = process.env.DEV_APP_LOGIN_PASSWORD;
    if (devPw) {
      if (process.env.NODE_ENV === "production") throw new Error("DEV_APP_LOGIN_PASSWORD must not be set in production");
      await pool.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pp_app_login') THEN
          CREATE ROLE pp_app_login LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${devPw.replace(/'/g, "")}';
        END IF; END $$;`);
      await pool.query(`GRANT pp_app TO pp_app_login`);
      console.log("dev login pp_app_login ready");
    }
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
