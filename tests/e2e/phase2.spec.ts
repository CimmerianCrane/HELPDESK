import { PrismaClient } from '@prisma/client'
import { expect, test, type Page } from './fixtures'

/**
 * The Phase 2 acceptance path (slice 21).
 *
 * One browser run through everything Phase 2 added, in the order a real job takes it:
 *
 *   a compliance rule is configured and adopted on a crane → the owner changes and the
 *   re-registration prompt is cleared → an examination certificate is uploaded and appears in the
 *   certificate book → a PM job is completed and rolls its schedule forward → the daily cron queues
 *   the reminder → the report's finding becomes a follow-up job with a quote the customer accepts →
 *   the reviewed job is invoiced, paid, and the two accounting files download.
 *
 * The first leg is the carry-over from `docs/PLAN.md` §7.5: a Playwright path for `/admin/compliance`.
 * It sits at the front because the rule is what the schedule below is based on — the acceptance path
 * starts with the office configuring a rule, not with seed rows.
 *
 * It builds its own customer, site, crane and rule and deletes everything in `afterAll`. Signed in as
 * the ADMIN because the compliance screen is admin-only; the per-role permission answers are proven
 * by the integration tests, not by making this path sign in three times.
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'cimmerian-dev-2026'
const ADMIN = 'admin@cimmeriancrane.example'

const db = new PrismaClient()
const suffix = Math.random().toString(36).slice(2, 10)
const RULE_REFERENCE = `E2E compliance ${suffix}`
const CERTIFICATE_NUMBER = `E2E-AE-${suffix}`
const ASSET_TAG = `E2E-P2-${suffix}`

const created = {
  customerId: '',
  siteId: '',
  craneId: '',
  ruleId: '',
  scheduleId: '',
  certificateId: '',
  jobId: '',
  reportId: '',
  followUpJobId: '',
}

/** yyyy-mm-dd, the form's date input format. */
const isoDay = (date: Date) => date.toISOString().slice(0, 10)
const daysFromNow = (days: number) => isoDay(new Date(Date.now() + days * 86_400_000))

test.beforeAll(async () => {
  // A crashed earlier run leaves an in-force rule for the same crane type behind, and the service
  // refuses an overlapping one — clear any before creating ours.
  await db.craneSchedule.deleteMany({ where: { rule: { sourceReference: { startsWith: 'E2E compliance ' } } } })
  await db.complianceRule.deleteMany({ where: { sourceReference: { startsWith: 'E2E compliance ' } } })

  const customer = await db.customer.create({
    data: {
      legalName: `E2E Phase 2 ${suffix}`,
      status: 'ACTIVE',
      contacts: {
        create: {
          name: 'E2E Contact',
          role: 'SITE_CONTACT',
          email: `e2e-${suffix}@example.test`,
          isPrimary: true,
        },
      },
    },
  })
  const site = await db.site.create({
    data: { customerId: customer.id, name: `E2E Phase 2 Site ${suffix}` },
  })
  const crane = await db.crane.create({
    data: {
      siteId: site.id,
      customerId: customer.id,
      assetTag: ASSET_TAG,
      qrValue: `QR-E2E-P2-${suffix}`,
      type: 'OVERHEAD',
      swlKg: 8000,
    },
  })

  created.customerId = customer.id
  created.siteId = site.id
  created.craneId = crane.id
})

