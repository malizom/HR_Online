-- Application role: a non-owner, non-superuser login so RLS always applies (doc 01 §3, §5).
-- In Azure the app's managed identity is mapped to this role by infra (pgaadauth); locally it is a password login.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pp_app') THEN
    CREATE ROLE pp_app LOGIN PASSWORD 'pp_app_local_only';
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
