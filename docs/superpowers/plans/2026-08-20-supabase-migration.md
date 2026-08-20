# Supabase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Probild CRM's database, authentication and document storage to Supabase project `jqyyaewuvkmrtzztwzrd`, keeping the Express API and all 20 of its modules intact.

**Architecture:** MySQL becomes Supabase Postgres via Prisma's `adapter-pg` on the session-mode pooler. Custom JWT auth becomes Supabase Auth, with the browser signing in through `supabase-js` and Express verifying tokens locally against the project JWKS. Local-disk document storage becomes a private Supabase Storage bucket behind the existing seven-function `storage.ts` interface. The API keeps enforcing authorisation; `packages/shared` stays the single source of truth for enums and permissions.

**Tech Stack:** Node 20+, TypeScript, Express 4, Prisma 7, PostgreSQL (Supabase), `@supabase/supabase-js`, `jose`, React 19 + Vite, Vitest + supertest, BullMQ/Redis (unchanged).

**Spec:** [`docs/superpowers/specs/2026-08-20-supabase-migration-design.md`](../specs/2026-08-20-supabase-migration-design.md)

## Global Constraints

- Supabase project ref: `jqyyaewuvkmrtzztwzrd`; URL `https://jqyyaewuvkmrtzztwzrd.supabase.co`.
- **Database connection must be the session-mode pooler on port 5432.** Never the transaction pooler on 6543 — it breaks the 51 interactive `$transaction` call sites. Never the direct `db.<ref>.supabase.co` host — IPv6-only without the IPv4 add-on.
- `ENCRYPTION_KEY` **must survive** the removal of the JWT secrets. It encrypts Google Calendar refresh tokens and is unrelated to authentication.
- No RLS policies, no Edge Functions, no Realtime, no `pg_cron`. All server logic stays in Express.
- Tests run against schema `probild_test` in the same database. Test accounts use the `@probild.test` email domain, which is reserved — no real account may use it.
- Storage bucket is named `probild-documents` and is **private**.
- `packages/shared` is not modified by this migration. If a task appears to require changing it, stop and ask.
- The API contract for every non-auth endpoint must not change.
- Secrets go only into `apps/api/.env` and `apps/web/.env` (both gitignored). `.env.example` carries names and empty values only — never a real key.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `apps/api/src/lib/supabase.ts` | The service-role Supabase client, one instance, used by auth admin calls and storage |
| `apps/api/src/lib/supabaseToken.ts` | JWKS-backed verification of Supabase access tokens |
| `apps/web/src/lib/supabase.ts` | Browser Supabase client used for sign-in and session |

**Modified**

| File | Change |
| --- | --- |
| `apps/api/prisma/schema.prisma` | Postgres provider, 90 `@db.Uuid`, `User` trimmed, `RefreshToken` dropped |
| `apps/api/src/lib/prisma.ts` | `PrismaMariaDb` → `PrismaPg` |
| `apps/api/src/lib/reference.ts` | Backtick → double-quote in raw SQL |
| `apps/api/src/config/env.ts` | Supabase vars added, JWT vars removed |
| `apps/api/src/middleware/auth.ts` | One call swapped to Supabase verification |
| `apps/api/src/modules/auth/*` | Login/refresh/logout removed; `me` and `changePassword` kept |
| `apps/api/src/modules/users/users.service.ts` | User creation and password reset via Admin API |
| `apps/api/src/modules/documents/storage.ts` | Rewritten against Supabase Storage |
| `apps/api/prisma/seed.ts` | Admin created through the Admin API |
| `apps/api/tests/helpers.ts` | `createTestUser` and `loginAs` go through Supabase |
| `apps/api/tests/setup.ts` | Guard compares resolved host+database+schema |
| `apps/api/tests/auth.test.ts` | Rewritten for the Supabase flow |
| `apps/web/src/lib/api.ts` | Token comes from the Supabase session |
| `apps/web/src/features/auth/AuthContext.tsx` | Sign-in/out and restore via `supabase-js` |
| 15 service files | 44 `contains:` filters gain `mode: 'insensitive'` |

**Deleted**

`apps/api/prisma/migrations/20260818041428_init/`, `20260818061547_calendar_task_events/`, `20260818072058_documents_and_sends/`, `apps/api/src/lib/password.ts`, most of `apps/api/src/lib/tokens.ts`.

---

## Task 1: Dependencies and environment

Additive only. Nothing is removed yet, so the build stays green and this task is independently reviewable.

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/config/env.ts:23-47`
- Modify: `apps/api/.env.example`
- Modify: `apps/web/.env.example`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `env.SUPABASE_URL`, `env.SUPABASE_SECRET_KEY`, `env.SUPABASE_STORAGE_BUCKET` (all `string`), and `env.DIRECT_DATABASE_URL` (`string | undefined`).

- [ ] **Step 1: Install API dependencies**

```bash
npm install -w @probild/api @prisma/adapter-pg pg @supabase/supabase-js jose
npm install -w @probild/api -D @types/pg
```

- [ ] **Step 2: Install web dependency**

```bash
npm install -w @probild/web @supabase/supabase-js
```

- [ ] **Step 3: Add the Supabase variables to the env schema**

In `apps/api/src/config/env.ts`, inside `envSchema`, immediately after the `TEST_DATABASE_URL` line:

```ts
  DIRECT_DATABASE_URL: z.string().optional(),

  SUPABASE_URL: z.string().url('SUPABASE_URL must be the full https project URL'),
  SUPABASE_SECRET_KEY: z.string().min(1, 'SUPABASE_SECRET_KEY is required'),
  SUPABASE_STORAGE_BUCKET: z.string().default('probild-documents'),
```

- [ ] **Step 4: Document the variables in `apps/api/.env.example`**

Replace the `# --- Database ---` block with:

