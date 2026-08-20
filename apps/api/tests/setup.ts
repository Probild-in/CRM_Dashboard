import 'dotenv/config';
import { afterAll, beforeAll } from 'vitest';
import pg from 'pg';

/**
 * Guard rail: the helpers truncate every table, so the suite must be provably
 * isolated from the working data before a single test runs.
 *
 * Two layers, because the first one alone is not enough:
 *
 *  1. Static — the URLs must not resolve to the same host, database and schema.
 *     Comparing raw strings would not do: Supabase exposes one database through
 *     a direct host, a session pooler and a transaction pooler.
 *
 *  2. Dynamic — a write issued through Prisma must actually land in the test
 *     schema and be invisible in `public`. Layer 1 passed while the runtime
 *     adapter still queried `public`, because `?schema=` is honoured by Prisma
 *     Migrate but ignored by the driver adapter. A URL that looks isolated is
 *     not evidence that it is.
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

const testSchema = new URL(testUrl).searchParams.get('schema') ?? 'public';
if (testSchema === 'public') {
  throw new Error('TEST_DATABASE_URL must name a dedicated schema, not public.');
}

beforeAll(async () => {
  const { prisma, databaseSchema } = await import('../src/lib/prisma.js');

  if (databaseSchema !== testSchema) {
    throw new Error(
      `Prisma resolved schema "${databaseSchema}" but TEST_DATABASE_URL names "${testSchema}".`,
    );
  }

  // Two markers: one through Prisma's generated queries, one through raw SQL.
  // Raw SQL resolves via the connection's search_path rather than Prisma's
  // schema option, so it is a separate escape route and must be probed too.
  const marker = `__isolation_probe_${Date.now()}`;
  const rawMarker = `${marker}_raw`;

  await prisma.systemSetting.create({
    data: { key: marker, value: { probe: true }, description: 'Isolation probe' },
  });
  await prisma.$executeRawUnsafe(
    `INSERT INTO system_settings (id, "key", value, description, is_public, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, '{"probe":true}'::jsonb, 'Isolation probe (raw)', false, now(), now())`,
    rawMarker,
  );

  const client = new pg.Client({
    connectionString: devUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    for (const [label, key] of [
      ['generated query', marker],
      ['raw SQL', rawMarker],
    ] as const) {
      const leaked = await client.query('select 1 from public.system_settings where "key" = $1', [
        key,
      ]);
      const landed = await client.query(
        `select 1 from ${testSchema}.system_settings where "key" = $1`,
        [key],
      );

      if (leaked.rowCount && leaked.rowCount > 0) {
        throw new Error(
          `ISOLATION FAILURE: a write via ${label} reached public.system_settings. ` +
            `The suite would destroy working data. Refusing to run.`,
        );
      }
      if (!landed.rowCount) {
        throw new Error(
          `ISOLATION FAILURE: a write via ${label} did not reach ${testSchema}.system_settings.`,
        );
      }
    }
  } finally {
    await prisma.systemSetting
      .deleteMany({ where: { key: { in: [marker, rawMarker] } } })
      .catch(() => {});
    await client.end().catch(() => {});
  }
});

/**
 * Purges test accounts from `auth.users`.
 *
 * `auth.users` is project-wide and cannot be schema-isolated, so the suite's
 * accounts are identified by their reserved `@probild.test` domain and removed
 * after the run. Without this they accumulate in the shared project forever.
 */
afterAll(async () => {
  const { supabaseAdmin } = await import('../src/lib/supabase.js');

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data.users.length) break;

    const stale = data.users.filter((user) => user.email?.endsWith('@probild.test'));
    for (const user of stale) {
      await supabaseAdmin.auth.admin.deleteUser(user.id).catch(() => {});
    }

    if (data.users.length < 200) break;
  }
});
