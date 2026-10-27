import { PrismaClient } from '@prisma/client'
import { expect, test, type Page } from '@playwright/test'

/**
 * Completing a report on the phone (slice 8).
 *
 * The point of this test is the seam no unit test can reach: the form writes to Dexie, the outbox is
 * flushed by the provider when the radio comes back, and the server writes the report. It submits
 * while the browser is offline and then asserts the database holds exactly one report — the failure
 * this is really guarding against is a retry that leaves a second visit record behind.
 *
 * It does not need the service worker: the page is already open when the network is cut, so this
 * runs against `npm run dev` like the rest of the suite.
 *
 * Needs the seed to have run (`npm run seed`).
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'cimmerian-dev-2026'
const TECHNICIAN = 'ahmad@cimmeriancrane.example'

const db = new PrismaClient()

interface Fixture {
  jobId: string
  craneId: string
  craneTag: string
  checklist: Array<{ label: string; resultType: string }>
}

let fixture: Fixture | null = null

async function loadFixture(): Promise<Fixture | null> {
  const job = await db.job.findFirst({
    where: {
      jobType: { code: 'BREAKDOWN', defaultReportTemplateId: { not: null } },
      technicians: { some: { technician: { user: { email: TECHNICIAN } } } },
      cranes: { some: {} },
    },
    orderBy: { createdAt: 'asc' },
    include: {
      jobType: true,
      cranes: { include: { crane: true }, orderBy: { crane: { assetTag: 'asc' } } },
    },
  })
  if (!job?.cranes[0]) return null

  const jobId = job.id
  const craneId = job.cranes[0].crane.id

  const checklist = await db.checklistItem.findMany({
    where: { templateId: job.jobType.defaultChecklistTemplateId ?? '' },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: { label: true, resultType: true },
  })

  // A previous run leaves its report behind; the scenario needs a crane with no report on it.
  const existing = await db.report.findMany({ where: { jobId }, select: { id: true } })
  const ids = existing.map((report) => report.id)
  if (ids.length > 0) {
    await db.stockMovement.deleteMany({ where: { reportId: { in: ids } } })
    await db.finding.deleteMany({ where: { reportId: { in: ids } } })
    await db.report.deleteMany({ where: { id: { in: ids } } })
  }

  return { jobId, craneId, craneTag: job.cranes[0].crane.assetTag, checklist }
}

test.afterAll(async () => {
  await db.$disconnect()
})

async function signIn(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(TECHNICIAN)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

test('a report filled in offline is submitted once when the signal returns', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000)

  fixture ??= await loadFixture()
  test.skip(!fixture, 'The seed has no breakdown job for Ahmad to report on.')
  const { jobId, craneId, craneTag, checklist } = fixture!

  await signIn(page)
  await page.goto(`/m/jobs/${jobId}`)
  await page.getByRole('link', { name: 'Fill report' }).first().click()

  // The heaviest cold route in the suite: Next compiles it on first request and the page then reads
  // a job from a database in another region. Measured at 43s on a first visit, so it gets its own
  // budget rather than the suite-wide one.
  await expect(page.getByRole('heading', { name: craneTag })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'Submit report' })).toBeVisible()

  // The radio is cut *after* the page has loaded, so this is the form working from its own draft.
  await context.setOffline(true)

  // Two required questions on the report itself.
  await page
    .getByRole('group', { name: 'Is the crane safe to operate?' })
    .getByRole('button', { name: 'Yes', exact: true })
    .click()
  await page
    .getByRole('group', { name: 'Returned to service?' })
    .getByRole('button', { name: 'Yes', exact: true })
    .click()

  // Every checklist item must be answered; the server refuses a partial checklist.
  for (const item of checklist) {
    const option = item.resultType === 'YES_NO' ? 'No' : 'Pass'
    await page
      .getByRole('group', { name: item.label })
      .getByRole('button', { name: option })
      .click()
  }

  // A signature is required, so draw one. Coordinates are relative to the canvas box.
  const pad = page.locator('canvas[aria-label="Technician signature signature pad"]')
  await pad.scrollIntoViewIfNeeded()
  const box = (await pad.boundingBox())!
  await page.mouse.move(box.x + 40, box.y + 60)
  await page.mouse.down()
  await page.mouse.move(box.x + 140, box.y + 100, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByText('Signed.')).toBeVisible()

  // The customer did not sign, so a reason is recorded instead.
  await page
    .getByLabel('Or: why the customer did not sign')
    .fill('Site supervisor unavailable; keys left at the guardhouse.')

  await page.getByRole('button', { name: 'Submit report' }).click()
  // The full sentence, not `/Saved on this phone/`: the autosave line above the form says that too,
  // and matching it hid a submit that had actually been refused by validation.
  await expect(
    page.getByText('Saved on this phone. It will upload when there is signal.'),
  ).toBeVisible()

  // Nothing reached the server while the radio was off.
  expect(await db.report.count({ where: { jobId, craneId } })).toBe(0)

  await context.setOffline(false)

  // The provider flushes the outbox when the browser says it is online again.
  await expect
    .poll(() => db.report.count({ where: { jobId, craneId } }), { timeout: 90_000 })
    .toBe(1)

  const report = await db.report.findFirstOrThrow({ where: { jobId, craneId } })
  expect(report.status).toBe('SUBMITTED')
  expect(report.technicianSignerName).toMatch(/Ahmad/i)
  expect(report.customerDeclinedReason).toContain('unavailable')
  expect(report.technicianSignatureFileId).toBeTruthy()

  const audits = await db.auditLog.count({ where: { entity: 'Report', entityId: report.id } })
  expect(audits).toBe(1)

  // Reopening the report says it is in, rather than offering a second one.
  await page.reload()
  await expect(page.getByText('Report submitted')).toBeVisible({ timeout: 30_000 })
  expect(await db.report.count({ where: { jobId, craneId } })).toBe(1)
})
