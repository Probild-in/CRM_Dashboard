# Migrating Probild CRM to Supabase

**Date:** 2026-08-20
**Status:** Approved, ready for implementation planning
**Supabase project:** `jqyyaewuvkmrtzztwzrd`

---

## 1. Decision

Probild CRM moves its database, authentication and file storage to Supabase.
The Express API stays.

Three alternatives were considered and rejected:

- **Full Supabase, no API.** Rejected after measurement: the API holds 51
  interactive `$transaction` call sites across 15 service files, and those
  transactions *are* the business invariants — lead-to-client conversion,
  quotation-accept-wins-deal, reference-number allocation under a row lock.
  RLS decides who may touch a row, not what must happen atomically when they
  do. Seven further concerns cannot live in RLS at all: quotation totals,
  reference numbers, audit and pricing-history writes, PDF generation
  (`pdfkit` is Node-only), SMTP sending, Google OAuth token encryption, and
  the BullMQ deadline scanner. Going API-less means rewriting those in plpgsql
  and Deno, not deleting them.
- **Postgres only.** Rejected: leaves documents on local disk, which blocks
  stateless deployment.
- **Phased delivery.** Rejected in favour of a single migration.

Supabase supplies **Postgres, Auth and Storage**. Everything else is unchanged:
`packages/shared` remains the single source of truth for enums and the
permission matrix, the API keeps enforcing authorisation, and BullMQ/Redis
keeps running the automation worker.

## 2. Scope

**In scope**

- MySQL to Supabase Postgres, including schema, migrations and driver adapter.
- Custom JWT auth to Supabase Auth, with the browser talking to Supabase directly.
- Local-disk document storage to a private Supabase Storage bucket.
- Test suite isolation within the shared Supabase project.

**Out of scope**

- Row Level Security policies. The API is the only database client and connects
  with full privileges; RLS would be inert. Revisit only if a client ever talks
  to Postgres directly.
- Supabase Edge Functions. All server logic stays in Express.
- Realtime subscriptions.
- Replacing Redis/BullMQ with `pg_cron`.
- Deployment and hosting (Phase 9 of the roadmap).

**Migrating existing data is not required.** The working database holds seed and
demo data only — 3 users, 9 leads, 2 clients. The Postgres schema is created
fresh and re-seeded.

---

## 3. Why the API survives the auth change nearly untouched

[`middleware/auth.ts`](../../../apps/api/src/middleware/auth.ts) already
re-loads the user from the database on every request and populates `req.user`:

```ts
const payload = verifyAccessToken(token);
const user = await prisma.user.findFirst({
  where: { id: payload.sub, deletedAt: null },
  select: { id: true, email: true, role: true, status: true },
});
```

Only the first line changes. `verifyAccessToken` becomes JWKS verification
against Supabase, and `payload.sub` becomes the `auth.users` id. Because
`User.id` is redefined to *be* that id, the lookup below it is unchanged — and
so are all 20 modules, the RBAC middleware, and every controller downstream.

This is what makes a single-pass migration tractable. Preserve this property:
**no module outside `middleware/auth.ts` and the auth module should need to
know that authentication moved.**

---

## 4. Database

### 4.1 Connection

Use the **session-mode pooler** on port 5432, taken from Dashboard → Connect →
Session pooler. Not the direct `db.<ref>.supabase.co` host, which is IPv6-only
on new projects without the IPv4 add-on. Not the transaction pooler on 6543.

The transaction pooler is the documented default for Prisma because most Prisma
users deploy serverless. Probild's API is a long-running Express process, so it
gains nothing from transaction pooling — and transaction mode is the sharp edge
for interactive transactions, of which there are 51. Session mode keeps them
safe.

Both `url` and `directUrl` point at the session pooler. `directUrl` is declared
so Prisma Migrate has an explicit non-pooled path if the runtime URL later moves
to 6543.

### 4.2 Schema changes

| Change | Count | Notes |
| --- | --- | --- |
| `provider = "mysql"` → `"postgresql"` | 1 | plus `directUrl` |
| `@db.Char(36)` → `@db.Uuid` | 90 | every id and FK; a real Postgres type |
| `@prisma/adapter-mariadb` → `@prisma/adapter-pg` | 1 | `PrismaMariaDb` → `PrismaPg` in `lib/prisma.ts` |

