import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests that need a database run separately: pnpm test:db
    exclude: ['**/node_modules/**', '**/*.db.test.ts', '.kilo/**'],
    include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
