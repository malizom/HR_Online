-- Application role (doc 01 §3, §5): a NOLOGIN group role so RLS always applies and no password exists.
-- Logins are granted membership by scripts/migrate.ts: the app's managed identity in Azure,
-- or the dev-only pp_app_login (local/CI, only when DEV_APP_LOGIN_PASSWORD is set).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pp_app') THEN
    CREATE ROLE pp_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO pp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO pp_app;
--> statement-breakpoint
-- Append-only tables: no UPDATE for the application, ever. No table grants DELETE.
REVOKE UPDATE ON audit_events, access_log, leave_ledger, acknowledgements, workflow_steps, sign_ins FROM pp_app;
--> statement-breakpoint
-- Platform tables: the app may read firms/domains (tenant resolution) and write its own job/sign-in records only.
REVOKE INSERT, UPDATE ON firms, firm_domains, operators, support_sessions FROM pp_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO pp_app;