`Decimal(15,2)`, `@db.Date`, `@db.Text` and `@db.VarChar` carry over unchanged.
Money and dates need no attention.

### 4.3 Case sensitivity — the silent regression

The MySQL database is `utf8mb4_unicode_ci`. That collation is case-insensitive,
so **44 `contains:` filters** across leads, clients, tasks, payments, projects
and global search match case-insensitively today without asking. Postgres is
case-sensitive. Moved as-is, every search box in the product silently stops
matching on case — searching `acme` stops finding `Acme Corp`.

**All 44 `contains:` filters gain `mode: 'insensitive'`.** None use it today.

Tests will not necessarily catch this, because fixtures tend to search with the
same case they inserted. The implementation plan must add at least one
deliberate mixed-case search assertion per searchable module.

Email uniqueness is *not* affected: both
[`auth.schemas.ts`](../../../apps/api/src/modules/auth/auth.schemas.ts) and
[`users.schemas.ts`](../../../apps/api/src/modules/users/users.schemas.ts)
already `.toLowerCase()` at the Zod layer, so `citext` is unnecessary.

### 4.4 Migrations

The three existing migrations under `prisma/migrations/` are MySQL DDL and
cannot run on Postgres. Delete them and generate one `init` migration against
Postgres. This is safe only because there is no production data; it would not be
acceptable later.

### 4.5 Hand-written SQL

Two sites use MySQL backtick quoting and must be requoted for Postgres:

- [`lib/reference.ts`](../../../apps/api/src/lib/reference.ts) — `` `key` `` →
  `"key"`. `key` is reserved in Postgres and must stay quoted.
  `SELECT … FOR UPDATE` is unchanged, so reference-number locking survives
  intact.
- [`tests/helpers.ts`](../../../apps/api/tests/helpers.ts) — see §7.

`$queryRaw\`SELECT 1\`` in `server.ts`, `worker.ts` and `health.routes.ts` is
portable and needs no change.

---

## 5. Auth

### 5.1 Flow

The browser signs in with `supabase-js` against Supabase directly, and sends the
resulting JWT to Express as a `Bearer` token. Express verifies it locally
against the project JWKS endpoint:

```
https://jqyyaewuvkmrtzztwzrd.supabase.co/auth/v1/.well-known/jwks.json
```

Asymmetric signing keys, public keys cached in-process. No per-request network
round-trip to Supabase, and key rotation needs no redeploy.

### 5.2 Identity

`User.id` stops being self-generated and becomes the `auth.users` id.
`User.passwordHash` is dropped — credentials live in `auth.users`.

The `User` row remains the source of truth for everything Supabase does not
model: `role`, `status`, `designation`, `timezone`, `firstName`/`lastName`,
soft deletion, and all 20-odd relations. This is the standard profile-table
pattern.

### 5.3 Code removed

- `RefreshToken` model, and its relation on `User`.
- `POST /auth/refresh` and `POST /auth/logout`.
- Most of the 321-line `auth.service.ts`: `issueSession`, `login`,
  `refreshSession`, `logout`.
- Most of `lib/tokens.ts`: `signAccessToken`, `verifyAccessToken`,
  `generateRefreshToken`, `hashRefreshToken`.
- Cookie handling for the refresh token.

### 5.4 Code changed

- `middleware/auth.ts` — one call swapped (§3).
- `users.service.ts` `createUser` — calls `supabase.auth.admin.createUser()`,
  then writes the profile row with the returned id.
- `users.service.ts` password reset — delegates to the Supabase Admin API.
- `auth.service.ts` — `getSessionUser` and `changePassword` survive as thin
  wrappers. `GET /auth/me` is unchanged in contract.
- `prisma/seed.ts` — creates the admin through the Admin API, then upserts the
  profile row.
- `apps/web/src/lib/api.ts` — the in-memory access token and the refresh-on-401
  interceptor are replaced by the supabase-js session. The interceptor now
  attaches the current Supabase token.
- `apps/web/src/pages/SignInPage.tsx` — signs in via supabase-js.

The API contract for every non-auth endpoint is unchanged.

---

## 6. Storage

[`documents/storage.ts`](../../../apps/api/src/modules/documents/storage.ts)
exports seven functions — `store`, `readStream`, `readBuffer`, `exists`,
`remove`, `safeFilename`, `resolveStorageKey` — and `documents.service.ts`
reaches storage only through them. **This is one file rewritten behind an
unchanged interface.**