```bash
# --- Database --------------------------------------------------------------
# Supabase → Connect → Session pooler (port 5432). NOT the transaction pooler
# (6543): it breaks Prisma interactive transactions, of which this API has 51.
DATABASE_URL="postgresql://postgres.jqyyaewuvkmrtzztwzrd:[PASSWORD]@[POOLER-HOST]:5432/postgres"
DIRECT_DATABASE_URL="postgresql://postgres.jqyyaewuvkmrtzztwzrd:[PASSWORD]@[POOLER-HOST]:5432/postgres"
# Tests run in their own schema in the same database.
TEST_DATABASE_URL="postgresql://postgres.jqyyaewuvkmrtzztwzrd:[PASSWORD]@[POOLER-HOST]:5432/postgres?schema=probild_test"

# --- Supabase --------------------------------------------------------------
SUPABASE_URL=https://jqyyaewuvkmrtzztwzrd.supabase.co
# Project Settings → API keys → secret key (sb_secret_...). Never commit this.
SUPABASE_SECRET_KEY=
SUPABASE_STORAGE_BUCKET=probild-documents
```

- [ ] **Step 5: Document the web variables in `apps/web/.env.example`**

Append:

```bash
# Supabase — both values are safe in the browser by design.
VITE_SUPABASE_URL=https://jqyyaewuvkmrtzztwzrd.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=
```

- [ ] **Step 6: Fill in the real values locally**

Copy the session-pooler connection string from Supabase → Connect → Session pooler into `DATABASE_URL`, `DIRECT_DATABASE_URL` and `TEST_DATABASE_URL` in `apps/api/.env` (appending `?schema=probild_test` to the test one). Paste the secret key into `SUPABASE_SECRET_KEY`. In `apps/web/.env` set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_S1zWNSe8SR1f7SmTaA9b7Q_1eux_UsP`.

- [ ] **Step 7: Verify the environment parses and the connection works**

```bash
npm run typecheck
cd apps/api && npx tsx -e "import {env} from './src/config/env.js'; console.log('env ok', env.SUPABASE_URL)"
```

Expected: `env ok https://jqyyaewuvkmrtzztwzrd.supabase.co`. A Zod error here means a variable is missing from `.env`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/web/package.json package-lock.json apps/api/src/config/env.ts apps/api/.env.example apps/web/.env.example
git commit -m "chore: add Supabase dependencies and environment variables"
```

---

## Task 2: Postgres schema and first migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (provider block + 90 `@db.Char(36)`)
- Modify: `apps/api/src/lib/prisma.ts`
- Modify: `apps/api/src/lib/reference.ts:28-30`
- Delete: `apps/api/prisma/migrations/20260818041428_init/`, `20260818061547_calendar_task_events/`, `20260818072058_documents_and_sends/`

**Interfaces:**
- Consumes: `env.SUPABASE_URL` etc. from Task 1.
- Produces: a working Postgres database; `prisma` client export is unchanged in shape.

- [ ] **Step 1: Switch the datasource to Postgres**

In `apps/api/prisma/schema.prisma`, replace the `datasource` block:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_DATABASE_URL")
}
```

Update the header comment on line 2 from `// Provider: MySQL 8+ / MariaDB.` to `// Provider: PostgreSQL 15+ (Supabase).`

- [ ] **Step 2: Convert all 90 UUID columns to the native Postgres type**

```bash
cd apps/api
sed -i '' 's/@db\.Char(36)/@db.Uuid/g' prisma/schema.prisma
grep -c '@db.Uuid' prisma/schema.prisma
```

Expected: `90`. Then confirm none remain:

```bash
grep -c '@db.Char(36)' prisma/schema.prisma
```

Expected: `0`.

- [ ] **Step 3: Swap the Prisma driver adapter**

Replace the top of `apps/api/src/lib/prisma.ts`:

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { databaseUrl, isProduction } from '../config/env.js';

/**
 * Prisma 7 talks to Postgres through a driver adapter; the connection string is
 * owned by the adapter, not by schema.prisma.
 *
 * `databaseUrl` is a session-mode pooler URL. Transaction-mode pooling would
 * break the interactive transactions this API relies on for its invariants.
 */
const adapter = new PrismaPg({ connectionString: databaseUrl });
```

The `PrismaClient` construction, `disconnectPrisma` and the type re-export below stay exactly as they are.

- [ ] **Step 4: Requote the raw SQL in `reference.ts`**

`key` is a reserved word in Postgres, so the quoting must stay — only the quote character changes. Replace lines 28-30 of `apps/api/src/lib/reference.ts`:

```ts
  const rows = await tx.$queryRaw<Array<{ value: unknown }>>`
    SELECT value FROM system_settings WHERE "key" = ${key} FOR UPDATE
  `;
```

`SELECT … FOR UPDATE` is identical in Postgres, so reference-number locking is preserved.

- [ ] **Step 5: Delete the MySQL migrations**

They are MySQL DDL and cannot run on Postgres. This is safe only because there is no production data.

```bash
cd apps/api
rm -rf prisma/migrations/20260818041428_init \
       prisma/migrations/20260818061547_calendar_task_events \
       prisma/migrations/20260818072058_documents_and_sends
```

**Delete `migration_lock.toml` too** — it is NOT rewritten automatically, and leaving it makes the next command fail with `P3019: provider postgresql does not match migration_lock.toml, mysql`. Simplest is `rm -rf prisma/migrations` entirely.

- [ ] **Step 6: Generate the Postgres migration**

```bash
cd apps/api
npx prisma migrate dev --name init
```

Expected: a new `prisma/migrations/<timestamp>_init/migration.sql` containing `CREATE TABLE` statements with `uuid` columns, and `migration_lock.toml` now reading `provider = "postgresql"`.

Then regenerate the client explicitly — `migrate dev` does **not** do it here, and the seed will otherwise fail with "Driver Adapter `@prisma/adapter-pg` is not compatible with the provider `mysql`":

```bash
npx prisma generate
```

- [ ] **Step 7: Seed and verify the database answers**

```bash
cd apps/api
npm run db:seed
npx tsx -e "import {prisma} from './src/lib/prisma.js'; const n = await prisma.user.count(); console.log('users:', n); await prisma.\$disconnect()"
```

Expected: `users: 1`. Seeding still uses bcrypt at this point — Supabase Auth arrives in Task 5.

- [ ] **Step 8: Verify a reference number allocates under the new quoting**

```bash
cd apps/api
npx tsx -e "
import {prisma} from './src/lib/prisma.js';
import {nextReference} from './src/lib/reference.js';
const r = await prisma.\$transaction((tx) => nextReference(tx, 'LEAD'));
console.log('reference:', r);
await prisma.\$disconnect();
"
```

Expected: `reference: LEAD-000001`. A syntax error here means the quoting in Step 4 is wrong.

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma apps/api/src/lib/prisma.ts apps/api/src/lib/reference.ts
git commit -m "feat: migrate database from MySQL to Supabase Postgres"
```

