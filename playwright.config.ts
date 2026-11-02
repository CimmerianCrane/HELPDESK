import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  // The suite signs in more often than any person would, from one address. See the file.
  use: {
    baseURL: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  // Next compiles each route on first request in dev, and these tests talk to a database in another
  // region. The 5s default is not enough for a cold server, which made the suite fail or pass
  // depending on nothing but ordering — the worst kind of flake. 15s still lost: a first visit to a
  // heavy route measured 15.1s, so the assertion failed on a page that was about to render. 30s
  // leaves the compile plus the round trip room without letting a genuinely stuck test hang.
  expect: { timeout: 30_000 },
  // A whole test here is several sign-in round trips and a page render. Signing in alone takes ~6s
  // against the hosted database (a long round trip while it was in Seoul); four of those in parallel
  // against one dev server queued into a 15s+ wait and failed on the clock rather than on anything
  // being wrong. The default 30s per test is not enough once a test signs in twice (see the
  // sign-out test).
  timeout: 90_000,
  // One worker, not four. The dev server is a single process talking to a database in another
  // region, so parallel tests contend for it and the slowest loses. The suite is a couple of minutes
  // serially, which is a better trade than a suite that fails or passes on scheduling luck.
  workers: 1,
  projects: [
    // The field specs are written for the field shell: the phone spec asserts the bottom bar, which
    // is deliberately gone above `lg`, and the tablet spec is written for 800x1280. Both have their
    // own project, so running them at desktop width would test a layout they do not describe.
    {
      name: 'office',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /tech\.spec\.ts|tech-tablet\.spec\.ts/,
    },
    // Technician screens are mobile-first and must be checked at ~390px (brief §14).
    // The acceptance paths are the exception: they are long office-only tests whose phone halves
    // already run here as `report.spec.ts`, so they only run in the desktop project.
    // The portal is a desktop screen like the office, not the phone.
    {
      name: 'technician',
      use: { ...devices['Pixel 7'] },
      testIgnore: /happy-path\.spec\.ts|phase2\.spec\.ts|portal\.spec\.ts|tech-tablet\.spec\.ts/,
    },
    // 800x1280 is tablet-portrait, the width the `md:` breakpoint has to be right at.
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 800, height: 1280 },
        hasTouch: true,
        isMobile: false,
      },
      testMatch: /tech-tablet\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
