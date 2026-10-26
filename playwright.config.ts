import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  // Next compiles each route on first request in dev, and these tests talk to a database in another
  // region. The 5s default is not enough for a cold server, which made the suite fail or pass
  // depending on nothing but ordering — the worst kind of flake.
  expect: { timeout: 15_000 },
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