---

## Task 3: Test harness on Postgres

Gets the whole suite green on Postgres before auth moves, so later failures have one cause.

> **CRITICAL — do this step first.** `?schema=` on the connection string isolates
> *nothing* at runtime. Prisma Migrate honours it; the driver adapter does not,
> and raw SQL resolves through `search_path`. Skipping this truncates the working
> schema on the first `npm test` — observed twice during implementation.
>
> In `apps/api/src/lib/prisma.ts`:
>
> ```ts
> export const databaseSchema = new URL(databaseUrl).searchParams.get('schema') ?? 'public';
>
> const adapter = new PrismaPg(
>   { connectionString: databaseUrl, options: `-c search_path=${databaseSchema}` },
>   { schema: databaseSchema },
> );
> ```
>
> `options` binds raw SQL (`resetDatabase`'s TRUNCATE, `reference.ts`'s SELECT
> ... FOR UPDATE). `{ schema }` binds generated queries. Both are required.
>
> The guard in `tests/setup.ts` must then *prove* isolation at runtime rather than
> infer it from URL strings: write a marker through both the generated-query path
> and the raw-SQL path, and assert with an independent connection that each landed
> in the test schema and is absent from `public`. A URL comparison alone passed
> while the suite was actively destroying data.
>
> Note also: never truncate `_prisma_migrations` when clearing the test schema —
> Prisma then re-applies migrations whose enum types already exist and fails with
> `42710 type "UserRole" already exists`. Drop and recreate the schema instead.

**Files:**
- Modify: `apps/api/tests/setup.ts`
- Modify: `apps/api/tests/helpers.ts:8-51`
- Modify: `apps/api/vitest.config.ts:18-19` (comment only)

**Interfaces:**
- Consumes: Postgres database from Task 2.
- Produces: `resetDatabase(): Promise<void>` — unchanged signature, new implementation.

- [ ] **Step 1: Strengthen the guard in `tests/setup.ts`**

The current check compares raw strings. Supabase offers a direct host, a session pooler and a transaction pooler for the *same* database, so two different strings can address one database — and the suite truncates every table. Replace the whole file:

```ts
import 'dotenv/config';

/**
 * Guard rail: the helpers truncate every table, so the test URL must never
 * resolve to the same place as the working database.
 *
 * Comparing raw strings is not enough — Supabase exposes one database through
 * several hosts and ports. Compare what the URLs actually resolve to.
 */
function target(raw: string): string {
  const url = new URL(raw);
  const schema = url.searchParams.get('schema') ?? 'public';
  return `${url.hostname}${url.pathname}#${schema}`;
}

const testUrl = process.env.TEST_DATABASE_URL;
const devUrl = process.env.DATABASE_URL;

if (!testUrl) {
  throw new Error('TEST_DATABASE_URL must be set to run the API test suite.');
}
if (!devUrl) {
  throw new Error('DATABASE_URL must be set.');
}
if (target(testUrl) === target(devUrl)) {
  throw new Error(
    'TEST_DATABASE_URL resolves to the same database and schema as DATABASE_URL. ' +
      'Give the test URL its own schema, e.g. ?schema=probild_test.',
  );
}
if ((new URL(testUrl).searchParams.get('schema') ?? 'public') === 'public') {
  throw new Error('TEST_DATABASE_URL must name a dedicated schema, not public.');
}
```

- [ ] **Step 2: Verify the guard rejects a same-database URL**

```bash
cd apps/api
NODE_ENV=test TEST_DATABASE_URL="$DATABASE_URL" npx vitest run tests/auth.test.ts 2>&1 | head -5
```

Expected: FAIL with "resolves to the same database and schema". This proves the guard works before you rely on it.

- [ ] **Step 3: Replace `resetDatabase` with a single TRUNCATE**

Postgres `TRUNCATE` is transactional, unlike MySQL's — which is the only reason the current code lists 27 tables in dependency order. In `apps/api/tests/helpers.ts`, delete the `TABLES_IN_DELETE_ORDER` array entirely and replace `resetDatabase`:

```ts
/**
 * Clears the test schema between cases.
 *
 * Postgres TRUNCATE is transactional and CASCADE handles the foreign keys, so
 * one statement replaces the dependency-ordered deletes MySQL required.
 */
const TABLES = [
  'audit_logs', 'notifications', 'automation_executions', 'documents',
  'document_sends', 'payments', 'calendar_events', 'calendar_connections',
  'meeting_attendees', 'meetings', 'task_comments', 'tasks', 'milestones',
  'project_services', 'project_members', 'projects', 'pricing_history',
  'quotation_items', 'quotations', 'deals', 'lead_activities', 'leads',
  'contacts', 'clients', 'services', 'system_settings', 'users',
];

