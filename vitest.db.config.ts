import { defineConfig } from 'vitest/config';

/**
 * Tests that need a real Postgres (pnpm test:db). They run one file at a time against
 * the throwaway database from docker-compose.test.yml, rebuilt from the migrations first.
 */
export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.db.test.ts', 'packages/*/src/**/*.db.test.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
