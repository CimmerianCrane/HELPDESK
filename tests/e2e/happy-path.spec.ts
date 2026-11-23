import { PrismaClient } from '@prisma/client'
import { expect, test, type Page } from './fixtures'

/**
 * The Phase 1 acceptance path (brief §12.10, slice 11).
 *
 * One call to the office becomes a signed report and an issued PDF: a P1 breakdown ticket is triaged,
 * turned into a job, scheduled, assigned to a qualified technician and dispatched; the technician
 * fills the report on a phone with no signal, adds a photo and both signatures; the office moves the
 * job on, approves the report and gets a numbered PDF.
 *
 * Every record is this test's own — customer, site, crane, ticket, job, report. `report.spec.ts` and
 * `approval.spec.ts` delete and recreate their fixtures, and a test that shared one would fail
 * depending on file order. Only the demo *accounts* are borrowed, because a sign-in needs one.
 *
 * Runs under the desktop project only: the phone half of the same path, at 390px and offline, is
 * `report.spec.ts`, and running this twice would double a four-minute test for no extra coverage.
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'cimmerian-dev-2026'
const DISPATCHER = 'dispatch@cimmeriancrane.example'
const TECHNICIAN = 'raj@cimmeriancrane.example'

const db = new PrismaClient()
const suffix = Math.random().toString(36).slice(2, 8)
const tag = `S11-${suffix.toUpperCase()}`

const VISIT_START = '2027-05-04T09:00'
const VISIT_END = '2027-05-04T12:00'

// A 1×1 PNG. The form re-encodes whatever it is given, so the pixel does not matter — only that a
// real file goes through the offline queue and the upload route.
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

interface Field {
  key: string
  label: string
  type: string
  options?: string[]
  required?: boolean
}

interface Fixture {
  customerId: string
  siteId: string
  craneId: string
  jobTypeId: string
  technicianId: string
  checklist: Array<{ label: string; resultType: string }>
  sections: Array<{ key: string; layout: string; fields: Field[] }>
}

let fixture: Fixture

test.beforeAll(async () => {
  const jobType = await db.jobType.findUniqueOrThrow({
    where: { code: 'BREAKDOWN' },
    select: {
      id: true,
      name: true,
      defaultChecklistTemplateId: true,
      defaultReportTemplateId: true,
    },
  })
  if (!jobType.defaultReportTemplateId || !jobType.defaultChecklistTemplateId) {
    throw new Error('The BREAKDOWN job type needs a report and a checklist template; run npm run seed.')
  }

  const technician = await db.technician.findFirstOrThrow({
    where: { user: { email: TECHNICIAN } },
    select: { id: true },
  })

  const template = await db.reportTemplate.findUniqueOrThrow({
    where: { id: jobType.defaultReportTemplateId },
    select: { schema: true },
  })
  const schema = template.schema as unknown as { sections: Fixture['sections'] }

  const checklist = await db.checklistItem.findMany({
    where: { templateId: jobType.defaultChecklistTemplateId },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: { label: true, resultType: true },
  })

  const customer = await db.customer.create({
    data: {
      legalName: `E2E Happy Path ${suffix}`,
      status: 'ACTIVE',
      contacts: {
        create: {
          name: 'E2E Site Supervisor',
          role: 'SITE_CONTACT',
          email: `happy-${suffix}@example.test`,
          isPrimary: true,
        },
      },
    },
  })
  const site = await db.site.create({
    data: {
      customerId: customer.id,
      name: `E2E Yard ${suffix}`,
      address: { line1: '1 Test Road', city: 'Singapore', postalCode: '600001' },
    },
  })
  const crane = await db.crane.create({
    data: {
      siteId: site.id,
      customerId: customer.id,
      assetTag: tag,
      qrValue: `QR-${tag}`,
      type: 'OVERHEAD',
      swlKg: 10000,
      status: 'RESTRICTED',
      restrictedReason: 'Brake slips under load — stopped until repaired.',
    },
  })

  fixture = {
    customerId: customer.id,
    siteId: site.id,
    craneId: crane.id,
    jobTypeId: jobType.id,
    technicianId: technician.id,
    checklist,
    sections: schema.sections,
  }
})

test.afterAll(async () => {
  // The app never deletes reports or audit rows; a test that created them removes its own.
  const customerId = fixture?.customerId
  if (customerId) {
    const job = await db.job.findFirst({
      where: { customerId },
      select: { id: true },
    })
    // Found by customer, not via the job, so a test that failed before the job existed still cleans up.
    const ticketIds = (
      await db.ticket.findMany({ where: { customerId }, select: { id: true } })
    ).map((row) => row.id)
    if (job) {
      const reportIds = (
        await db.report.findMany({ where: { jobId: job.id }, select: { id: true } })
      ).map((row) => row.id)
      if (reportIds.length > 0) {
        await db.finding.deleteMany({ where: { reportId: { in: reportIds } } })
        await db.stockMovement.deleteMany({ where: { reportId: { in: reportIds } } })
        await db.report.deleteMany({ where: { id: { in: reportIds } } })
        await db.syncReceipt.deleteMany({ where: { id: { in: reportIds } } })
        await db.auditLog.deleteMany({ where: { entity: 'Report', entityId: { in: reportIds } } })
      }
      await db.notification.deleteMany({ where: { link: `/jobs/${job.id}` } })
      await db.file.deleteMany({
        where: { OR: [{ jobId: job.id }, { entityId: { in: reportIds } }] },
      })
      await db.auditLog.deleteMany({ where: { entityId: { in: [job.id, ...ticketIds] } } })
      await db.jobStatusHistory.deleteMany({ where: { jobId: job.id } })
      await db.jobTechnician.deleteMany({ where: { jobId: job.id } })
      await db.jobCrane.deleteMany({ where: { jobId: job.id } })
      await db.job.deleteMany({ where: { id: job.id } })
    }
    for (const ticketId of ticketIds) {
      await db.notification.deleteMany({ where: { link: `/tickets/${ticketId}` } })
      await db.auditLog.deleteMany({ where: { entityId: ticketId } })
    }
    await db.ticket.deleteMany({ where: { customerId } })
    await db.crane.deleteMany({ where: { customerId } })
    await db.site.deleteMany({ where: { customerId } })
    await db.contact.deleteMany({ where: { customerId } })
    await db.customer.deleteMany({ where: { id: customerId } })
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

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
}

/** Draws a stroke on a signature pad and waits for one more "Signed." tick than before. */
async function sign(page: Page, label: string): Promise<void> {
  const before = await page.getByText('Signed.').count()
  const pad = page.locator(`canvas[aria-label="${label} signature pad"]`)
  // Centre it: the report's Submit bar is fixed to the bottom, and a minimal scroll can leave the
  // lower pad underneath it, where the mouse never reaches the canvas.
  await pad.evaluate((canvas) => canvas.scrollIntoView({ block: 'center' }))
  const box = (await pad.boundingBox())!
  await page.mouse.move(box.x + 30, box.y + 40)
  await page.mouse.down()
  await page.mouse.move(box.x + 150, box.y + 90, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByText('Signed.')).toHaveCount(before + 1)
}