- A **private** bucket named `probild-documents`, accessed with the secret key.
- `store` / `remove` / `exists` map onto the bucket directly.
- `readBuffer` and `readStream` derive from `download()`, which returns a Blob;
  `readStream` converts it to a Node readable.
- `safeFilename` is pure string handling and is unchanged.
- `resolveStorageKey` stops resolving a filesystem path and becomes bucket-key
  validation.

Downloads continue to flow through the API rather than via public or signed URLs
handed to the browser, so RBAC still governs who can read a document. The MIME
allow-list and `MAX_UPLOAD_MB` cap stay exactly as they are — they are
application policy, not storage policy.

The existing `apps/api/uploads/` tree holds two demo PDFs and is not migrated.

This closes the README's standing caveat that `UPLOAD_DIR` must be backed up
alongside the database, and unblocks deploying the API to a stateless host.

---

## 7. Tests

All 11 test files run against a dedicated Postgres **schema** in the same
Supabase project, via `?schema=probild_test` on `TEST_DATABASE_URL`.

**`?schema=` alone does not isolate anything.** Discovered during implementation,
after it truncated the working schema twice:

| Layer | Honours `?schema=` |
| --- | --- |
| Prisma Migrate | yes — builds tables in the right schema |
| Driver adapter, generated queries | **no** — resolves against `public` |
| Raw SQL (`$queryRaw`, `$executeRawUnsafe`) | **no** — resolves via `search_path` |

Both unbound layers must be closed explicitly in `lib/prisma.ts`, and neither is
sufficient alone:

```ts
new PrismaPg(
  { connectionString, options: `-c search_path=${schema}` },  // raw SQL
  { schema },                                                  // generated queries
)
```

Raw SQL is the dangerous one: `resetDatabase()` issues an unqualified TRUNCATE,
and `reference.ts` issues an unqualified SELECT ... FOR UPDATE.

`auth.users` is project-wide and cannot be schema-isolated. Test users therefore
keep the existing `@probild.test` domain already used by `createTestUser`, which
becomes a reserved marker: global teardown purges every `auth.users` account on
that domain through the Admin API. No real account may use it.

**The guard in `tests/setup.ts` must be strengthened, and comparing URLs is not
enough.** A string comparison passes while isolation is silently broken, which is
exactly what happened: the URLs differed correctly, but the runtime resolved to
`public` anyway.

Two layers are required:

1. *Static* — parse both URLs and compare resolved host, database and schema,
   refusing to run when they match or when the test schema is `public`.
2. *Dynamic* — before any test runs, write a marker through **both** Prisma's
   generated queries and raw SQL, then use an independent connection to assert
   each landed in the test schema and is absent from `public`. Refuse to start if
   either leaks. Only this layer catches an unbound adapter.

`resetDatabase()` gets simpler. Its current comment explains that it uses
`DELETE` in dependency order because MySQL's `TRUNCATE` forces an implicit
commit. Postgres `TRUNCATE` is transactional, so 27 ordered `DELETE`s collapse
to a single `TRUNCATE … RESTART IDENTITY CASCADE`, and the dependency-ordered
table list is no longer needed.

Test helpers that create users must go through the Admin API so that
`auth.users` and the profile table stay consistent.

---

## 8. Configuration

**Added to `apps/api/.env`**

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | `https://jqyyaewuvkmrtzztwzrd.supabase.co` |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` — Admin API and Storage |
| `SUPABASE_STORAGE_BUCKET` | private documents bucket; default `probild-documents` |

**Added to `apps/web/.env`**

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…`, browser-safe by design |

**Changed:** `DATABASE_URL` and `TEST_DATABASE_URL` become Postgres session-pooler
strings; `TEST_DATABASE_URL` carries `?schema=probild_test`.