export async function resetDatabase(): Promise<void> {
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
```

Note `refresh_tokens` is omitted — it is dropped in Task 4, and `CASCADE` clears it meanwhile.

- [ ] **Step 4: Update the stale comment in `vitest.config.ts`**

Change `// The suite shares one MySQL schema and truncates between cases, so files` to `// The suite shares one Postgres schema and truncates between cases, so files`.

- [ ] **Step 5: Run the full suite**

```bash
npm test
```

Expected: all 11 test files PASS against `probild_test`. Any failure here is a Postgres-vs-MySQL behaviour difference and must be fixed now, before auth moves. Search assertions may pass by luck; Task 4 addresses case sensitivity deliberately.

- [ ] **Step 6: Confirm the working data survived**

```bash
cd apps/api
npx tsx -e "import {prisma} from './src/lib/prisma.js'; console.log('dev users:', await prisma.user.count()); await prisma.\$disconnect()"
```

Expected: `dev users: 1` — the seeded admin, untouched by the test run. If this is `0`, the schema isolation is not working; stop and fix before continuing.

- [ ] **Step 7: Commit**

```bash
git add apps/api/tests/setup.ts apps/api/tests/helpers.ts apps/api/vitest.config.ts
git commit -m "test: isolate suite in a Postgres schema and simplify reset"
```

---

## Task 4: Case-insensitive search

MySQL's `utf8mb4_unicode_ci` made all 44 `contains:` filters case-insensitive for free. Postgres is case-sensitive, so without this every search box silently stops matching on case.

**Files:**
- Modify: 15 service files under `apps/api/src/modules/` (44 filters)
- Modify: `apps/api/tests/leads.test.ts`, `clients.test.ts`, `projects.test.ts`, `tasks` coverage in `projects.test.ts`, `payments.test.ts`

**Interfaces:**
- Consumes: green suite from Task 3.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/tests/clients.test.ts`, inside the existing top-level `describe`:

```ts
  it('matches a search term regardless of case', async () => {
    const admin = await createTestUser(UserRole.SUPER_ADMIN);
    const session = await loginAs(app, admin.email);

    await request(app)
      .post('/api/clients')
      .set(authHeader(session.accessToken))
      .send({ companyName: 'Acme Industries', email: 'hello@acme.test' })
      .expect(201);

    const response = await request(app)
      .get('/api/clients?search=acme')
      .set(authHeader(session.accessToken))
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].companyName).toBe('Acme Industries');
  });
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd apps/api && npx vitest run tests/clients.test.ts -t 'regardless of case'
```

Expected: FAIL — `expected length 1, received 0`. This is the regression, reproduced.

- [ ] **Step 3: Add `mode: 'insensitive'` to every `contains:` filter**

```bash
cd apps/api
perl -0pi -e "s/contains:\s*([A-Za-z0-9_.\?\[\]']+?)\s*\}/contains: \$1, mode: 'insensitive' }/g" \
  $(grep -rl 'contains:' src/modules)
grep -rc "mode: 'insensitive'" src/modules | grep -v ':0'
```

Then confirm the totals:

```bash
grep -rn "contains:" src | grep -v generated | wc -l          # expect 44
grep -rn "mode: 'insensitive'" src | grep -v generated | wc -l # expect 44
```

This command was dry-run against copies of all 15 service files and converted 44/44 with none missed, including nested relation filters such as `{ project: { name: { contains: q } } }`. If the two numbers nonetheless differ, find the stragglers with `grep -rn "contains:" src | grep -v generated | grep -v insensitive` and fix them by hand.

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd apps/api && npx vitest run tests/clients.test.ts -t 'regardless of case'
```

Expected: PASS.

- [ ] **Step 5: Add the same assertion to the other searchable modules**

Add one mixed-case search test each to `tests/leads.test.ts`, `tests/projects.test.ts` and `tests/payments.test.ts`, following the shape in Step 1 but using each module's own create payload and search field — leads search `companyName`, projects search `name`, payments search `title`. Search with a lowercase term against a capitalised stored value.

- [ ] **Step 6: Run the full suite**

```bash
npm test
```

Expected: all 11 files PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules apps/api/tests
git commit -m "fix: preserve case-insensitive search after the move to Postgres"
```

---

## Task 5: Supabase Auth on the server

**Files:**
- Create: `apps/api/src/lib/supabase.ts`, `apps/api/src/lib/supabaseToken.ts`
- Modify: `apps/api/src/middleware/auth.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/modules/auth/*`, `apps/api/src/modules/users/users.service.ts`, `apps/api/prisma/seed.ts`, `apps/api/src/config/env.ts`, `apps/api/src/lib/tokens.ts`
- Delete: `apps/api/src/lib/password.ts`

**Interfaces:**
- Consumes: `env.SUPABASE_URL`, `env.SUPABASE_SECRET_KEY` (Task 1).
- Produces:
  - `supabaseAdmin: SupabaseClient` from `lib/supabase.ts`
  - `verifySupabaseToken(token: string): Promise<{ sub: string; sessionId: string }>` from `lib/supabaseToken.ts`
  - `ensureAuthUser(email: string, password: string): Promise<string>` from `lib/supabase.ts` — returns the `auth.users` id, creating the account or returning the existing one's id.

- [ ] **Step 1: Create the service-role client**

`apps/api/src/lib/supabase.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

/**
 * The service-role client. It bypasses every policy, so it must never be
 * handed to a browser and never be constructed from request input.
 */
export const supabaseAdmin: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** Creates the auth account, or returns the id of the one already there. */
export async function ensureAuthUser(email: string, password: string): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (!error && data.user) {
    return data.user.id;
  }

  // Already registered — find it rather than failing an idempotent seed.
  const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) {
    throw new Error(`Could not reach Supabase Auth: ${listError.message}`);
  }
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!existing) {
    throw new Error(`Could not create or find the auth account for ${email}: ${error?.message}`);
  }
  return existing.id;
}
```

- [ ] **Step 2: Create the token verifier**

`apps/api/src/lib/supabaseToken.ts`:

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { UnauthorizedError } from './errors.js';

/**
 * Supabase signs access tokens with asymmetric keys and publishes the public
 * half at a JWKS endpoint. Verifying locally means no network round-trip per
 * request, and key rotation needs no redeploy — `jose` refetches on new kids.
 */
const jwks = createRemoteJWKSet(
  new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

export async function verifySupabaseToken(
  token: string,
): Promise<{ sub: string; sessionId: string }> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${env.SUPABASE_URL}/auth/v1`,
      audience: 'authenticated',
    });

    if (!payload.sub) {
      throw new Error('Token carries no subject.');
    }

    return {
      sub: payload.sub,
      sessionId: typeof payload.session_id === 'string' ? payload.session_id : payload.sub,
    };
  } catch {
    throw new UnauthorizedError('Your session has expired. Please sign in again.');
  }
}
```

- [ ] **Step 3: Swap the one call in the auth middleware**

In `apps/api/src/middleware/auth.ts`, replace the `verifyAccessToken` import with `import { verifySupabaseToken } from '../lib/supabaseToken.js';` and change the single line:

```ts
    const payload = await verifySupabaseToken(token);
