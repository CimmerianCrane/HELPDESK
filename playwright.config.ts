import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  // The suite signs in more often than any person would, from one address. See the file.
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  // Next compiles each route on first request in dev, and these tests talk to a database in another
  // region. The 5s default is not enough for a cold server, which made the suite fail or pass
  // depending on nothing but ordering — the worst kind of flake.
  expect: { timeout: 15_000 },
  // A whole test here is several sign-in round trips and a page render. Signing in alone takes ~6s
  // against the Seoul database; four of those in parallel against one dev server queued into a
  // 15s+ wait and failed on the clock rather than on anything being wrong. The default 30s per test
  // is not enough once a test signs in twice (see the sign-out test).
  timeout: 90_000,
  // One worker, not four. The dev server is a single process talking to a database in another
  // region, so parallel tests contend for it and the slowest loses. The suite is a couple of minutes
  // serially, which is a better trade than a suite that fails or passes on scheduling luck.
  workers: 1,
  projects: [
    { name: 'office', use: { ...devices['Desktop Chrome'] } },
    // Technician screens are mobile-first and must be checked at ~390px (brief §14).
    { name: 'technician', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
