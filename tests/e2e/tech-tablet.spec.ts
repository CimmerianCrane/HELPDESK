import { expect, test, type Page } from './fixtures'

/**
 * The technician app on a tablet (slice 40).
 *
 * The phone spec proves the screens work at 390px; this one proves the `md:` layout actually fills
 * 768–1280px rather than leaving a phone column floating in the middle, and that the wider scale
 * does not introduce a sideways scroll — the failure mode of every `max-w` change.
 *
 * Runs in the `tablet` Playwright project (800x1280). Needs the seed (`npm run seed`).
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'cimmerian-dev-2026'
const TECHNICIAN = 'ahmad@cimmeriancrane.example'

async function signIn(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(TECHNICIAN)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

/** The one thing a wider layout must not do. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test('the job list is two columns on a tablet', async ({ page }) => {
  await signIn(page)
  await page.goto('/m/jobs')
  await expect(page.getByRole('heading', { name: 'My jobs' })).toBeVisible()

  await expectNoSidewaysScroll(page)

  // Two columns *within* a day group. The seed's job spread is not the point of this test, so ask
  // the layout rather than hunting for a day that happens to hold a pair.
  const tracks = await page.evaluate(() => {
    const day = [...document.querySelectorAll('section ul')].find((ul) => ul.children.length > 0)
    return day ? getComputedStyle(day).gridTemplateColumns.split(' ').length : 0
  })
  expect(tracks).toBe(2)

  const cards = page.locator('section ul').first().locator(':scope > li')
  const widths = await cards.evaluateAll((items) =>
    items.slice(0, 2).map((item) => item.getBoundingClientRect().width),
  )
  // Half the shell's content width — a phone column in a wide shell would be ~512px at most.
  for (const width of widths) expect(width).toBeGreaterThan(300)
})

test('the report form is two columns and the submit bar clears the nav', async ({ page }) => {
  await signIn(page)

  // Not every seed job has a crane, and only one with a crane has a report link — so find it by
  // trying the list rather than assuming the first card leads to one.
  await page.goto('/m/jobs')
  const jobHrefs = await page
    .locator('section ul > li a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')!))

  let found = false
  for (const href of jobHrefs) {
    await page.goto(href)
    if (await page.getByRole('link', { name: 'Fill report' }).count()) {
      found = true
      break
    }
  }
  test.skip(!found, 'No seeded job for this technician has a fillable report.')
  await page.getByRole('link', { name: 'Fill report' }).click()
  // The draft is read out of Dexie before the form renders.
  await expect(page.getByRole('heading', { name: 'Photos' })).toBeVisible()

  // `main > div` is the page wrapper (back link + form); the form root is the div inside it.
  const form = page.locator('main > div > div').first()
  const tracks = await form.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
  expect(tracks).toBe(2)

  // Photos and Signatures are the two short panels: side by side, sharing a top edge.
  const photos = await page.getByRole('heading', { name: 'Photos' }).boundingBox()
  const signatures = await page.getByRole('heading', { name: 'Signatures' }).boundingBox()
  expect(photos).not.toBeNull()
  expect(signatures).not.toBeNull()
  expect(Math.abs(photos!.y - signatures!.y)).toBeLessThan(2)

  const submit = await page.getByRole('button', { name: /submit report|try sending/i }).boundingBox()
  const nav = await page.getByRole('navigation', { name: 'Field' }).boundingBox()
  expect(submit).not.toBeNull()
  expect(nav).not.toBeNull()
  expect(submit!.y + submit!.height).toBeLessThanOrEqual(nav!.y + 1)
})

/**
 * The fault this file guards against: the field shell had no navigation at all once you were inside
 * `/m/` — only a one-item bar — while every office screen had the rail. At tablet and desk width the
 * rail must carry a technician's own list plus the office screens their role may open, and it must
 * never offer one they cannot.
 */
test('the technician gets the same rail as the office, filtered by role', async ({ page }) => {
  await signIn(page)
  await page.goto('/m/jobs')
  await expect(page.getByRole('heading', { name: 'My jobs' })).toBeVisible()

  // Below `lg` the rail is folded away and the bar carries the thumb-sized destinations.
  const bar = page.getByRole('navigation', { name: 'Field' })
  await expect(bar).toBeVisible()
  expect(await bar.getByRole('link').count()).toBeGreaterThan(1)

  // At desk width the bar goes and the rail takes over — the same component the office uses.
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(bar).toBeHidden()
  const rail = page.locator('aside#office-nav')
  await expect(rail).toBeVisible()
  await expect(rail.getByRole('link', { name: 'My jobs' })).toBeVisible()

  // A technician holds no `job.read.all`: the company job list must not be on their rail.
  await expect(rail.getByRole('link', { name: 'Jobs', exact: true })).toHaveCount(0)
  await expect(rail.getByRole('link', { name: 'Invoices' })).toHaveCount(0)
  await expect(rail.getByRole('link', { name: 'Users' })).toHaveCount(0)
})

/**
 * The installed app is scoped to `/m/` by its manifest, so a rail link to an office screen would
 * leave the app and open Chrome. Both the bar and the rail are gated on the same display-mode query
 * so that the landscape tablet — which is wide enough for the rail — keeps the bar instead.
 *
 * Emulating `display-mode` is not available to Playwright, so this asserts the CSS contract: the two
 * utilities exist, and each keys off `display-mode`. A manual check in an installed app is the proof.
 */
test('the standalone guard keeps the field bar in the installed app', async ({ page }) => {
  await signIn(page)
  await page.goto('/m/jobs')
  await expect(page.getByRole('heading', { name: 'My jobs' })).toBeVisible()

  const rules = await page.evaluate(() => {
    const found: string[] = []
    const walk = (list: CSSRuleList) => {
      for (const rule of list) {
        const text = rule.cssText ?? ''
        if (text.includes('display-mode')) found.push(text)
        const nested = (rule as CSSMediaRule).cssRules
        if (nested) walk(nested)
      }
    }
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules)
      } catch {
        // A cross-origin sheet cannot be read; every sheet here is same-origin.
      }
    }
    return found
  })

  expect(rules.length, 'no display-mode utility was emitted').toBeGreaterThan(0)
  expect(rules.join('\n')).toContain('standalone')
  expect(rules.join('\n')).toContain('browser')
})

test('the shell uses the tablet width, not a phone column', async ({ page }) => {
  await signIn(page)
  await page.goto('/m/jobs')

  const main = page.locator('main')
  const box = await main.boundingBox()
  expect(box).not.toBeNull()
  // `max-w-4xl` at 800px leaves 32px total padding; a phone column would be ~512px wide.
  expect(box!.width).toBeGreaterThan(700)
})

test('the in-scope login keeps an expired session inside the app', async ({ page }) => {
  await page.goto('/m/jobs')
  await expect(page).toHaveURL(/\/m\/login/)
  await expect(page.getByLabel('Email')).toBeVisible()
})