```

Then update the two references below it: `payload.sub` stays as-is, and `sessionId: payload.sid` becomes `sessionId: payload.sessionId`. **Nothing else in this file changes** — the database lookup, the soft-delete filter and the status check all still apply, which is why no other module needs touching.

- [ ] **Step 4: Trim the User model and drop RefreshToken**

In `apps/api/prisma/schema.prisma`, in `model User` remove these four lines:

```prisma
  passwordHash String     @map("password_hash") @db.VarChar(255)
  failedLoginCount   Int       @default(0) @map("failed_login_count")
  lockedUntil        DateTime? @map("locked_until")
  refreshTokens       RefreshToken[]
```

Change the id line so it is no longer self-generated — it now mirrors `auth.users.id`:

```prisma
  id           String     @id @db.Uuid
```

Delete the entire `model RefreshToken { … }` block.

- [ ] **Step 5: Migrate**

```bash
cd apps/api && npx prisma migrate dev --name supabase_auth
```

Expected: a migration dropping `refresh_tokens` and three `users` columns.

- [ ] **Step 6: Rewrite user creation to go through Supabase**

In `apps/api/src/modules/users/users.service.ts`, replace the body of `createUser` between the conflict check and the audit call:

```ts
  const { password, ...rest } = nullifyBlanks(input);
  const authId = await ensureAuthUser(rest.email, password);

  const user = await prisma.user.create({
    data: { ...rest, id: authId },
    select: authUserSelect,
  });
```

Add `import { ensureAuthUser, supabaseAdmin } from '../../lib/supabase.js';` and remove the `hashPassword` import. For the password reset around line 228, replace the `passwordHash` write with:

```ts
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
    password: newPassword,
  });
  if (error) {
    throw new UnprocessableError('Could not update the password.');
  }
```

- [ ] **Step 7: Rewrite the seed's admin creation**

In `apps/api/prisma/seed.ts`, replace the `prisma.user.upsert` call:

```ts
  const authId = await ensureAuthUser(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);

  const admin = await prisma.user.upsert({
    where: { email: env.SEED_ADMIN_EMAIL },
    update: { id: authId },
    create: {
      id: authId,
      email: env.SEED_ADMIN_EMAIL,
      firstName: env.SEED_ADMIN_FIRST_NAME,
      lastName: env.SEED_ADMIN_LAST_NAME,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      timezone: env.DEFAULT_TIMEZONE,
      designation: 'Administrator',
    },
    select: { id: true, email: true },
  });
```

Swap the `hashPassword` import for `import { ensureAuthUser } from '../src/lib/supabase.js';`.

- [ ] **Step 8: Remove the dead auth surface**

- In `apps/api/src/modules/auth/auth.routes.ts`: delete the `/refresh` and `/logout` routes. Keep `/me` and `/change-password`.
- In `auth.service.ts`: delete `issueSession`, `login`, `refreshSession`, `logout`, and the `IssuedSession`/`SessionContext` interfaces. Keep `authUserSelect`, `toAuthUser`, `getSessionUser`. Rewrite `changePassword` to call `supabaseAdmin.auth.admin.updateUserById`.
- In `auth.controller.ts`: delete the `login`, `refresh` and `logout` handlers and any cookie writes.
- In `lib/tokens.ts`: delete `signAccessToken`, `verifyAccessToken`, `generateRefreshToken`, `hashRefreshToken`, `AccessTokenPayload`, `accessTokenTtlSeconds` and `refreshTokenTtlSeconds`. Keep `durationToSeconds` only if something still imports it; otherwise delete the file.
- Delete `apps/api/src/lib/password.ts` and uninstall bcrypt: `npm uninstall -w @probild/api bcryptjs @types/bcryptjs`.

- [ ] **Step 9: Remove the JWT variables from the env schema**

In `apps/api/src/config/env.ts` delete the `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `REFRESH_COOKIE_NAME` and `COOKIE_SECURE` entries, and the same six from `.env.example`.

**Leave `ENCRYPTION_KEY` in place.** It encrypts Google Calendar refresh tokens, not sessions. Removing it breaks the calendar integration silently.

- [ ] **Step 10: Verify it type-checks and boots**

```bash
npm run typecheck
cd apps/api && npm run db:seed
```

Expected: typecheck clean; seed prints `✔ Super admin ready: admin@probild.local`. Confirm the admin now exists in both places — Supabase Dashboard → Authentication → Users should list it, and its id must equal the `users.id` row.

- [ ] **Step 11: Commit**

```bash
git add -A apps/api
git commit -m "feat: replace custom JWT auth with Supabase Auth on the server"
```

---

## Task 6: Point the test suite at Supabase Auth

`loginAs` currently posts to `/api/auth/login`, which no longer exists. It is the single seam all 11 test files depend on.

**Files:**
- Modify: `apps/api/tests/helpers.ts:60-130`
- Modify: `apps/api/tests/setup.ts` (teardown)
- Rewrite: `apps/api/tests/auth.test.ts`

**Interfaces:**
- Consumes: `ensureAuthUser`, `supabaseAdmin` (Task 5).
- Produces: `createTestUser(role, overrides?)` and `loginAs(app, email, password?)` keep their existing call signatures. `LoginResult` loses `refreshCookie`; `accessToken` and `permissions` remain.

- [ ] **Step 1: Route test user creation through Supabase**

In `apps/api/tests/helpers.ts`, replace `createTestUser`:

