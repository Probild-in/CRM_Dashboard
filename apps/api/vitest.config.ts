import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    env: { NODE_ENV: 'test' },
    setupFiles: ['tests/setup.ts'],
    // Generous because every query is a round trip to a remote database rather
    // than a local socket; a test doing a dozen writes spends most of its time
    // waiting on the network.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The suite shares one Postgres schema and truncates between cases, so files
    // must not run concurrently. `poolOptions` was removed in Vitest 4 — these
    // are top-level now, and the old nesting was silently ignored.
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
