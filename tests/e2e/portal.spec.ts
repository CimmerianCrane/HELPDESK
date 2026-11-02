import { PrismaClient } from '@prisma/client'
import { expect, test, type Page } from './fixtures'
import { DEMO_PASSWORD, signIn } from './helpers'

/**
 * The customer portal in a browser (slice 31).
 *
 * The integration suite proves `scope.ts` filters the rows. This proves the parts only a browser can:
 * the seeded portal login signs in, lands in `/portal` rather than the office shell, and cannot reach
 * another customer's job even by typing its URL. It also proves the reverse — a staff login cannot
 * open the portal.
 *
 * The demo customer has no certificates and no approved reports, so those pages are asserted on their
 * empty states. Anything else would be testing the seed, not the portal.
 */

const PORTAL_EMAIL = 'portal@cimmeriancrane.example'
const ADMIN_EMAIL = 'admin@cimmeriancrane.example'

/**
 * `signIn` only clicks; a test that navigates straight after would cancel the sign-in POST in flight.
 * Every other spec proves the landing page first, so these do too.
 */
async function signInToPortal(page: Page): Promise<void> {
  await signIn(page, PORTAL_EMAIL, DEMO_PASSWORD)
  await expect(page).toHaveURL(/\/portal$/)
}

// The page heads with the trading name when there is one (`portalSummary`).
const CUSTOMER = 'Jurong Port Engineering'

/** The demo book's two customers, by job number, so the "not yours" test does not hardcode an id. */
const OWN_JOB = 'JOB-2026-0001'
const FOREIGN_JOB = 'JOB-2026-0002'

test.describe('customer portal', () => {
  test('the portal login lands on the portal overview, not the office', async ({ page }) => {
    await signInToPortal(page)

    await expect(page.getByRole('heading', { level: 1, name: CUSTOMER })).toBeVisible()
    // The office nav is not offered to them.
    await expect(page.getByRole('link', { name: 'Jobs', exact: true })).toHaveAttribute(
      'href',
      '/portal/jobs',
    )
  })

  test('a customer visiting an office URL is sent back to the portal', async ({ page }) => {
    await signInToPortal(page)
    await page.goto('/dashboard')

    await expect(page).toHaveURL(/\/portal$/)
  })

  test('the jobs list shows their own jobs and no one else’s', async ({ page }) => {
    await signInToPortal(page)
    await page.goto('/portal/jobs')

    await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible()
    await expect(page.getByRole('link', { name: OWN_JOB })).toBeVisible()
    await expect(page.getByText(FOREIGN_JOB)).toHaveCount(0)
  })

  test('another customer’s job is not found, even by its URL', async ({ page }) => {
    const db = new PrismaClient()
    let foreignId: string | null = null
    try {
      const job = await db.job.findFirst({ where: { number: FOREIGN_JOB }, select: { id: true } })
      foreignId = job?.id ?? null
    } finally {
      await db.$disconnect()
    }
    // The seed owns this number; if it moved, say so plainly rather than failing on a null URL.
    expect(foreignId, `${FOREIGN_JOB} should exist in the demo book`).not.toBeNull()

    await signInToPortal(page)
    const response = await page.goto(`/portal/jobs/${foreignId}`)

    expect(response?.status()).toBe(404)
    await expect(page.getByText('This page could not be found')).toBeVisible()
  })

  test('their own job opens and shows the visit details', async ({ page }) => {
    await signInToPortal(page)
    await page.goto('/portal/jobs')
    await page.getByRole('link', { name: OWN_JOB }).click()

    await expect(page.getByRole('heading', { level: 1, name: OWN_JOB })).toBeVisible()
    await expect(page.getByText('No report has been issued for this job yet.')).toBeVisible()
  })

  test('the certificates and reports pages render their empty states', async ({ page }) => {
    await signInToPortal(page)

    await page.goto('/portal/certificates')
    await expect(page.getByRole('heading', { level: 1, name: 'Certificates' })).toBeVisible()

    await page.goto('/portal/reports')
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible()
    await expect(page.getByText('No issued reports yet.')).toBeVisible()
  })

  test('a staff login cannot open the portal', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, DEMO_PASSWORD)
    await expect(page).toHaveURL(/\/dashboard$/)
    await page.goto('/portal')

    await expect(page).toHaveURL(/\/dashboard$/)
  })
})