**Removed:** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`,
`JWT_REFRESH_TTL`, `REFRESH_COOKIE_NAME`, `COOKIE_SECURE`, `UPLOAD_DIR`.

**Kept:** `ENCRYPTION_KEY` — still required, for Google Calendar refresh tokens
at rest. This is unrelated to authentication and must not be removed with the
JWT secrets.

`.env` is gitignored and no `.env` file is tracked. Secrets go straight into
`.env`; `.env.example` documents names only.

---

## 9. Capabilities deliberately given up

Accepted knowingly, recorded so they are not rediscovered as bugs:

- **Account lockout.** Five consecutive failures locking an account for 15
  minutes disappears. Supabase Auth offers rate limiting, not per-account
  lockout. `User.failedLoginCount` and `User.lockedUntil` become dead columns
  and should be dropped in the same migration.
- **Refresh-token family revocation.** Replaying a rotated refresh token
  currently revokes the whole family. Supabase Auth manages its own rotation and
  does not expose this.
- **httpOnly cookie posture.** Tokens move from an httpOnly cookie into
  JavaScript-reachable storage. This is the inherent trade of the
  client-talks-to-Supabase-directly flow, which was chosen deliberately.

The README's "Security notes" section documents all three as current behaviour
and must be rewritten in the same change.

---

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Case-sensitive search silently regresses | All 44 filters get `mode: 'insensitive'`; add mixed-case assertions per searchable module (§4.3) |
| Test suite reaches the working database | Schema isolation plus a guard comparing resolved host+database+schema (§7) |
| Interactive transactions break under pooling | Session-mode pooler, never transaction mode (§4.1) |
| Single-pass migration produces unreadable failures | Land database, auth and storage as separate reviewable commits on one branch, each type-checking, so a bisect is still possible |
| `ENCRYPTION_KEY` removed with the JWT secrets | Called out explicitly in §8; Google Calendar breaks silently otherwise |
| Direct connection host does not resolve | Session pooler is IPv4-friendly (§4.1) |

### Found during implementation, not anticipated here

| Problem | Resolution |
| --- | --- |
| `calendar.service.ts` HMAC-signed the Google OAuth `state` with `JWT_ACCESS_SECRET`, which §5.3 deletes. That signature is the CSRF guard on the OAuth callback. | Re-keyed to `ENCRYPTION_KEY`. §8 flagged that key as load-bearing but missed that the *JWT* secret also did calendar work. |
| `signInWithPassword` mutates the auth state of the client it is called on, even with `persistSession: false`. Calling it on the shared service-role client silently demotes it to that user for the life of the process — the first password change in production would have broken every later Storage and Admin call. | `passwordIsCorrect()` uses a throwaway client with the publishable key. The API therefore needs `SUPABASE_PUBLISHABLE_KEY` too, which §8 did not list. |
| Storage had no test isolation; the suite would have uploaded to, and deleted from, the working bucket. | Tests use `probild-documents-test`, selected by `storageBucket` in `config/env.ts` — the same principle as the `probild_test` schema. |
| `npm start` and `worker:start` pointed at `dist/server.js`, but `tsc` emits `dist/src/server.js`. Pre-existing; dev runs through `tsx`, so production had never booted. | Paths corrected in `apps/api/package.json`. |
| The dashboard batched 22 reads into one `$transaction([...])`, which Prisma runs sequentially — 5.4s against a remote database, past Prisma's 5s ceiling. `GET /api/dashboard` returned 500 on every call. | Converted to `Promise.all`, matching the pattern the same file already used elsewhere. |

---

## 11. Definition of done

1. `npm run typecheck` passes across all three workspaces.
2. `npm run lint` passes.
3. `npm test` — all 11 files — passes against the `probild_test` schema.
4. New assertions prove case-insensitive search in every searchable module.
5. `npm run db:seed` creates the admin in both `auth.users` and `users`, and
   that admin can sign in through the web client.
6. A document can be uploaded, listed, downloaded and deleted, with bytes in the
   Supabase bucket and nothing written to `apps/api/uploads/`.
7. A generated quotation PDF stores and downloads correctly.
8. The automation worker starts and completes a scan against Postgres.
9. Google Calendar connect still works — proving `ENCRYPTION_KEY` survived.
10. README and `docs/ARCHITECTURE.md` updated: MySQL references, the setup
    instructions, and the three security claims in §9.

---

## 12. Follow-ups

- Revisit the transaction pooler if the API is ever deployed serverless.
- Consider RLS if a client ever talks to Postgres directly.
- Consider Supabase Storage signed URLs for large downloads, if streaming
  through the API becomes a bottleneck.
- Drop `failedLoginCount` and `lockedUntil` if lockout is not reinstated.