test.afterAll(async () => {
  const jobIds = [created.jobId, created.followUpJobId].filter(Boolean)

  await db.notification.deleteMany({
    where: { OR: [{ link: `/cranes/${created.craneId}` }, { jobId: { in: jobIds } }] },
  })
  if (created.scheduleId) {
    await db.reminderDispatch.deleteMany({ where: { scheduleId: created.scheduleId } })
  }

  // Money and quotes are never deleted in the app either; a test that raised them clears them up.
  // An invoice reaches its job through its lines, so the ids are collected before the lines go.
  const invoiceIds = (
    await db.invoice.findMany({
      where: { lines: { some: { jobId: { in: jobIds } } } },
      select: { id: true },
    })
  ).map((row) => row.id)
  await db.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } })
  await db.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } })
  await db.invoice.deleteMany({ where: { id: { in: invoiceIds } } })
  await db.quoteLine.deleteMany({ where: { quote: { jobId: { in: jobIds } } } })
  await db.quote.deleteMany({ where: { jobId: { in: jobIds } } })

  if (created.reportId) {
    await db.finding.deleteMany({ where: { reportId: created.reportId } })
    await db.stockMovement.deleteMany({ where: { reportId: created.reportId } })
    await db.report.deleteMany({ where: { id: created.reportId } })
  }

  await db.file.deleteMany({
    where: {
      OR: [
        { jobId: { in: jobIds } },
        { entityId: { in: [created.reportId, created.certificateId].filter(Boolean) } },
      ],
    },
  })
  await db.auditLog.deleteMany({
    where: {
      entityId: {
        in: [
          ...jobIds,
          created.reportId,
          created.certificateId,
          created.ruleId,
          created.scheduleId,
          created.craneId,
          created.customerId,
        ].filter(Boolean),
      },
    },
  })
  await db.jobStatusHistory.deleteMany({ where: { jobId: { in: jobIds } } })
  await db.jobTechnician.deleteMany({ where: { jobId: { in: jobIds } } })
  await db.jobCrane.deleteMany({ where: { jobId: { in: jobIds } } })
  await db.job.deleteMany({ where: { id: { in: jobIds } } })

  await db.certificate.deleteMany({ where: { craneId: created.craneId } })
  await db.craneSchedule.deleteMany({ where: { craneId: created.craneId } })
  await db.crane.deleteMany({ where: { id: created.craneId } })
  await db.site.deleteMany({ where: { customerId: created.customerId } })
  await db.contact.deleteMany({ where: { customerId: created.customerId } })
  await db.customer.deleteMany({ where: { id: created.customerId } })
  await db.complianceRule.deleteMany({ where: { sourceReference: RULE_REFERENCE } })

  await db.$disconnect()
})

