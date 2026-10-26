import { expect, test } from '@playwright/test'

// Placeholder that keeps the Playwright harness honest — it proves the app boots and serves a page.
// The real happy paths (brief §12.10) land in slice 11.

test('the app boots and serves the home page', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Helpdesk & Job Management' })).toBeVisible()
})

test('the health endpoint reports a healthy database', async ({ request }) => {
  const response = await request.get('/api/health')
  const body = await response.json()

  // Deliberately strict. An earlier version of this test accepted 503 as well, which would have
  // passed while the database was unreachable — exactly the failure it exists to catch.
  expect(response.status(), `health returned ${response.status()}: ${JSON.stringify(body)}`).toBe(200)
  expect(body.db).toBe('up')
  expect(body).toHaveProperty('time')
})
