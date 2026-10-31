import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, RuleError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  approveServiceReport,
  serviceReportForJob,
  serviceReportPdfUrl,
} from '@/server/service-reports/service-reports'
import {
  craneFixtures,
  inRolledBackTx,
  testSuffix,
  type Tx,
} from './helpers'

/**
 * The Service Report a visit issues (slice 39).
 *
 * The per-crane checklist form is a `Report` and is covered by `report-approval.test.ts`. This is the
 * other half: the prose document the office words and issues, one per job, taking the SR number.
 */

function contextFor(
  user: { id: string; name: string; email: string; role: Role },
  technicianId: string | null = null,
): AuthContext {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    technicianId,
    customerId: null,
    ip: '203.0.113.9',
    userAgent: 'vitest',
  }
}

async function dispatcher(tx: Tx) {
  const suffix = testSuffix()
  return contextFor(
    await tx.user.create({
      data: {
        email: `sr-dispatcher-${suffix}@example.test`,
        name: `SR Dispatcher ${suffix}`,
        role: 'DISPATCHER',
        passwordHash: 'placeholder-not-a-real-hash',
      },
    }),
  )
}

/** A Service Report job with two cranes, each with one submitted, graded checklist. */
async function serviceJobSetup(tx: Tx) {
  const base = await craneFixtures(tx)
  const second = await tx.crane.create({
    data: {
      siteId: base.site.id,
      customerId: base.customer.id,
      assetTag: `TAG-B-${base.suffix}`,
      qrValue: `QR-B-${base.suffix}`,
      type: 'MOBILE',
      swlKg: 25_000,
    },
  })

  await tx.jobType.update({
    where: { id: base.jobType.id },
    data: { isServiceReport: true },
  })

  const job = await tx.job.create({
    data: {
      number: `JOB-SR-${base.suffix}`,
      jobTypeId: base.jobType.id,
      customerId: base.customer.id,
      siteId: base.site.id,
      status: 'COMPLETED',
      priority: 'P2',
      cranes: { create: [{ craneId: base.crane.id }, { craneId: second.id }] },
    },
  })

  const template = await tx.reportTemplate.create({
    data: {
      code: `RPT-SR-${base.suffix}`,
      name: 'Servicing checklist',
      version: 1,
      bodyHtml: '<p>checklist</p>',
      schema: { sections: [] },
    },
  })

  const graded = async (craneId: string, grade: number, comment: string) =>
    tx.report.create({
      data: {
        jobId: job.id,
        craneId,
        templateId: template.id,
        templateVersion: 1,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        data: {
          grades: {
            BRAKE: { grade, comment, label: 'Hoist brake' },
          },
        },
      },
    })

  await graded(base.crane.id, 2, 'Lining at 1.8 mm, replace next visit.')
  await graded(second.id, 1, 'Replaced on site.')

  return { ...base, second, job, user: await dispatcher(tx) }
}

describe('the Service Report for a visit', () => {
  it('builds a draft from the graded checklists, worst crane first by its worst part', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await serviceJobSetup(tx)
      const view = await serviceReportForJob(setup.user, setup.job.id, tx)

      expect(view?.status).toBe('DRAFT')
      expect(view?.documentNumber).toBeNull()
      expect(view?.cranes).toHaveLength(2)
      expect(view?.missingCranes).toEqual([])
      expect(view?.cranes[0]!.paragraphs[0]!.text).toBe(
        'Hoist brake: Grade 1 of 5 — Failed. Replaced on site.',
      )
    })
  })

  it('issues SR<yy><mm><nnn>, stores the PDF, and then refuses to edit it', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await serviceJobSetup(tx)
      const issued = await approveServiceReport(setup.user, setup.job.id, tx)

      expect(issued.documentNumber).toMatch(/^SR\d{2}\d{2}\d{3,}$/)

      const row = await tx.serviceReport.findUniqueOrThrow({ where: { jobId: setup.job.id } })
      expect(row.status).toBe('APPROVED')
      expect(row.documentNumber).toBe(issued.documentNumber)

      const file = await tx.file.findUniqueOrThrow({ where: { id: issued.pdfFileId } })
      expect(file.kind).toBe('REPORT_PDF')
      expect(file.filename).toBe(`${issued.documentNumber}.pdf`)
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)

      await expect(approveServiceReport(setup.user, setup.job.id, tx)).rejects.toBeInstanceOf(
        RuleError,
      )
    })
  })

  it('numbers two visits in the same month consecutively', async () => {
    await inRolledBackTx(async (tx) => {
      const first = await serviceJobSetup(tx)
      const second = await serviceJobSetup(tx)

      const a = await approveServiceReport(first.user, first.job.id, tx)
      const b = await approveServiceReport(second.user, second.job.id, tx)
      expect(Number(b.documentNumber.slice(-3)) - Number(a.documentNumber.slice(-3))).toBe(1)
    })
  })

  it('refuses to issue while a crane has no graded checklist', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await serviceJobSetup(tx)
      await tx.report.deleteMany({ where: { jobId: setup.job.id, craneId: setup.second.id } })

      await expect(
        approveServiceReport(setup.user, setup.job.id, tx),
      ).rejects.toThrow(/Grade the checklist/)

      const view = await serviceReportForJob(setup.user, setup.job.id, tx)
      expect(view?.missingCranes.map((crane) => crane.assetTag)).toEqual([setup.second.assetTag])
    })
  })

  it('refuses a role without report.approve, server-side', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await serviceJobSetup(tx)
      const suffix = testSuffix()
      const technician = contextFor(
        await tx.user.create({
          data: {
            email: `sr-tech-${suffix}@example.test`,
            name: `SR Tech ${suffix}`,
            role: 'TECHNICIAN',
            passwordHash: 'placeholder-not-a-real-hash',
          },
        }),
        'tech-1',
      )

      await expect(
        approveServiceReport(technician, setup.job.id, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
      await expect(serviceReportForJob(technician, setup.job.id, tx)).rejects.toBeInstanceOf(
        ForbiddenError,
      )
    })
  })

  it('has nothing to download until the document is issued', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await serviceJobSetup(tx)
      expect(await serviceReportPdfUrl(setup.user, setup.job.id)).toBeNull()
    })
  })

  it('returns null for a job type that does not issue one', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await serviceJobSetup(tx)
      await tx.jobType.update({
        where: { id: setup.jobType.id },
        data: { isServiceReport: false },
      })
      expect(await serviceReportForJob(setup.user, setup.job.id, tx)).toBeNull()
    })
  })
})