test('a P1 breakdown becomes an issued customer report', async ({ page, context }) => {
  test.setTimeout(300_000)
  const { customerId, siteId, craneId, jobTypeId, technicianId, checklist, sections } = fixture

  // --- office: record and triage the call -------------------------------------

  await signIn(page, DISPATCHER)
  await page.goto('/tickets/new')
  await page.locator('#ticket-customer').selectOption(customerId)
  await expect(page.locator(`#ticket-site option[value="${siteId}"]`)).toHaveCount(1)
  await page.locator('#ticket-site').selectOption(siteId)
  await expect(page.locator(`#ticket-crane option[value="${craneId}"]`)).toHaveCount(1)
  await page.locator('#ticket-crane').selectOption(craneId)
  await page
    .locator('#ticket-description')
    .fill(`Hoist brake slips under load on ${tag}. Operator stopped the lift and isolated the crane.`)
  await page.locator('#ticket-priority').selectOption('P1')
  await page.getByRole('button', { name: 'Record ticket' }).click()

  // The URL still reads /tickets/new until the action's redirect lands, and "new" fits the id
  // pattern — so wait for the rendered ticket, then read its id.
  await expect(page.getByRole('heading', { level: 1, name: /^TKT-/ })).toBeVisible()
  const ticketId = page.url().split('/').pop()!

  // A new ticket defaults the triage select to NEW, so TRIAGED has to be chosen explicitly.
  await page.locator('#triage-status').selectOption('TRIAGED')
  await page.locator('#triage-notes').fill('P1 breakdown. Raj to attend, crane already isolated.')
  await page.getByRole('button', { name: 'Save triage' }).click()
  await expect(page.getByText('Triage saved.')).toBeVisible()

  // --- office: turn the call into a job and move it to the board ---------------

  await page.locator('#job-type-0').selectOption(jobTypeId)
  await page.getByRole('button', { name: 'Create job' }).click()
  // The conversion replaces the form with the ticket's job list; a refusal would leave the form and
  // its error message in place, so this is also the assertion that the server accepted it.
  await expect(page.getByText('Converted to jobs')).toBeVisible()

  const job = await db.job.findFirstOrThrow({ where: { ticketId } })
  await page.getByRole('link', { name: job.number, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: job.number })).toBeVisible()

  await page.locator('#transition-status').selectOption('TRIAGED')
  await page.getByRole('button', { name: 'Move to triaged' }).click()
  await expect(page.getByText('Job moved.')).toBeVisible()

  // The visit first, then the technician: assignment only schedules the job when both dates are set.
  await page.locator('#reschedule-start').fill(VISIT_START)
  await page.locator('#reschedule-end').fill(VISIT_END)
  await page.getByRole('button', { name: 'Move the visit' }).click()
  await expect(page.getByText('Visit moved.')).toBeVisible()

  await page.locator('#assign-technician').selectOption(technicianId)
  await page.getByRole('button', { name: 'Assign' }).click()
  await expect(page.getByText('Technician assigned.')).toBeVisible()
  await expect
    .poll(() => db.job.findUniqueOrThrow({ where: { id: job.id } }).then((row) => row.status))
    .toBe('SCHEDULED')

  await page.getByRole('button', { name: 'Dispatch to the crew' }).click()
  await expect
    .poll(() => db.job.findUniqueOrThrow({ where: { id: job.id } }).then((row) => row.status))
    .toBe('DISPATCHED')

  // --- the phone: report written with no signal --------------------------------

  await signOut(page)
  await signIn(page, TECHNICIAN)
  await page.goto(`/m/jobs/${job.id}`)
  await page.getByRole('link', { name: 'Fill report' }).first().click()

  // The heaviest cold route in the suite: Next compiles it, then reads a job from another region.
  await expect(page.getByRole('heading', { name: tag })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'Submit report' })).toBeVisible()

  // Cut the radio after the page has loaded, so the form works from its Dexie draft alone.
  await context.setOffline(true)

  // Every field in a form section, whatever the template declares today.
  for (const section of sections) {
    if (section.layout !== 'fields') continue
    for (const field of section.fields) {
      const group = page.getByRole('group', { name: field.label, exact: true })
      if (field.type === 'RADIO' || field.type === 'YES_NO' || field.type === 'PASS_FAIL_NA') {
        const answer = field.type === 'RADIO' ? field.options![0]! : field.type === 'YES_NO' ? 'Yes' : 'Pass'
        await group.getByRole('button', { name: answer, exact: true }).click()
      } else if (field.type === 'NUMBER') {
        await page.locator(`#field-${field.key}`).fill('10')
      } else if (field.type === 'DATE') {
        await page.locator(`#field-${field.key}`).fill('2027-05-04')
      } else {
        await page
          .locator(`#field-${field.key}`)
          .fill('Brake linings replaced and tested. Crane returned to service.')
      }
    }
  }

  // Every checklist item must be answered; the server refuses a partial checklist.
  for (const item of checklist) {
    await page
      .getByRole('group', { name: item.label })
      .getByRole('button', { name: item.resultType === 'YES_NO' ? 'No' : 'Pass' })
      .click()
  }

  await page.locator('input[type="file"]').setInputFiles({
    name: 'brake.jpg',
    mimeType: 'image/png',
    buffer: PHOTO,
  })
  await expect(page.getByRole('img', { name: 'Photo 1' })).toBeVisible()

  // Both signatures, because the customer is on site and signed off the return to service.
  await sign(page, 'Technician signature')
  await page.getByLabel('Customer name').fill('E2E Site Supervisor')
  await page.getByLabel('Customer designation').fill('Site supervisor')
  await sign(page, 'Customer signature')

  await page.getByRole('button', { name: 'Submit report' }).click()
  await expect(
    page.getByText('Saved on this phone. It will upload when there is signal.'),
  ).toBeVisible()
  expect(await db.report.count({ where: { jobId: job.id } })).toBe(0)

  // --- the signal comes back ---------------------------------------------------

  await context.setOffline(false)
  await expect
    .poll(() => db.report.count({ where: { jobId: job.id } }), { timeout: 90_000 })
    .toBe(1)

  const report = await db.report.findFirstOrThrow({ where: { jobId: job.id } })
  expect(report.status).toBe('SUBMITTED')
  expect(report.technicianSignerName).toMatch(/Raj/i)
  expect(report.technicianSignatureFileId).toBeTruthy()
  expect(report.customerSignatureFileId).toBeTruthy()
  expect(report.customerDeclinedReason).toBeNull()
  expect(report.safeToOperate).toBe('YES')
  // The photo and the two signatures all landed on the server, not just in the local draft. They
  // hang off the job (that is how they were uploaded), not the report.
  const uploaded = await db.file.findMany({ where: { jobId: job.id }, select: { kind: true } })
  expect(uploaded.map((file) => file.kind).sort()).toEqual(['PHOTO', 'SIGNATURE', 'SIGNATURE'])

  // --- office: finish the job and issue the report -----------------------------

  await signOut(page)
  await signIn(page, DISPATCHER)
  await page.goto(`/jobs/${job.id}`)
  await page.locator('#transition-status').selectOption('IN_PROGRESS')
  await page.getByRole('button', { name: 'Move to in progress' }).click()
  await page.locator('#transition-status').selectOption('COMPLETED')
  await page.getByRole('button', { name: 'Move to completed' }).click()
  await expect
    .poll(() => db.job.findUniqueOrThrow({ where: { id: job.id } }).then((row) => row.status))
    .toBe('COMPLETED')

  await page.goto('/reports')
  await page.getByRole('link', { name: job.number }).click()
  await expect(page.getByRole('heading', { name: 'Submitted report' })).toBeVisible()

  await page.getByRole('button', { name: 'Approve and issue' }).click()
  await expect(page.getByRole('heading', { name: /^RPT-\d{4}-\d{4}$/ })).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByRole('link', { name: 'Download the issued PDF' })).toBeVisible()

  const issued = await db.report.findUniqueOrThrow({ where: { id: report.id } })
  expect(issued.status).toBe('APPROVED')
  expect(issued.documentNumber).toMatch(/^RPT-\d{4}-\d{4}$/)
  expect(issued.pdfFileId).toBeTruthy()
  expect(issued.approvedAt).not.toBeNull()
  // The customer's contact has an email, so the issued PDF went out in the same approval.
  expect(issued.emailedToCustomerAt).not.toBeNull()

  const pdf = await db.file.findUniqueOrThrow({ where: { id: issued.pdfFileId! } })
  expect(pdf.kind).toBe('REPORT_PDF')
  expect(pdf.sizeBytes).toBeGreaterThan(1000)

  // Approving a completed job moves it to REVIEWED, and that is the end of Phase 1's path.
  expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('REVIEWED')
})
