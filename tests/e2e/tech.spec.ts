import { expect, test, type Page } from './fixtures'

/**
 * The technician's phone shell.
 *
 * The role checks here are the ones a technician can be harmed by getting wrong: an office login
 * wandering onto the phone, and the phone opening to a blank page with no signal. The second only
 * runs against a production build, because the service worker is deliberately off in development —
 * a worker that survives `npm run dev` serves you an hour-old page while you edit. So this file
 * skips that one test there and says why, rather than passing vacuously.
 *
 * Needs the seed to have run (`npm run seed`).
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'cimmerian-dev-2026'
const TECHNICIAN = 'ahmad@cimmeriancrane.example'
const DISPATCHER = 'dispatch@cimmeriancrane.example'

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('a technician sees My jobs on a phone', async ({ page }) => {
  await signIn(page, TECHNICIAN)
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/m/jobs')

  await expect(page.getByRole('heading', { name: 'My jobs' })).toBeVisible()
  // The bottom bar and the sync line are what make this a field app rather than a web page.
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(page.getByText(/Up to date|Offline/)).toBeVisible()
})

test('the phone is not a screen an office login can open', async ({ page }) => {
  await signIn(page, DISPATCHER)
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/m/jobs')

  await expect(page).toHaveURL(/\/dashboard/)
})

test('the manifest is installable and stays inside the phone routes', async ({ request }) => {
  const response = await request.get('/m/manifest')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('manifest+json')

  const manifest = await response.json()
  expect(manifest.start_url).toBe('/m/jobs')
  expect(manifest.scope).toBe('/m/')
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.length).toBeGreaterThan(0)
})

test('the phone still shows the last job with the network cut', async ({ page, context }) => {
  await signIn(page, TECHNICIAN)
  await page.goto('/m/jobs')

  // The worker only exists in a production build — see the note at the top.
  const registered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false
    const registration = await navigator.serviceWorker.getRegistration('/')
    return Boolean(registration?.active)
  })
  test.skip(
    !registered,
    'Service worker is off against the dev server. Run `npm run build && npm start` to include this test.',
  )

  // Let the worker finish caching the page it just rendered before the network goes.
  await page.waitForLoadState('networkidle')

  await context.setOffline(true)
  await page.reload()

  await expect(page.getByRole('heading', { name: 'My jobs' })).toBeVisible({ timeout: 15_000 })
  await context.setOffline(false)
})