async function signIn(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(ADMIN)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

/** Move a job one step with the transition form, then reload so the next step sees the new state. */
async function moveJob(page: Page, jobId: string, status: string): Promise<void> {
  await page.locator('#transition-status').selectOption(status)
  await page.getByRole('button', { name: /^Move to/ }).click()
  await expect.poll(async () => (await db.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe(status)
  await page.reload()
}

test('a crane’s whole Phase 2 life, from a compliance rule to the accounting file', async ({ page }) => {
  test.setTimeout(540_000)

  // ---------------------------------------------------------------------------------------------
  // 1. A rule is configured on the compliance screen, then adopted on a crane
  // ---------------------------------------------------------------------------------------------
  await signIn(page)
  await page.goto('/admin/compliance')

  await page.locator('#new-rule-craneType').selectOption('OVERHEAD')
  await page.locator('#new-rule-scheduleType').selectOption('MONTHLY_SERVICE')
  await page.locator('#new-rule-intervalMonths').fill('1')
  await page.locator('#new-rule-sourceReference').fill(RULE_REFERENCE)
  await page.locator('#new-rule-reviewedAt').fill(daysFromNow(0))
  await page.getByRole('button', { name: 'Add rule' }).click()
  await expect(page.getByText('Rule added.')).toBeVisible()
  await expect(page.getByText(RULE_REFERENCE)).toBeVisible()

  const rule = await db.complianceRule.findFirstOrThrow({ where: { sourceReference: RULE_REFERENCE } })
  created.ruleId = rule.id

  await page.goto(`/cranes/${created.craneId}`)
  await page.getByText('Add a schedule', { exact: true }).click()
  await page.locator('#crane-schedule-ruleId').selectOption(rule.id)
  await page.locator('#crane-schedule-scheduleType').selectOption('MONTHLY_SERVICE')
  await page.locator('#crane-schedule-intervalMonths').fill('1')
  // Six weeks since the last service: the roll-forward and the reminder are both observable.
  await page.locator('#crane-schedule-lastDoneDate').fill(daysFromNow(-45))
  await page.getByRole('button', { name: 'Add schedule' }).click()
  await expect(page.getByText('Schedule added.')).toBeVisible()

  const schedule = await db.craneSchedule.findFirstOrThrow({ where: { craneId: created.craneId } })
  created.scheduleId = schedule.id
  expect(schedule.ruleId).toBe(rule.id)

  // ---------------------------------------------------------------------------------------------
  // 2. The owner changes, the re-registration prompt appears, and the office clears it
  // ---------------------------------------------------------------------------------------------
  await page.getByText('Edit this crane', { exact: true }).click()
  await page.locator('#edit-crane-ownerEntity').fill(`E2E Holdings ${suffix}`)
  await page.getByRole('button', { name: 'Save crane' }).click()

  const prompt = page.getByRole('heading', { name: 'Re-registration may be required' })
  await expect(prompt).toBeVisible()
  await page.getByRole('button', { name: 'Mark as checked' }).click()
  await expect(prompt).toHaveCount(0)

  const crane = await db.crane.findUniqueOrThrow({ where: { id: created.craneId } })
  expect(crane.ownerEntity).toBe(`E2E Holdings ${suffix}`)
  expect(crane.reregistrationRequiredAt).toBeNull()

  // ---------------------------------------------------------------------------------------------
  // 3. A certificate is uploaded and the certificate book shows it
  // ---------------------------------------------------------------------------------------------
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    'latin1',
  )

  await page.getByText('Add a certificate', { exact: true }).click()
  const certificateForm = page.locator('form:has(#crane-certificate-file)')
  await certificateForm.locator('#crane-certificate-type').selectOption('STATUTORY_TEST_EXAMINATION')
  await certificateForm.locator('#crane-certificate-certificateNumber').fill(CERTIFICATE_NUMBER)
  await certificateForm.locator('#crane-certificate-issuer').fill('E2E Authorised Examiner')
  await certificateForm.locator('#crane-certificate-issueDate').fill(daysFromNow(-30))
  await certificateForm.locator('#crane-certificate-expiryDate').fill(daysFromNow(335))
  await certificateForm.locator('#crane-certificate-nextDueDate').fill(daysFromNow(305))
  await certificateForm.locator('#crane-certificate-file').setInputFiles({
    name: `${CERTIFICATE_NUMBER}.pdf`,
    mimeType: 'application/pdf',
    buffer: pdf,
  })
  await expect(certificateForm.getByText(`On file: ${CERTIFICATE_NUMBER}.pdf`)).toBeVisible()
  await certificateForm.getByRole('button', { name: 'Add certificate' }).click()
  await expect(page.getByText('Certificate added.')).toBeVisible()

  const certificate = await db.certificate.findFirstOrThrow({
    where: { craneId: created.craneId, certificateNumber: CERTIFICATE_NUMBER },
  })
  created.certificateId = certificate.id
  expect(certificate.fileId).toBeTruthy()

  await page.goto(`/certificates?q=${CERTIFICATE_NUMBER}`)
  await expect(page.getByText(CERTIFICATE_NUMBER, { exact: true })).toBeVisible()
  await expect(page.getByText(ASSET_TAG)).toBeVisible()

  // ---------------------------------------------------------------------------------------------
  // 4. A PM job is raised and completed; completing it rolls the schedule forward
  // ---------------------------------------------------------------------------------------------
  const jobType = await db.jobType.findFirstOrThrow({
    where: { defaultReportTemplateId: { not: null } },
    select: { id: true, name: true, defaultReportTemplateId: true },
  })

  await page.goto('/jobs/new')
  await page.locator('#job-customer').selectOption(created.customerId)
  await page.locator('#job-site').selectOption(created.siteId)
  await page.locator('#job-type').selectOption(jobType.id)
  await page.locator('#job-description').fill(`E2E PM visit ${suffix}`)
  await page.getByRole('checkbox', { name: new RegExp(ASSET_TAG) }).check()
  await page.getByRole('button', { name: 'Create job' }).click()

  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}/)
  created.jobId = page.url().match(/\/jobs\/([0-9a-f-]{36})/)![1]!

  for (const status of ['TRIAGED', 'SCHEDULED', 'DISPATCHED', 'IN_PROGRESS']) {
    await moveJob(page, created.jobId, status)
  }

  await page.locator('#transition-status').selectOption('COMPLETED')
  const completedSchedule = page.locator(`input[name="scheduleIds"][value="${created.scheduleId}"]`)
  await completedSchedule.check()
  await expect(completedSchedule).toBeChecked()
  await page.locator('#transition-note').fill('PM visit completed on site')
  await page.getByRole('button', { name: /^Move to/ }).click()
  await expect.poll(async () => (await db.job.findUniqueOrThrow({ where: { id: created.jobId } })).status).toBe(
    'COMPLETED',
  )

  // Polled, not read once: a read issued right after the action commits can land on a connection
  // that has not seen it yet against the hosted database.
  await expect
    .poll(
      async () =>
        (await db.craneSchedule.findUniqueOrThrow({ where: { id: created.scheduleId } })).nextDueDate?.getTime() ??
        0,
    )
    .toBeGreaterThan(Date.now() + 20 * 86_400_000)
  const rolled = await db.craneSchedule.findUniqueOrThrow({ where: { id: created.scheduleId } })
  expect(rolled.lastDoneDate).not.toBeNull()

  // ---------------------------------------------------------------------------------------------
  // 5. The daily cron queues the reminder for the rolled-forward due date
  // ---------------------------------------------------------------------------------------------
  const cron = await page.request.get('/api/cron/daily', {
    headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
    timeout: 120_000,
  })
  expect(cron.status(), await cron.text()).toBe(200)

  const dispatch = await db.reminderDispatch.findFirst({ where: { scheduleId: created.scheduleId } })
  expect(dispatch).not.toBeNull()
  const notification = await db.notification.findFirst({
    where: { link: `/cranes/${created.craneId}` },
  })
  expect(notification?.title).toContain(ASSET_TAG)

  // ---------------------------------------------------------------------------------------------
  // 6. The report's finding is approved, then becomes a follow-up job
  // ---------------------------------------------------------------------------------------------
  const template = await db.reportTemplate.findUniqueOrThrow({
    where: { id: jobType.defaultReportTemplateId! },
    select: { id: true, version: true },
  })
  const report = await db.report.create({
    data: {
      jobId: created.jobId,
      craneId: created.craneId,
      templateId: template.id,
      templateVersion: template.version,
      data: { workDone: `E2E PM visit ${suffix}` },
      status: 'SUBMITTED',
      submittedAt: new Date(),
      technicianSignerName: 'E2E Technician',
      technicianSignedAt: new Date(),
      customerSignerName: 'E2E Contact',
      customerSignerDesignation: 'Supervisor',
      customerSignedAt: new Date(),
      safeToOperate: 'YES',
    },
  })
  created.reportId = report.id
  const finding = await db.finding.create({
    data: {
      reportId: report.id,
      craneId: created.craneId,
      component: 'Hoist brake',
      description: 'Brake pads worn past the limit',
      severity: 'MAJOR',
      recommendation: 'Replace the hoist brake pads',
    },
  })

  await page.goto(`/reports/${report.id}`)
  await page.getByRole('button', { name: 'Approve and issue' }).click()
  await expect(page.getByRole('heading', { name: /^RPT-\d{4}-\d{4}$/ })).toBeVisible({ timeout: 60_000 })
  // Approving the report is what makes the job REVIEWED, and only a reviewed job can be invoiced.
  await expect.poll(async () => (await db.job.findUniqueOrThrow({ where: { id: created.jobId } })).status).toBe(
    'REVIEWED',
  )

  await page.getByText('Raise a follow-up job', { exact: true }).click()
  await page.getByRole('button', { name: 'Raise the follow-up job' }).click()
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}/)

  // The finding holds the job it raised, so the id comes from the record rather than the address bar.
  const followUp = await db.finding.findUniqueOrThrow({ where: { id: finding.id } })
  expect(followUp.followUpJobId).toBeTruthy()
  created.followUpJobId = followUp.followUpJobId!

  // ---------------------------------------------------------------------------------------------
  // 7. The follow-up job is quoted, sent and accepted
  // ---------------------------------------------------------------------------------------------
  await moveJob(page, created.followUpJobId, 'TRIAGED')

  await page.getByText('Raise a quote', { exact: true }).click()
  await page.locator('input[name="description"]:visible').first().fill('Replace the hoist brake pads')
  await page.locator('input[name="quantity"]:visible').first().fill('1')
  await page.locator('input[name="unitPrice"]:visible').first().fill('480.00')
  await page.getByRole('button', { name: 'Raise the quote' }).click()

  const quoteLink = page.getByRole('link', { name: /^QTE-\d{4}-\d{4}$/ })
  await expect(quoteLink).toBeVisible()
  await quoteLink.click()
  await page.getByRole('button', { name: 'Send to the customer' }).click()
  await page.getByRole('button', { name: 'Accepted' }).click()
  await expect(page.getByText(/Accepted\. The job is approved/)).toBeVisible()
  await expect.poll(async () => (await db.job.findUniqueOrThrow({ where: { id: created.followUpJobId } })).status).toBe(
    'APPROVED',
  )

  // ---------------------------------------------------------------------------------------------
  // 8. The reviewed job is invoiced, issued and paid
  // ---------------------------------------------------------------------------------------------
  await page.goto(`/jobs/${created.jobId}`)
  await page.getByText('Raise an invoice', { exact: true }).click()
  // `:visible` because the job page keeps the quote form in the DOM inside its closed `<details>`.
  await page.locator('input[name="description"]:visible').first().fill('PM visit — hoist brake inspection')
  await page.locator('input[name="quantity"]:visible').first().fill('1')
  await page.locator('input[name="unitPrice"]:visible').first().fill('250.00')
  await page.getByRole('button', { name: 'Raise the invoice' }).click()

  const invoiceLink = page.getByRole('link', { name: /^INV-\d{4}-\d{4}$/ })
  await expect(invoiceLink).toBeVisible()
  await invoiceLink.click()
  await page.getByRole('button', { name: 'Issue the invoice' }).click()
  // The issuing form is replaced by the payment form once the invoice is issued, so the page is the
  // confirmation — the success message lived in the form that is now gone.
  await page.getByRole('button', { name: 'Record the payment' }).click()
  await expect(page.getByText('Paid in full. Nothing further is owed on this invoice.')).toBeVisible()

  const invoiceOfJob = { lines: { some: { jobId: created.jobId } } }
  await expect
    .poll(async () => (await db.invoice.findFirstOrThrow({ where: invoiceOfJob })).status)
    .toBe('PAID')
  const invoice = await db.invoice.findFirstOrThrow({ where: invoiceOfJob })

  // ---------------------------------------------------------------------------------------------
  // 9. The accounting export downloads the billed invoice and its payment
  // ---------------------------------------------------------------------------------------------
  await page.goto(`/invoices?q=${invoice.number}`)
  await expect(page.getByRole('link', { name: 'Export invoices CSV' })).toBeVisible()

  const invoicesFile = await page.request.get(`/invoices/export?q=${invoice.number}`)
  expect(invoicesFile.status()).toBe(200)
  expect(invoicesFile.headers()['content-disposition']).toContain('attachment')
  const invoiceCsv = (await invoicesFile.text()).replace('﻿', '')
  expect(invoiceCsv.split('\r\n')[0]).toMatch(/^Invoice number,Issue date,Due date/)
  expect(invoiceCsv).toContain(invoice.number)
  expect(invoiceCsv).toContain(Number(invoice.total).toFixed(2))

  const paymentsFile = await page.request.get(`/invoices/export?what=payments&q=${invoice.number}`)
  expect(paymentsFile.status()).toBe(200)
  const paymentCsv = (await paymentsFile.text()).replace('﻿', '')
  expect(paymentCsv).toContain(invoice.number)
  expect(paymentCsv).toContain('Bank transfer')
  expect(paymentCsv).toContain(Number(invoice.total).toFixed(2))
})
