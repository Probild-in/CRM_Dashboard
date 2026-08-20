import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { databaseUrl, isProduction } from '../config/env.js';

/**
 * Prisma 7 talks to Postgres through a driver adapter; the connection string is
 * owned by the adapter, not by schema.prisma.
 *
 * `databaseUrl` is a session-mode pooler URL (port 5432). Transaction-mode
 * pooling would break the interactive transactions this API relies on for its
 * invariants — lead conversion, quotation acceptance, reference allocation.
 */

/**
 * The `?schema=` parameter is honoured by Prisma Migrate but IGNORED by the
 * driver adapter, which would otherwise resolve everything against `public`.
 *
 * Both halves below are required, and neither is sufficient alone:
 *
 *   - `options: -c search_path=…` binds the *connection*, which is what
 *     hand-written SQL resolves through — `$queryRaw` in reference.ts, and the
 *     TRUNCATE the test suite uses to clear itself.
 *   - `{ schema }` makes Prisma's *generated* queries schema-qualified.
 *
 * With only the second, raw SQL silently reads and writes `public` while
 * generated queries use the right schema — which lets a test run destroy the
 * working data behind a connection string that looks correctly isolated.
 */
export const databaseSchema = new URL(databaseUrl).searchParams.get('schema') ?? 'public';

const adapter = new PrismaPg(
  {
    connectionString: databaseUrl,
    options: `-c search_path=${databaseSchema}`,
  },
  { schema: databaseSchema },
);

export const prisma = new PrismaClient({
  adapter,
  log: isProduction ? ['warn', 'error'] : ['warn', 'error'],
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

export type { Prisma } from '../generated/prisma/client.js';
