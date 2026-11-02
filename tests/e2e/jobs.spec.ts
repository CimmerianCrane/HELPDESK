import { PrismaClient } from '@prisma/client'
import { expect, test, type Page } from './fixtures'

/**
 * The company-wide job list, its export, its calendar, saved filters and the audit viewer (slice 10).
 *
 * It builds its own customer, crane and job rather than touching a seeded one, because `report.spec.ts`
 * deletes and recreates the report on Ahmad's breakdown job and the two would fight over it. Everything
 * created here is deleted again in `afterAll`.
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'cimmerian-dev-2026'
const DISPATCHER = 'dispatch@cimmeriancrane.example'
const ADMIN = 'admin@cimmeriancrane.example'

const db = new PrismaClient()
const suffix = Math.random().toString(36).slice(2, 10)
const tag = `S10-${suffix.toUpperCase()}`
const created = { customerId: '', jobId: '' }

test.beforeAll(async () => {
  const jobType = await db.jobType.findFirstOrThrow({ where: { isActive: true } })

  const customer = await db.customer.create({
    data: { legalName: `E2E List ${suffix}`, status: 'ACTIVE' },
  })
  const site = await db.site.create({
    data: { customerId: customer.id, name: `E2E Site ${suffix}` },
  })
  const crane = await db.crane.create({
    data: {
      siteId: site.id,
      customerId: customer.id,
      assetTag: tag,
      qrValue: `QR-${tag}`,
      type: 'OVERHEAD',
      swlKg: 5000,
    },
  })

  const job = await db.job.create({
    data: {
      number: `JOB-${tag}`,
      jobTypeId: jobType.id,
      customerId: customer.id,
      siteId: site.id,
      status: 'NEW',
      priority: 'P2',
      cranes: { create: { craneId: crane.id } },
      // A visit mid-month, so the calendar has something to put on a square.
      scheduledStart: new Date('2027-03-10T02:00:00Z'),
      slaResponseDue: new Date(Date.now() + 3600_000),
      slaResolveDue: new Date(Date.now() + 86_400_000),
    },
  })

  // The job was written straight through Prisma, so it has no audit row of its own — and the audit
  // viewer is what this fixture exists for. This is the row `withAudit` would have written.
  const admin = await db.user.findFirstOrThrow({ where: { email: ADMIN } })
  await db.auditLog.create({
    data: {
      entity: 'Job',
      entityId: job.id,
      action: 'CREATE',
      after: { number: job.number, status: 'NEW' },
      userId: admin.id,
      ip: '203.0.113.10',
      userAgent: 'playwright',
    },
  })

  created.customerId = customer.id
  created.jobId = job.id
})

test.afterAll(async () => {
  if (created.jobId) {
    await db.auditLog.deleteMany({ where: { entityId: created.jobId } })
    await db.jobStatusHistory.deleteMany({ where: { jobId: created.jobId } })
    await db.jobCrane.deleteMany({ where: { jobId: created.jobId } })
    await db.job.deleteMany({ where: { id: created.jobId } })
  }
  if (created.customerId) {
    await db.crane.deleteMany({ where: { customerId: created.customerId } })
    await db.site.deleteMany({ where: { customerId: created.customerId } })
    await db.customer.deleteMany({ where: { id: created.customerId } })
  }
  await db.$disconnect()
})

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

test('the job list filters, exports and draws a calendar', async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page, DISPATCHER)

  await page.goto('/jobs')
  await page.getByLabel('Search').fill(tag)
  // Exact: "Save this filter" also contains the word.
  await page.getByRole('button', { name: 'Filter', exact: true }).click()

  // The asset tag is one of the searchable columns, and it is unique to this test's crane.
  await expect(page).toHaveURL(new RegExp(`q=${tag}`))
  await expect(page.getByRole('link', { name: `JOB-${tag}` })).toBeVisible()

  // The same query string drives the download, so the file holds the row that is on screen.
  const csv = await (await page.request.get(`/jobs/export?q=${tag}`)).text()
  expect(csv).toContain('Job number,Status,Priority')
  expect(csv).toContain(`JOB-${tag}`)

  // The calendar files the visit on its wall date, in the operating timezone. The square itself is
  // located by the job's own link, so the test does not depend on how the grid is drawn.
  await page.goto(`/jobs?q=${tag}&view=calendar&month=2027-03`)
  const calendar = page.locator('section').filter({ hasText: 'March 2027' })
  const visit = calendar.getByRole('link', { name: `JOB-${tag}` })
  await expect(visit).toBeVisible()
  // 10 March 2027 is a Wednesday; the square is the one holding the link.
  await expect(visit.locator('xpath=ancestor::div[contains(@class,"min-h-24")]')).toContainText('10')
})

test('a saved filter comes back as one click, and can be deleted', async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page, DISPATCHER)

  const name = `E2E ${suffix}`
  await page.goto(`/jobs?q=${tag}`)
  await page.getByLabel('Name this filter').fill(name)
  await page.getByRole('button', { name: 'Save this filter' }).click()
  await expect(page.getByText('Filter saved.')).toBeVisible()

  // Saved against this user, so the row is there even after leaving the page.
  await page.goto('/jobs')
  await page.getByRole('link', { name }).click()
  await expect(page).toHaveURL(new RegExp(`q=${tag}`))

  await page.getByRole('button', { name: `Delete the saved filter ${name}` }).click()
  await expect(page.getByRole('link', { name })).toHaveCount(0)
  expect(await db.savedJobFilter.count({ where: { name } })).toBe(0)
})

test('an administrator sees the audit trail of a record, and a dispatcher never reaches it', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await signIn(page, ADMIN)

  await page.goto(`/admin/audit?entity=Job&entityId=${created.jobId}`)
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'create' })).toBeVisible()

  // The dispatcher holds neither user.manage nor audit.read, so the admin layout turns them away
  // before the page renders.
  await expect(page.getByRole('link', { name: 'Audit' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  // Wait for the sign-out request to land. Navigating straight to /login cancels it, and the page
  // then sees the session that was never cleared and redirects to the dashboard.
  await page.waitForURL(/\/login/)
  await signIn(page, DISPATCHER)
  // Every section is open in the rail now, but a dispatcher holds neither `user.manage` nor
  // `audit.read`, so the Admin section is not rendered for them at all.
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Audit' })).toHaveCount(0)
  await page.goto('/admin/audit')
  await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible()
})

test('the dashboard tiles point at the list that answers them', async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page, DISPATCHER)

  await page.getByRole('link', { name: 'SLA breaches' }).click()
  await expect(page).toHaveURL(/\/jobs\?sla=breached/)
  await expect(page.getByLabel('SLA state')).toHaveValue('breached')
})
