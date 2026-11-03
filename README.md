# People Portal

Multi-tenant people portal for professional-services firms: onboarding, leave with organogram-based approvals,
matter coverage, personnel records — built for South African employers (BCEA, POPIA, LPC). First tenant: MVR Attorneys.

Design library (Claude Docs): **00** Product brief & delivery plan · **01** Platform architecture · **02** Data model ·
03–11 in progress. Scope: *Feature Scope & Decision Register* (locked 3 Nov 2026). Agent rules: [`CLAUDE.md`](CLAUDE.md).

## Status — Sprint 0 (foundations)

| Built | Where |
|---|---|
| R1 schema (doc 02): 43 tables, FORCE row-level security on all 37 tenant tables | `db/schema`, `db/migrations` |
| Non-superuser app role; append-only tables without UPDATE; no DELETE anywhere | `db/migrations/0002_app_role.sql` |
| Tenant resolution by host; `withFirm()` data layer; sessions bound to their firm | `lib/tenancy.ts`, `lib/db.ts`, `modules/identity` |
| Per-firm Microsoft 365 (Entra) sign-in; dev sign-in for local/CI | `modules/identity/auth.ts` |
| Workflow engine with optimistic state guard and step history | `modules/workflow` |
| Approvals by organogram → explicit route (directors) → HR admin; delegation | `modules/workflow/routing.ts` |
| Notifications + idempotent dispatch job; Microsoft Graph mail per firm | `modules/notifications`, `lib/mail.ts`, `jobs/` |
| Field encryption (AES-256-GCM, per-firm keys), Key Vault secrets, Blob storage | `lib/crypto.ts`, `lib/secrets.ts`, `lib/storage.ts` |
| v1 features ported: onboarding wizard, document review, leave request/approve, team calendar, staff directory | `components/PeoplePortal.tsx`, `modules/*` |
| Provisioning, SA public holidays (Sunday→Monday), demo firm with organogram | `db/seed` |
| CI (typecheck, tenancy guard, RLS drift, unit, build, e2e, audit, Bicep) and deploy via OIDC | `.github/workflows` |
| Azure template: Container Apps, PostgreSQL (Entra-only auth), Blob, Key Vault, private DNS, App Insights | `infra/` |

Next: Sprint 1 — leave engine (policies, ledger, balances, working days) after design doc 04.

## Run locally

```bash
docker compose up -d db            # or any local Postgres 16
cp .env.example .env               # fill AUTH_SECRET and DATA_ENCRYPTION_KEY
npm install
npm run db:reset                   # migrate + seed demo firm
npm run dev                        # http://demo.localhost:3000 — sign in as hr@demo.test
npm test                           # unit: tenancy isolation, guard, routing, workflow
npm run test:e2e                   # browser smoke against the running dev server
npm run jobs -- dispatch           # send queued notifications
```

Demo organogram: Mpho (MD) ← Lindiwe (Litigation), Johan (Conveyancing), Tamlyn (HR admin); Lindiwe ← Ayanda,
Kagiso (CA), Sarah; Johan ← Pieter; Tamlyn ← Naledi (calendar viewer). Mpho's leave routes to Tamlyn.

## Deploy

See [`docs/runbooks/bootstrap-environment.md`](docs/runbooks/bootstrap-environment.md) for the one-time Azure and
GitHub setup, then: push to `main` → staging; tag `v*` → production (approval required). Customer-hosted
deployments use `infra/params/customer-template.bicepparam` (design doc 01 §10).
