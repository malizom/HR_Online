# People Portal — rules for agents working in this repo

This is a multi-tenant HR platform for professional-services firms (first tenant: MVR Attorneys).
Design library: docs 00–11 (Claude Docs). Scope register is locked; do not add features that are not in it.

## Non-negotiable architecture rules

1. **Tenancy.** Every tenant table has `firm_id NOT NULL` and FORCE row-level security. Touch tenant data only
   inside `withFirm(firmId, tx => …)` from `lib/db.ts`. Never create a `Pool` or `drizzle()` anywhere else
   (CI fails). Never take a firm id from the client — it comes from the request host (`lib/tenancy.ts`).
2. **New table?** Add it to `db/schema/*`, run `npm run db:generate`, then generate RLS for it
   (`npm run db:rls -- db/migrations/<next>_rls.sql` and keep only the new tables), and add it to
   `PLATFORM_TABLES` only if it is genuinely platform-level. `tests/unit/tenancy-guard.test.ts` must stay green.
3. **No business logic in `app/`.** Route handlers and server actions call `modules/<domain>` commands.
   Commands take a `Ctx`, validate with Zod, check permission, run in one `withFirm` transaction,
   write `audit()`, enqueue notifications.
4. **State lives in the workflow engine** (`modules/workflow`). Do not add status columns that duplicate a
   workflow state. New flows are new definitions in `definitions.ts` (bump `version` when changing one).
5. **Approvals follow the organogram** (`people.reports_to_id`) via `resolveApprover`. There is no approver role.
   Nobody approves their own request — enforced in `allowedActions`.
6. **Append-only tables** (`audit_events`, `access_log`, `leave_ledger`, `acknowledgements`, `workflow_steps`,
   `sign_ins`) are never updated; corrections are new rows. The app role has no UPDATE grant on them and no
   DELETE anywhere.
7. **Sensitive (class S) data** goes in `person_sensitive`, encrypted with `lib/crypto.ts`; every read writes
   `logAccess()`. Never log personal information; hash identifiers with `hashIdentifier()`.
8. **Leave maths** (S1) lives in pure functions in `modules/leave/engine/` with no I/O, tested against the
   worked examples in design doc 04.
9. **Secrets** only via `lib/secrets.ts` (Key Vault in Azure). Nothing secret in the repo, params or workflows.

## Working

- `npm run db:reset` (local only) → migrate + seed demo firm. Dev server: `npm run dev`, open http://demo.localhost:3000.
- Every ticket closes with tests passing: `npm test` (unit) and `npm run test:e2e` (against the dev server).
- One PR per ticket, `feat/<ticket-id>-slug`. Commit messages say what changed and why.
