import { defineConfig } from '@playwright/test';

/**
 * End-to-end: the six scenarios of PDF section 2.1 against the real API (PGlite, seeded) serving the
 * production PWA build from one origin, so the service worker and offline mode behave as deployed.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    locale: 'en-GB',
    serviceWorkers: 'allow',
  },
  projects: [
    { name: 'mobile', testMatch: /.*\.mobile\.spec\.ts/, use: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
    { name: 'desktop', testMatch: /.*\.desktop\.spec\.ts/, use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'node ../../scripts/workspace.mjs api e2e:server',
    url: 'http://localhost:4173/api/health',
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'pipe',
  },
});
