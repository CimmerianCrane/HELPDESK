import { PrismaClient } from '@prisma/client'
import { expect, test, type Page } from '@playwright/test'

/**
 * Approving a report in the office (slice 9).
 *
 * The slice's own end-to-end path: a submitted report appears in the queue, approving it assigns a
 * document number, stores a PDF and shows up on the crane's timeline.
 *
 * It builds its own customer, crane, job and report rather than touching a seeded one, because
 * `report.spec.ts` deletes and recreates the report on Ahmad's breakdown job and the two would fight
 * over it. Everything it creates is deleted again in `afterAll`.
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'cimmerian-dev-2026'
const DISPATCHER = 'dispatch@cimmeriancrane.example'

const db = new PrismaClient()
const suffix = Math.random().toString(36).slice(2, 10)
const created = { customerId: '', jobId: '', reportId: '', fileIds: [] as string[] }

test.beforeAll(async () => {
  const jobType = await db.jobType.findFirstOrThrow({
    where: { defaultReportTemplateId: { not: null } },
    select: { id: true, defaultReportTemplateId: true },
  })
  const template = await db.reportTemplate.findUniqueOrThrow({
    where: { id: jobType.defaultReportTemplateId! },
    select: { id: true, version: true },
  })

  const customer = await db.customer.create({
    data: {
      legalName: `E2E Approval ${suffix}`,
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
    data: { customerId: customer.id, name: `E2E Site ${suffix}` },
  })
  const crane = await db.crane.create({
    data: {
      siteId: site.id,
      customerId: customer.id,
      assetTag: `E2E-${suffix}`,
      qrValue: `QR-E2E-${suffix}`,
      type: 'OVERHEAD',
      swlKg: 8000,
    },
  })

  const job = await db.job.create({
    data: {
      number: `JOB-E2E-${suffix}`,
      jobTypeId: jobType.id,
      customerId: customer.id,
      siteId: site.id,
      status: 'COMPLETED',
      priority: 'P3',
      cranes: { create: { craneId: crane.id } },
    },
  })

  const report = await db.report.create({
    data: {
      jobId: job.id,
      craneId: crane.id,
      templateId: template.id,
      templateVersion: template.version,
      data: { workDone: `E2E work ${suffix}` },
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

  created.customerId = customer.id
  created.jobId = job.id
  created.reportId = report.id
})

test.afterAll(async () => {
  // Reports are never deleted in the app; a test that created one has to clear up after itself.
  if (created.reportId) {
    await db.finding.deleteMany({ where: { reportId: created.reportId } })
    await db.stockMovement.deleteMany({ where: { reportId: created.reportId } })
    await db.report.deleteMany({ where: { id: created.reportId } })
  }
  if (created.jobId) {
    await db.auditLog.deleteMany({
      where: { entityId: { in: [created.reportId, created.jobId, ...created.fileIds] } },
    })
    await db.jobStatusHistory.deleteMany({ where: { jobId: created.jobId } })
    await db.jobCrane.deleteMany({ where: { jobId: created.jobId } })
    await db.file.deleteMany({ where: { jobId: created.jobId } })
    await db.job.deleteMany({ where: { id: created.jobId } })
  }
  if (created.customerId) {
    await db.crane.deleteMany({ where: { customerId: created.customerId } })
    await db.site.deleteMany({ where: { customerId: created.customerId } })
    await db.contact.deleteMany({ where: { customerId: created.customerId } })
    await db.customer.deleteMany({ where: { id: created.customerId } })
  }
  await db.$disconnect()
})

async function signIn(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(DISPATCHER)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

test('a submitted report is approved, numbered and shown on the crane timeline', async ({ page }) => {
  test.setTimeout(180_000)

  await signIn(page)
  await page.goto('/reports')

  await page.getByRole('link', { name: `JOB-E2E-${suffix}` }).click()
  await expect(page.getByRole('heading', { name: 'Submitted report' })).toBeVisible()

  await page.getByRole('button', { name: 'Approve and issue' }).click()

  // The success is the page, not a toast: approving revalidates, the report is no longer SUBMITTED,
  // so the form that held the message is gone by the time the action returns.
  await expect(page.getByRole('heading', { name: /^RPT-\d{4}-\d{4}$/ })).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByRole('link', { name: 'Download the issued PDF' })).toBeVisible()

  const report = await db.report.findUniqueOrThrow({ where: { id: created.reportId } })
  expect(report.status).toBe('APPROVED')
  expect(report.documentNumber).toMatch(/^RPT-\d{4}-\d{4}$/)
  expect(report.pdfFileId).toBeTruthy()
  expect(report.approvedAt).not.toBeNull()

  const pdf = await db.file.findUniqueOrThrow({ where: { id: report.pdfFileId! } })
  expect(pdf.kind).toBe('REPORT_PDF')
  expect(pdf.sizeBytes).toBeGreaterThan(1000)
  created.fileIds.push(pdf.id)

  // The job moved on by itself, and the customer was recorded as emailed (the console adapter
  // succeeds in development, so `emailedToCustomerAt` is set rather than waiting for the cron).
  const job = await db.job.findUniqueOrThrow({ where: { id: created.jobId } })
  expect(job.status).toBe('REVIEWED')

  // And the crane's timeline is no longer a placeholder.
  const crane = await db.crane.findFirstOrThrow({ where: { customerId: created.customerId } })
  await page.goto(`/cranes/${crane.id}`)
  await expect(page.getByText(report.documentNumber!)).toBeVisible()
  await expect(page.getByText(/appear here once the report/)).toHaveCount(0)
})
