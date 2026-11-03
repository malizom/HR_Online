# MVR Attorneys — People & Leave portal (standalone)

The People & Leave portal rebuilt as a conventional web application with **no ChatGPT dependency**:
own sign-in, own database, own file storage, own hosting. Feature-for-feature the same as the
ChatGPT-hosted v1 (onboarding wizard, document review, leave requests and approvals, team calendar,
staff directory, four roles), plus an audit log and server-side validation that v1 never exposed.

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15 (App Router), React 19, TypeScript | Same framework the v1 bundle was built with |
| Database | PostgreSQL via Drizzle ORM | Pure-JS driver, SQL migrations in `drizzle/` |
| Auth | Auth.js v5 — Microsoft Entra ID (M365) | MVR's email is on Microsoft 365; roles come from the portal's own People table, never from M365 |
| Files | Local disk (`UPLOAD_DIR`) | Swap `lib/storage.ts` for S3/Azure Blob when moving to object storage |
| UI | v1 stylesheet and components, lucide-react icons | Visual parity with what MVR has already seen |

## Project layout

```
app/
  page.tsx               server gate → renders the portal if signed in, else /signin
  signin/page.tsx        sign-in page (Microsoft 365; dev sign-in when DEV_LOGIN=true)
  api/hr/route.ts        the whole backend: GET state, POST actions, upload, file download
  api/auth/[...nextauth] Auth.js handlers
  globals.css, calendar.css
components/PeoplePortal.tsx   the v1 UI, ported (client component)
db/schema.ts             tables: people, documents, leave, audit_log
db/seed.mjs              creates the first HR administrator
drizzle/                 generated SQL migrations
lib/auth.ts              sign-in policy + currentPerson()
lib/db.ts, lib/storage.ts
```

## Access model (replaces "grant access in ChatGPT")

A person can sign in **only if an active row with their email exists in `people`**. HR adds staff in
the Staff directory (name, sign-in email, role); the next time that person signs in with Microsoft 365
they get straight in. Roles: `admin` (HR administrator), `approver`, `staff`, `viewer`.
Self-approval of leave is blocked server-side. Sensitive documents are served only to the owner and admins.

## Run locally

```bash
cp .env.example .env            # edit values
docker compose up -d db         # Postgres 16 on localhost:5432
npm install
npm run db:migrate              # applies drizzle/*.sql
npm run db:seed                 # creates ADMIN_EMAIL as the first admin
DEV_LOGIN=true npm run dev      # http://localhost:3000 — dev sign-in with any email in people
```

`DEV_LOGIN` only works under `next dev`; a production build ignores it.

## Deploy (recommended: a South African region for POPIA)

1. Provision Postgres (Azure Database for PostgreSQL, AWS RDS af-south-1, or a managed provider) and a
   host for the app (Azure App Service / Container Apps, Vercel, Render, or a VPS with Docker).
2. **Entra ID app registration** (MVR's M365 tenant):
   - Azure portal → Entra ID → App registrations → New. Single-tenant.
   - Redirect URI (Web): `https://<your-domain>/api/auth/callback/microsoft-entra-id`
   - Certificates & secrets → new client secret.
   - Put Application (client) ID, secret and `https://login.microsoftonline.com/<tenant-id>/v2.0` in `.env`.
3. Set `AUTH_SECRET` (`openssl rand -base64 32`), `AUTH_URL=https://<your-domain>`, `DATABASE_URL`,
   `UPLOAD_DIR` (a persistent volume, outside the web root), `ADMIN_EMAIL`.
4. `npm ci && npm run build && npm run db:migrate && npm run db:seed && npm start`
   (or build the standalone output in `.next/standalone` into a container).
5. Daily database backup; `UPLOAD_DIR` on backed-up storage.

## API contract (`/api/hr`)

Unchanged from v1 so the front-end did not need to change:

- `GET /api/hr` → `{ me, people, documents, leave, calendar, today }` (scoped by role)
- `GET /api/hr?file=<id>` → document download (owner or admin)
- `POST /api/hr` JSON `{action}`: `profile`, `submit`, `leave`, `decision` (Approved | Declined | Cancelled),
  `add` (admin), `onboard` (admin), `document` (admin: Verified | Rejected)
- `POST /api/hr` multipart `{file, category}` — PDF/JPG/PNG ≤ 10 MB; LPC only if admitted
- Errors: `{error}` with 400/401/403/404

Every write is recorded in `audit_log` (actor, action, record, time).

## Verified

`npm run build` passes; an end-to-end browser test covered: sign-in gate → onboarding details →
CV upload → submit for review → admin completes onboarding → add approver and staff →
document verified → leave request → no self-approve → approver approves → calendar shows the
entry → unknown email refused.

## Next

Phase 1 of the build specification (leave balances, approval routing, matter coverage) extends
`db/schema.ts` and `app/api/hr/route.ts` in place; the UI should then be split into one route per
section. See the spec doc *MVR People Portal — Phase 2 Build Specification*.
