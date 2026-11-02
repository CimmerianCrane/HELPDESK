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
  // The bottom bar and the sync line are what make this a field app rather than a web page. It is
  // its own landmark ("Field") because the shell also carries the office rail at `lg`.
  await expect(page.getByRole('navigation', { name: 'Field' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Field' }).getByRole('link', { name: 'My jobs' })).toBeVisible()
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
  expect(manifest.id).toBe('/m/')
  expect(manifest.start_url).toBe('/m/jobs')
  expect(manifest.scope).toBe('/m/')
  expect(manifest.display).toBe('standalone')
  // Landscape is how a crane gets inspected.
  expect(manifest.orientation).toBe('any')
  // The shell's own colours, so the launch screen does not flash white.
  expect(manifest.theme_color).toBe('#1f2328')
  expect(manifest.background_color).toBe('#f5f6f7')

  // PNG at the two sizes Android's launcher asks for, plus a maskable square.
  const icons = manifest.icons as Array<{ src: string; sizes: string; type: string; purpose: string }>
  expect(icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png')).toBe(true)
  expect(icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png')).toBe(true)
  expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true)

  // Every file it names must exist — a 404 icon is an install warning, not a broken test.
  for (const icon of icons) {
    const head = await request.get(icon.src)
    expect(head.status(), `${icon.src} is missing`).toBe(200)
  }
})

test('the install card is offered in a browser tab, and only on My jobs', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await signIn(page, TECHNICIAN)
  await expect(page).toHaveURL(/\/dashboard/)
  // A `<Link>`, not `page.goto`: arriving from the dashboard mounts the field layout inside React
  // rather than server-rendering it. A capture script in that layout is silently dropped here, which
  // is exactly the fault the owner hit and a direct page load would never show.
  await page.getByRole('link', { name: /open my jobs/i }).click()

  // A browser context is never standalone, so this is the state a technician arrives in.
  await expect(page.getByText('Install on this tablet')).toBeVisible()

  // Headless Chrome never fires the real event, so dispatch one: the capture script has to be
  // listening *by now* for the card to have anything to install with.
  const captured = await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    window.dispatchEvent(event)
    return { stored: window.__techInstallPrompt === event, prevented: event.defaultPrevented }
  })
  expect(captured).toEqual({ stored: true, prevented: true })
  expect(consoleErrors).toEqual([])

  // Dismissed for 30 days, not for ever — and it does not follow them into a form.
  await page.getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByText('Install on this tablet')).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Install on this tablet')).toHaveCount(0)

  const job = page.getByRole('link').filter({ hasText: /\d{4}\s*·/ }).first()
  if (await job.count()) {
    await job.click()
    await expect(page.getByText('Install on this tablet')).toHaveCount(0)
  }
})

test('the phone still shows the last job with the network cut', async ({ page, context }) => {
  await signIn(page, TECHNICIAN)
  // Without this the navigation below races the sign-in, lands on `/m/login`, and the worker is
  // still installing when the check runs — the test then skipped itself against a production build.
  await expect(page).toHaveURL(/\/dashboard/)
  await page.goto('/m/jobs')
  await expect(page.getByRole('heading', { name: 'My jobs' })).toBeVisible()

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
