import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Migrations follow the same rule as the runtime client: under NODE_ENV=test
 * they target TEST_DATABASE_URL, so `npm test` can never touch dev data.
 */
const url =
  process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_URL
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;

if (!url) {
  throw new Error('DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env.');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: { url },
});
