import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 3100;
const WORKER_PORT = 8787;

/** End-to-end tests: the built web app and the export worker, driven in a real browser. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Most users are on phones: the whole flow must work at 380px wide.
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 380, height: 760 }, hasTouch: true },
    },
    // Other browser engines (Phase 7.9). Not part of `pnpm e2e`, which stays quick;
    // run them with `pnpm e2e:browsers`. These are the engines on a desktop computer,
    // and an emulated iPhone is not a real one: see docs/qa-checklist.md.
    ...(process.env.ALL_BROWSERS
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
          { name: 'iphone-emulated', use: { ...devices['iPhone 13'] } },
          { name: 'android-emulated', use: { ...devices['Pixel 7'] } },
        ]
      : []),
  ],
  webServer: [
    {
      command: `pnpm web:build && pnpm --filter @pentwin/web start -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      // Baked into the build: canonical addresses, the sitemap and social cards use it.
      env: { NEXT_PUBLIC_SITE_URL: 'https://example.test' },
    },
    {
      command: 'pnpm worker',
      url: `http://localhost:${WORKER_PORT}/health`,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: {
        WORKER_PORT: String(WORKER_PORT),
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        EXPORT_SIGNING_SECRET: 'e2e-only-secret-not-used-anywhere-else',
      },
    },
  ],
});
