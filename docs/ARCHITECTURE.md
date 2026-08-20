# Architecture

## Shape

```
React (Vite)  →  REST API (Express)  →  Services  →  Prisma  →  Postgres (Supabase)
                        ↑                   ↓
                   Middleware          Redis + BullMQ  →  Automation engine
              (auth, RBAC, validation)                      (Phase 7)
```

Business rules live in `apps/api/src/modules/*/​*.service.ts`. Controllers only
translate HTTP to a service call and back. React components render state; they
never decide what a status transition means.

## Layout

```
apps/api/src/
├── config/env.ts          Zod-validated environment, parsed once at boot
├── lib/                   Cross-cutting primitives
│   ├── prisma.ts          Client + Postgres driver adapter, schema-bound
│   ├── errors.ts          AppError hierarchy
│   ├── http.ts            Response envelope helpers, asyncHandler
│   ├── tokens.ts          JWT signing, refresh token hashing
│   ├── password.ts        bcrypt + password policy
│   ├── crypto.ts          AES-256-GCM for OAuth tokens at rest
│   ├── pagination.ts      Page/sort parsing with a column allowlist
│   └── reference.ts       Sequential business references (LEAD-000042)
├── middleware/            requestContext, auth, rbac, validate, rateLimit, errorHandler
├── modules/<domain>/      schemas · service · controller · routes
└── routes/index.ts        The one place a module is mounted
```

```
apps/web/src/
├── lib/api.ts             Axios client, refresh-on-401, envelope unwrapping
├── features/<domain>/     Query hooks, forms, domain components
├── components/ui/         Button, Field, Panel, Table, Modal, states
├── components/layout/     AppShell, Sidebar, Topbar, navigation map
└── pages/                 One file per route
```

## Request path

1. `requestContext` stamps an id, echoed as `x-request-id` and in error bodies.
2. `helmet`, `cors`, `compression`, body parsers, `cookie-parser`.
3. `apiRateLimiter` — 300 requests/minute per IP; auth routes get 10 per 15 min.
4. `requireAuth` verifies the JWT **and** re-reads the user, so a suspended or
   deleted account loses access immediately rather than at token expiry.
5. `requirePermission` checks the role's permission set from `@probild/shared`.
6. `validate` parses body/query/params with Zod and replaces them with the
   coerced result.
7. The service runs the business rule and writes an audit row where it matters.
8. `errorHandler` maps anything thrown — including Prisma's P2002/P2003/P2025 —
   to a status code and the standard error envelope. Stack traces are logged,
   never returned in production.

## Response envelope

```jsonc
// success
{ "success": true, "data": {}, "meta": { "page": 1, "pageSize": 25, "total": 0 } }

// failure
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…",
  "details": [{ "field": "email", "message": "…" }] }, "requestId": "…" }
```

## Authentication

| Token   | Lifetime | Where it lives            | Storage                  |
| ------- | -------- | ------------------------- | ------------------------ |
| Access  | 15 min   | Memory in the browser tab | Not persisted            |
| Refresh | 30 days  | httpOnly, SameSite=Lax    | SHA-256 digest in `refresh_tokens` |

Refresh rotates on every use. Presenting an already-revoked refresh token means
the cookie leaked, so every live session for that user is revoked at once.

## Authorisation

Roles are a fixed enum — `SUPER_ADMIN`, `SALES`, `PROJECT_MANAGER`, `EMPLOYEE` —
and each maps to a permission list in `packages/shared/src/permissions.ts`.
A `:all` suffix widens an ownership-scoped read: `SALES` holds `lead:read:all`
and sees every lead, while `EMPLOYEE` holds only `lead:read` and sees the ones
assigned to them.

The roadmap's `roles` and `permissions` tables are deliberately deferred. Until
Probild needs roles it can define at runtime, a code-defined matrix is safer:
it is type-checked, reviewable in a diff, and cannot drift from the middleware.
Moving to database-backed roles later means adding two tables and swapping the
lookup inside `permissionsForRole` — no call sites change.

## Data model

24 tables, covering identity, the lead pipeline, clients, deals and quotations,
projects through tasks, meetings and calendar links, payments, and the
cross-cutting concerns: documents, notifications, audit logs, automation
executions and system settings.

Conventions:

- UUID primary keys (`CHAR(36)`), snake_case columns, `created_at` / `updated_at`
  on every table.
- `deleted_at` on entities that carry history. They are filtered out of reads
  rather than removed, so past assignments still resolve.
- Money is `DECIMAL(15,2)` and always sits next to a `Currency` column.
- Indexes on every foreign key plus the columns the app filters and sorts on:
  status, assignee, and the date fields the automation engine scans.
- Foreign keys use `SetNull` where the parent is optional context (an assignee
  leaving), `Cascade` where the child cannot exist alone (quotation items), and
  `Restrict` where deletion would destroy financial history (a client with
  payments).

Two tables exist purely to protect history:

- **`pricing_history`** is append-only. A negotiated price never overwrites the
  previous one; it adds a row with the old value, the new value, who changed it
  and why.
- **`automation_executions`** is the idempotency ledger for Phase 7. Before the
  worker emits a reminder it checks for a row with the same `dedupe_key`, so a
  restart or an overlapping run can never send the same reminder twice.

## Timestamps

Everything is stored in UTC. `users.timezone` decides how it is rendered, and
defaults to `Asia/Kolkata`. Task deadlines are a single `due_at` instant rather
than a separate date and time column, so "due in 2 hours" is a subtraction and
not a timezone puzzle. Google Calendar sync (Phase 6) converts at the boundary.

## Task state

A task's `status` and its lateness are separate facts. `status` stays whatever
the assignee set — `IN_PROGRESS`, `BLOCKED` — while overdue is derived from
`due_at` against now. Nothing writes an `OVERDUE` status, because that would
destroy the information about what the person was actually doing.

## Extending it

A new module is four files under `apps/api/src/modules/<domain>/` — schemas,
service, controller, routes — plus one line in `routes/index.ts`. External
integrations get their own service so the swap is contained: Gmail, WhatsApp,
Slack, Stripe, Razorpay and the accounting tools all attach the same way the
Google Calendar service will.