```ts
export async function createTestUser(
  role: UserRole,
  overrides: Partial<{ email: string; status: UserStatus; password: string }> = {},
): Promise<TestUser> {
  // The @probild.test domain is reserved and purged in teardown.
  const email =
    overrides.email ??
    `${role.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@probild.test`;

  const authId = await ensureAuthUser(email, overrides.password ?? TEST_PASSWORD);

  return prisma.user.create({
    data: {
      id: authId,
      email,
      firstName: 'Test',
      lastName: role,
      role,
      status: overrides.status ?? UserStatus.ACTIVE,
    },
    select: { id: true, email: true, role: true },
  });
}
```

Add `import { ensureAuthUser, supabaseAdmin } from '../src/lib/supabase.js';` and drop the `hashPassword` import.

- [ ] **Step 2: Sign in through Supabase rather than the deleted endpoint**

Replace `LoginResult` and `loginAs`:

```ts
export interface LoginResult {
  accessToken: string;
  permissions: Permission[];
}

/** Signs in against Supabase Auth, exactly as the browser does. */
export async function loginAs(
  app: Express,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<LoginResult> {
  const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`Login failed for ${email}: ${error?.message ?? 'no session'}`);
  }

  const { default: request } = await import('supertest');
  const me = await request(app)
    .get('/api/auth/me')
    .set(authHeader(data.session.access_token));

  if (me.status !== 200) {
    throw new Error(`/auth/me failed for ${email}: ${me.status} ${me.text}`);
  }

  return { accessToken: data.session.access_token, permissions: me.body.data.permissions };
}
```

The `app` parameter is kept so no caller changes.

- [ ] **Step 3: Purge test accounts in teardown**

Append to `apps/api/tests/setup.ts`:

```ts
import { afterAll } from 'vitest';
import { supabaseAdmin } from '../src/lib/supabase.js';

/**
 * auth.users is project-wide and cannot be schema-isolated, so test accounts
 * are identified by their reserved domain and removed after the run.
 */
afterAll(async () => {
  const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const stale = (data?.users ?? []).filter((u) => u.email?.endsWith('@probild.test'));
  for (const user of stale) {
    await supabaseAdmin.auth.admin.deleteUser(user.id);
  }
});
```

- [ ] **Step 4: Rewrite `auth.test.ts`**

Delete the `POST /api/auth/login`, `POST /api/auth/refresh` and `POST /api/auth/logout` describe blocks, and the account-lockout test — all four cover behaviour that no longer exists (spec §9). Keep and keep passing:

- `GET /api/auth/me` — returns the caller and their permissions
- `GET /api/auth/me` — rejects a missing or malformed token
- `GET /api/auth/me` — rejects a token belonging to a deactivated account
- `POST /api/auth/change-password` — all three cases

Add one test proving a forged token is refused:

```ts
  it('rejects a token that was not signed by Supabase', async () => {
    const forged = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: randomUUID(), aud: 'authenticated' })).toString('base64url'),
      'not-a-real-signature',
    ].join('.');

    await request(app).get('/api/auth/me').set(authHeader(forged)).expect(401);
  });
```

- [ ] **Step 5: Run the suite**

```bash
npm test
```

Expected: all 11 files PASS. Expect this to be the slowest task — every `createTestUser` now makes a network call to Supabase, so `testTimeout` in `vitest.config.ts` may need raising from 20s.

- [ ] **Step 6: Confirm no test accounts leaked**

Supabase Dashboard → Authentication → Users. Expected: only `admin@probild.local`. Any `@probild.test` address means teardown did not run; fix before continuing.

- [ ] **Step 7: Commit**

```bash
git add apps/api/tests apps/api/vitest.config.ts
git commit -m "test: sign in through Supabase Auth"
```

---

## Task 7: Supabase Auth in the browser

**Files:**
- Create: `apps/web/src/lib/supabase.ts`
- Modify: `apps/web/src/lib/api.ts:9-73`
- Modify: `apps/web/src/features/auth/AuthContext.tsx`

**Interfaces:**
- Consumes: `/api/auth/me` (unchanged contract).
- Produces: `supabase` browser client. `useAuth()` keeps its exact shape — `user`, `permissions`, `ready`, `signIn`, `signOut`, `refreshUser`, `can` — so `RequireAuth`, `RequirePermission` and `SignInPage` need no changes.

- [ ] **Step 1: Create the browser client**

`apps/web/src/lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set in apps/web/.env',
  );
}

/** The publishable key is designed to be public; it grants nothing on its own. */
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
```

- [ ] **Step 2: Take the token from the Supabase session**

In `apps/web/src/lib/api.ts`, delete `accessToken`, `setAccessToken`, `getAccessToken`, `refreshPromise` and `refreshAccessToken`. Replace the request interceptor:

```ts
api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    config.headers.set('Authorization', `Bearer ${data.session.access_token}`);
  }
  return config;
});
```

`supabase-js` refreshes the token itself, so the response interceptor no longer retries — it only reports a lost session:

```ts
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiError>) => {
    if (error.response?.status === 401) {
      onSessionLost?.();
    }
    return Promise.reject(error);
  },
);
```

Keep `setSessionLostHandler`, `apiGet`, `apiGetPaginated`, `apiPost`, `apiPatch`, `apiDelete`, `ApiRequestError`, `toMessage` and `toFieldErrors` exactly as they are. Add `import { supabase } from './supabase';`.

- [ ] **Step 3: Rewire `AuthContext`**

Replace `applySession`, `clearSession`, the restore effect, `signIn` and `signOut`:

```ts
  const loadUser = useCallback(async () => {
    const data = await apiGet<{ user: AuthUser; permissions: Permission[] }>('/auth/me');
    setUser(data.user);
    setPermissions(data.permissions);
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setPermissions([]);
    queryClient.clear();
  }, [queryClient]);

  /*
   * supabase-js restores the session from storage and refreshes it on its own,
   * so the profile is loaded whenever a session appears and dropped when it goes.
   */
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        loadUser()
          .catch(clearSession)
          .finally(() => setReady(true));
      } else {
        clearSession();
        setReady(true);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [loadUser, clearSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw new Error('Incorrect email or password.');
    }
    await loadUser();
  }, [loadUser]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    clearSession();
  }, [clearSession]);
```

Keep `refreshUser` as an alias of `loadUser`. Update the imports: drop `setAccessToken`, add `import { supabase } from '@/lib/supabase';`.

- [ ] **Step 4: Verify the whole flow by hand**

```bash
npm run dev:api    # terminal 1
npm run dev:web    # terminal 2
```

At `http://localhost:5173`, sign in as `admin@probild.local` / `ChangeMe123!`. Confirm: the dashboard loads; a page reload keeps you signed in; sign-out returns you to the sign-in screen; a wrong password shows "Incorrect email or password."

- [ ] **Step 5: Type-check and lint**

```bash
npm run typecheck && npm run lint
```

Expected: both clean. A "cannot find name setAccessToken" error means a caller was missed — search with `grep -rn setAccessToken apps/web/src`.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat: sign in through Supabase Auth in the browser"
```

---

## Task 8: Supabase Storage

**Files:**
- Modify: `apps/api/src/modules/documents/storage.ts` (whole file)
- Modify: `apps/api/src/modules/documents/documents.service.ts:131`

**Interfaces:**
- Consumes: `supabaseAdmin` (Task 5), `env.SUPABASE_STORAGE_BUCKET` (Task 1).
- Produces: `store`, `readBuffer`, `exists`, `remove`, `safeFilename`, `resolveStorageKey` keep their signatures. **`readStream` becomes `async`** — a deviation from spec §6, because Supabase returns a Blob rather than a file handle. It is the only call-site change.

- [ ] **Step 1: Create the bucket**

Supabase Dashboard → Storage → New bucket. Name `probild-documents`, **Public: off**. Private matters: downloads must keep flowing through the API so RBAC governs them.

- [ ] **Step 2: Rewrite the storage internals**

In `apps/api/src/modules/documents/storage.ts`, keep `ALLOWED_MIME_TYPES`, `ALLOWED_MIME_LIST`, `maxUploadBytes`, `assertAllowedType` and `safeFilename` **exactly as they are** — they are application policy, not storage mechanics. Replace the filesystem imports with:

```ts
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

const bucket = () => supabaseAdmin.storage.from(env.SUPABASE_STORAGE_BUCKET);
```

Then replace the six filesystem functions:

```ts
/**
 * Validates a stored key. There is no filesystem to escape any more, but a key
 * containing `..` or a leading slash is still malformed and is refused.
 */
export function resolveStorageKey(storageKey: string): string {
  if (!/^[\w.\-/]+$/.test(storageKey) || storageKey.includes('..') || storageKey.startsWith('/')) {
    throw new UnprocessableError('That file path is not valid.');
  }
  return storageKey;
}

export interface StoredFile {
  storageKey: string;
  sizeBytes: number;
}

/** Uploads a buffer under a generated key, foldered by year and month. */
export async function store(buffer: Buffer, mimeType: string): Promise<StoredFile> {
  assertAllowedType(mimeType);

  if (buffer.byteLength > maxUploadBytes()) {
    throw new UnprocessableError(`Files must be ${env.MAX_UPLOAD_MB}MB or smaller.`);
  }

  const now = new Date();
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const storageKey = `${folder}/${randomUUID()}.${ALLOWED_MIME_TYPES[mimeType]}`;

  const { error } = await bucket().upload(storageKey, buffer, {
    contentType: mimeType,
    upsert: false,
  });

  if (error) {
    logger.error({ err: error, storageKey }, 'Could not upload the file');
    throw new UnprocessableError('That file could not be stored. Please try again.');
  }

  return { storageKey, sizeBytes: buffer.byteLength };
}

export async function readBuffer(storageKey: string): Promise<Buffer> {
  const { data, error } = await bucket().download(resolveStorageKey(storageKey));
  if (error || !data) {
    throw new NotFoundError('Document file');
  }
  return Buffer.from(await data.arrayBuffer());
}

/** Async, unlike the filesystem version: Supabase hands back a Blob, not a handle. */
export async function readStream(storageKey: string): Promise<NodeJS.ReadableStream> {
  return Readable.from(await readBuffer(storageKey));
}

export async function exists(storageKey: string): Promise<boolean> {
  const key = resolveStorageKey(storageKey);
  const slash = key.lastIndexOf('/');
  const folder = slash === -1 ? '' : key.slice(0, slash);
  const name = slash === -1 ? key : key.slice(slash + 1);

  const { data, error } = await bucket().list(folder, { search: name, limit: 100 });
  if (error) return false;
  return (data ?? []).some((object) => object.name === name);
}

/** Removing the row matters more than removing the bytes, so failures only log. */
export async function remove(storageKey: string): Promise<void> {
  const { error } = await bucket().remove([resolveStorageKey(storageKey)]);
  if (error) {
    logger.warn({ err: error, storageKey }, 'Could not delete the stored file');
  }
}
```

- [ ] **Step 3: Await the one changed call site**

In `apps/api/src/modules/documents/documents.service.ts` line 131:

```ts
    stream: await storage.readStream(storageKey),
```

Confirm the enclosing function is already `async` — it is, since line 125 awaits `storage.exists`.

- [ ] **Step 4: Remove the dead upload directory setting**

Delete `UPLOAD_DIR` from `apps/api/src/config/env.ts` and `.env.example`. Keep `MAX_UPLOAD_MB` — the size cap is still enforced in `store`.

- [ ] **Step 5: Run the document tests**

```bash
cd apps/api && npx vitest run tests/documents.test.ts
```

Expected: PASS. These cover upload, download, PDF generation and deletion — the whole surface this task touches.

- [ ] **Step 6: Confirm bytes land in Supabase, not on disk**

Upload a document through the running app, then check Supabase Dashboard → Storage → `probild-documents` for a `2026/08/<uuid>.pdf` object. Then:

```bash
find apps/api/uploads -newermt '-10 minutes' -type f
```

Expected: no output. Anything listed means a filesystem write survived.

- [ ] **Step 7: Full suite, then commit**

```bash
npm test
git add apps/api
git commit -m "feat: store documents in Supabase Storage"
```

---

## Task 9: Documentation and final verification

The README documents MySQL setup and three security guarantees that no longer hold.

**Files:**
- Modify: `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`

- [ ] **Step 1: Rewrite the README's setup**

Replace the MySQL/MariaDB row in the requirements table with `Supabase account — free tier is enough`, and drop the Node/npm rows' MySQL note. Replace the whole `mysql -u root <<'SQL' … SQL` block in "Getting started" with:

```markdown
# 2. Point the app at your Supabase project
#    Supabase → Connect → Session pooler (port 5432) gives you DATABASE_URL.
#    Project Settings → API keys gives you the publishable and secret keys.
```

Update step 3 to say the three secrets to generate are now one — `openssl rand -hex 32` for `ENCRYPTION_KEY` — since the JWT secrets are gone.

- [ ] **Step 2: Correct the three security claims**

In "Security notes", replace the first two bullets. They currently promise bcrypt cost 12 with a five-failure lockout, and opaque refresh tokens with family revocation. Neither survives (spec §9):

```markdown
- Authentication is handled by Supabase Auth. Passwords are stored and verified
  by Supabase, never by Probild. Sessions are JWTs signed with asymmetric keys;
  the API verifies them against the project's JWKS endpoint on every request and
  re-reads the account, so a suspended user loses access at once rather than when
  their token expires.
- Supabase applies rate limiting to sign-in attempts. There is deliberately no
  per-account lockout — that was lost with the move, and is recorded in
  docs/superpowers/specs/2026-08-20-supabase-migration-design.md §9.
```

Keep the bullets on API-enforced authorisation, AES-256-GCM for third-party OAuth tokens, and `.env` never being committed — all three are still true.

- [ ] **Step 3: Fix the repository map and storage note**

In the repository map, change `Express + TypeScript REST API, Prisma, MySQL` to `Express + TypeScript REST API, Prisma, Supabase Postgres`. In "Sending documents to clients", replace the paragraph telling the reader to back up `UPLOAD_DIR` alongside the database — files now live in the private `probild-documents` bucket and are backed up with the project.

- [ ] **Step 4: Update the architecture and roadmap docs**

```bash
grep -rni "mysql\|mariadb" README.md docs/ARCHITECTURE.md docs/ROADMAP.md
```

Fix every hit. In `docs/ROADMAP.md`, Phase 1's "MySQL schema for all 24 tables" becomes "Postgres schema"; note in Phase 9 that hosted Postgres, auth and storage are now Supabase-managed, leaving deployment and alerting outstanding.

- [ ] **Step 5: Run everything**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: all four clean, 11 test files passing.

- [ ] **Step 6: Verify the spec's definition of done, items 5-9**

```bash
npm run dev:api & npm run dev:worker &
```

Then confirm by hand:
1. Sign in at `http://localhost:5173` as the seeded admin.
2. Upload, list, download and delete a document; bytes appear in the bucket.
3. Generate a quotation PDF; it stores and downloads.
4. The worker logs `Automation worker starting` and completes a scan.
5. Settings → Google Calendar still offers to connect — this proves `ENCRYPTION_KEY` survived Task 5.

- [ ] **Step 7: Commit**

```bash
git add README.md docs
git commit -m "docs: describe the Supabase architecture and its security posture"
```

---

## Self-Review Notes

Checked against the spec:

- §4.1 session pooler → Task 1 Step 4, Task 2 Step 3, Global Constraints
- §4.2 90 `@db.Uuid`, adapter swap → Task 2 Steps 2-3
- §4.3 44 filters + mixed-case tests → Task 4 (all steps)
- §4.4 migrations deleted and regenerated → Task 2 Steps 5-6
- §4.5 raw SQL requoted → Task 2 Step 4 (`reference.ts`), Task 3 Step 3 (`helpers.ts`)
- §5.1 JWKS verification → Task 5 Step 2
- §5.2 `User.id` = `auth.users.id`, `passwordHash` dropped → Task 5 Steps 4, 6, 7
- §5.3 code removed → Task 5 Step 8
- §5.4 code changed → Task 5 Steps 3, 6, 7; Task 7 Steps 2-3
- §6 storage behind the same interface → Task 8 Step 2
- §7 schema isolation, guard, TRUNCATE, `@probild.test` purge → Task 3 Steps 1-3, Task 6 Step 3
- §8 env added/changed/removed, `ENCRYPTION_KEY` kept → Task 1 Steps 3-5, Task 5 Step 9, Task 8 Step 4
- §9 capabilities dropped, README rewritten → Task 6 Step 4, Task 9 Step 2
- §11 definition of done → Task 9 Steps 5-6

**Known deviation from the spec:** `readStream` becomes `async` (Task 8). Spec §6 claims the seven-function interface is unchanged; Supabase returns a Blob rather than a file handle, so one call site in `documents.service.ts:131` gains an `await`. Recorded here rather than silently absorbed.

---

## Task 10: Single-service Railway deployment

Added after the plan was written, at the user's request, replacing the
three-service split originally scoped.

**Files:**
- Create: `railway.json`, `scripts/railway-env.sh`, `docs/DEPLOYMENT.md`, `apps/web/server.js`
- Modify: `apps/api/src/config/env.ts` (`SERVE_WEB`, `WEB_DIST_DIR`, `RUN_WORKER`),
  `apps/api/src/app.ts` (static + SPA fallback), `apps/api/src/server.ts`
  (in-process worker), `apps/api/src/worker.ts` (`startAutomationWorker` export)

One Node process serves the API, the built React client and the automation
worker. `railway.json` supplies build command, start command, health check and
restart policy, so the service configures itself from the repo.

**Trade accepted deliberately:** a long deadline scan now competes with live
HTTP requests, which is exactly what a separate worker process prevents. The
README justifies the separation; the user chose one service anyway. Splitting it
back out is `RUN_WORKER=false` plus a second service running
`npm run worker:start -w @probild/api`.

**Constraint:** the service must stay at one replica while `RUN_WORKER=true`, or
every scheduled scan fires once per replica. Pinned via `numReplicas: 1`.

### Further defects found during implementation

| Problem | Resolution |
| --- | --- |
| `npm start` and `worker:start` pointed at `dist/server.js`, but `tsc` emits `dist/src/server.js` — `prisma/` and `src/` are both compiled, so the inferred rootDir is the package directory. Pre-existing; dev runs through `tsx`, so production had never booted. | Paths corrected in `apps/api/package.json`. |
| `worker.ts` called `main()` at module scope, so `server.ts` importing `startAutomationWorker` would have started a second, unmanaged worker and registered every recurring job twice. | Guarded with an `import.meta.url === pathToFileURL(process.argv[1])` entry-point check. |
| Rotating the Supabase secret key invalidated it mid-run, producing 83 failures reported as `Unregistered API key`. Nothing in the code was wrong. | Worth recognising: if a deployment starts returning `Unregistered API key`, a rotated key needs updating wherever it is stored, not debugging. |
