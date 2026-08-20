# Probild CRM

Probild's internal business operating system: leads, sales, delivery and money in
one place. The guiding rule is that you enter a piece of information once, and
the system tracks, connects, calculates and reminds you about it from then on.

> **Status:** Phases 1–8 are complete. Every module in the product is built:
> leads, sales, delivery, the dashboard, Google Calendar, the automation engine,
> payments and reports. Phase 9 is production hardening — see
> [docs/ROADMAP.md](docs/ROADMAP.md).
>
> The database, authentication and file storage run on **Supabase**. To deploy,
> see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## What is in the repository

```
probild-crm/
├── apps/
│   ├── api/            Express + TypeScript REST API, Prisma, Supabase Postgres
│   └── web/            React + Vite + TypeScript client
├── packages/
│   └── shared/         Enums, permission matrix and API contract types
└── docs/               Architecture and roadmap
```

`packages/shared` is the single source of truth for every status value and every
permission. The API enforces them; the web client reuses them so a label or a
role check can never drift between the two.

---

## Requirements

| Tool     | Version | Notes                                          |
| -------- | ------- | ---------------------------------------------- |
| Node.js  | 20+     | Developed on 24                                |
| npm      | 10+     | Workspaces are used, so npm, not pnpm/yarn     |
| Supabase | —       | Free tier is enough; supplies Postgres, auth and file storage |
| Redis    | 7+      | Needed from Phase 7 (automation engine)        |

---

## Getting started

```bash
# 1. Install everything
npm install

# 2. Point the app at your Supabase project
#    Connect → ORMs → Prisma          gives DATABASE_URL (use the SESSION
#                                     pooler, port 5432 — see below)
#    Project Settings → API keys      gives the publishable and secret keys
#    Storage → New bucket             create `probild-documents`, private
#                                     and `probild-documents-test`, private

# 3. Configure the environment
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# Then fill in apps/api/.env — the Supabase values above, plus:
#   openssl rand -hex 32   # ENCRYPTION_KEY

# 4. Create the schema and the first admin
npm run db:migrate
npm run db:seed

# 5. Run it
npm run dev:api      # http://localhost:4000
npm run dev:web      # http://localhost:5173
npm run dev:worker   # the automation engine (needs Redis)
```

The worker is a separate process on purpose — a long deadline scan should never
sit in front of somebody's HTTP request. The CRM works without it; reminders
simply stop being raised until it is running again, and the next scan catches up
because every deadline is re-read from the database each pass.

Sign in with the credentials from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
(`admin@probild.local` / `ChangeMe123!` by default). **Change that password
before anyone else uses the system.**

---

## Commands

Run from the repository root.

| Command              | What it does                                            |
| -------------------- | ------------------------------------------------------- |
| `npm run dev:api`    | API with reload on change                               |
| `npm run dev:web`    | Web client with hot reload                              |
| `npm run dev:worker` | Automation engine — scans deadlines, raises reminders    |
| `npm run build`      | Builds shared, API and web for production               |
| `npm run typecheck`  | TypeScript across every workspace                       |
| `npm run lint`       | ESLint across every workspace                           |
| `npm test`           | API test suite (migrates the test database first)       |
| `npm run db:migrate` | Creates and applies a migration from schema changes     |
| `npm run db:seed`    | Seeds the super admin, service catalogue and settings   |
| `npm run db:studio`  | Prisma Studio, to browse the data                       |

---

## Sending documents to clients

Agreements, quotations, invoices and anything else a client needs are stored
against the client and can be emailed straight from Probild, with the files
attached. Quotations and invoices are **generated** as PDFs from the records
already held; agreements and anything signed are uploaded.

**Documents** in the sidebar is the library: pick a client, tick the papers,
send them in one email. The recipient defaults to the client's primary contact.
A selection spanning two clients is refused rather than quietly sent to one of
them, and a batch over 20MB is refused before the send rather than bouncing.
Documents also appear on each client's own Documents tab.

Every send is recorded — to whom, when, by whom, and whether it bounced — and
shows on the client's Documents tab.

Sending is optional. With no SMTP host configured, documents are still stored,
generated and downloadable; the app says so rather than failing at the moment
somebody presses send. To turn it on, add to `apps/api/.env`:

```bash
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=…
SMTP_PASSWORD=…
SMTP_SECURE=false          # true for port 465
MAIL_FROM_ADDRESS=hello@probild.com
MAIL_FROM_NAME=Probild
MAIL_REPLY_TO=hello@probild.com
```

Uploads are held in memory, checked against an allow-list of types (PDF, images,
Office documents, CSV, text, zip) and a size cap (`MAX_UPLOAD_MB`, 20 by
default), then stored under a generated name — a browser-supplied filename is
never used as a key.

Files live in the private `probild-documents` Supabase Storage bucket, so they
are backed up with the project rather than needing a separate copy. The bucket
is private and downloads are served by the API, which means the same permission
checks apply to a file as to the record it hangs off. The test suite writes to
`probild-documents-test` so it can never touch a real document.

## Connecting Google Calendar

The integration is optional — meetings work without it, and the Settings screen
says plainly that it is not set up until these exist.

1. In the [Google Cloud console](https://console.cloud.google.com), create a
   project and enable the **Google Calendar API**.
2. Create an **OAuth 2.0 Client ID** of type *Web application*, with the
   authorised redirect URI `http://localhost:4000/api/calendar/google/callback`.
3. Put the values in `apps/api/.env`:

```bash
GOOGLE_CLIENT_ID=…apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=…
GOOGLE_REDIRECT_URI=http://localhost:4000/api/calendar/google/callback
```

4. Restart the API. Each person then connects their own calendar from
   **Settings → Google Calendar**.

Probild asks only for calendar scopes. Refresh tokens are encrypted with
AES-256-GCM before they are stored and never leave the server.

## Security notes

- Authentication is Supabase Auth. Passwords are stored and verified by
  Supabase; Probild never sees or holds one. Sessions are JWTs signed with
  asymmetric keys (ES256), which the API verifies against the project's JWKS
  endpoint on every request — locally, with no round trip to Supabase.
- The API re-reads the account on every request, so suspending or removing
  someone ends their access on their next call rather than whenever their token
  would have expired.
- **No per-account lockout.** Supabase rate-limits sign-in attempts, but the
  five-failure/15-minute lock Probild used to apply is gone, along with
  refresh-token family revocation. Both were lost deliberately in the move to
  Supabase Auth — see `docs/superpowers/specs/2026-08-20-supabase-migration-design.md` §9.
- The session token is reachable by page scripts, which the previous httpOnly
  refresh cookie was not. That is the trade of letting the browser talk to
  Supabase directly.
- Authorisation is enforced by the API. The web client uses the same permission
  map only to decide what to render.
- Third-party OAuth tokens are encrypted at rest with AES-256-GCM.
- `.env` is never committed. `.env.example` documents every variable.

## Time and money

Timestamps are stored in UTC and rendered in the signed-in user's time zone,
which defaults to `Asia/Kolkata`. Money is stored as `DECIMAL(15,2)` with an
explicit currency on every row — Probild bills in both INR and USD, and nothing
in the system assumes one of them.
