import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, RuleError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  amendReport,
  approveReport,
  loadReport,
  renderStoredReport,
  returnReport,
  submitAmendment,
} from '@/server/reports/approval'
import { submitReport } from '@/server/reports/reports'
import { craneFixtures, inRolledBackTx, technicianFixture, testSuffix, type Tx } from './helpers'

/**
 * Approval, locking and the issued document (slice 9).
 *
 * The test PLAN §9 asks for is the last one here: render an approved report again after its template
 * has been superseded, and diff the two PDFs. It only means something if the first render is
 * reproducible, which is why the renderer pins `creationDate`.
 */

const TEMPLATE_V1 = {
  sections: [
    {
      key: 'visit',
      label: 'Visit',
      layout: 'fields',
      fields: [
        { key: 'workDone', label: 'Work done', type: 'TEXT', required: true },
        {
          key: 'safeToOperate',
          label: 'Safe to operate?',
          type: 'RADIO',
          options: ['Yes', 'No'],
          required: true,
        },
      ],
    },
  ],
}

/** The same template after the office added a field — a superseding version, not an edit. */
const TEMPLATE_V2 = {
  sections: [
    ...TEMPLATE_V1.sections,
    {
      key: 'recommendations',
      label: 'Recommendations',
      layout: 'fields',
      fields: [{ key: 'followUp', label: 'Follow up', type: 'TEXT' }],
    },
  ],
}

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

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `approval-${role.toLowerCase()}-${suffix}@example.test`,
      name: `Approval ${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

/** A job, a technician's report on it, and the office user who will decide. */
async function approvalSetup(tx: Tx) {
  const base = await craneFixtures(tx)
  const suffix = testSuffix()

  const techUser = await makeUser(tx, 'TECHNICIAN')
  const technician = await tx.technician.create({ data: { userId: techUser.id } })
  const dispatcher = await makeUser(tx, 'DISPATCHER')

  const template = await tx.reportTemplate.create({
    data: {
      code: `RPT-APPROVE-${suffix}`,
      name: 'Service report',
      version: 1,
      bodyHtml: '<p>template</p>',
      schema: TEMPLATE_V1,
    },
  })
  await tx.jobType.update({
    where: { id: base.jobType.id },
    data: { defaultReportTemplateId: template.id },
  })

  const job = await tx.job.create({
    data: {
      number: `JOB-APPROVE-${suffix}`,
      jobTypeId: base.jobType.id,
      customerId: base.customer.id,
      siteId: base.site.id,
      status: 'COMPLETED',
      priority: 'P2',
    },
  })
  await tx.jobTechnician.create({
    data: { jobId: job.id, technicianId: technician.id, isLead: true },
  })
  await tx.jobCrane.create({ data: { jobId: job.id, craneId: base.crane.id } })

  async function signature() {
    const id = crypto.randomUUID()
    await tx.file.create({
      data: {
        id,
        entity: 'Job',
        entityId: job.id,
        kind: 'SIGNATURE',
        filename: `${id}.png`,
        mimeType: 'image/png',
        sizeBytes: 512,
        storageKey: `jobs/${job.id}/${id}.png`,
        uploadedById: techUser.id,
        jobId: job.id,
      },
    })
    return id
  }

  const report = await submitReport(
    contextFor(techUser, technician.id),
    {
      reportId: crypto.randomUUID(),
      jobId: job.id,
      craneId: base.crane.id,
      templateId: template.id,
      templateVersion: 1,
      data: { workDone: 'Adjusted the brake', safeToOperate: 'Yes' },
      checklist: {},
      parts: [],
      photoFileIds: [],
      technicianSignerName: 'Ahmad',
      technicianSignatureFileId: await signature(),
      customerSignerName: 'Mei Ling',
      customerSignerDesignation: 'Supervisor',
      customerSignatureFileId: await signature(),
      customerDeclinedReason: null,
    },
    tx,
  )

  return {
    ...base,
    template,
    job,
    reportId: report.reportId,
    dispatcher: contextFor(dispatcher),
    technicianContext: contextFor(techUser, technician.id),
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('approving a report', () => {
  it('assigns a number, stores the PDF, locks the report and moves the job to REVIEWED', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await approvalSetup(tx)
      const result = await approveReport(setup.dispatcher, setup.reportId, {}, tx)

      expect(result.documentNumber).toMatch(/^RPT-\d{4}-\d{4}$/)

      const report = await tx.report.findUniqueOrThrow({ where: { id: setup.reportId } })
      expect(report.status).toBe('APPROVED')
      expect(report.documentNumber).toBe(result.documentNumber)
      expect(report.approvedAt).not.toBeNull()
      expect(report.pdfFileId).toBe(result.pdfFileId)

      const file = await tx.file.findUniqueOrThrow({ where: { id: result.pdfFileId } })
      expect(file.kind).toBe('REPORT_PDF')
      expect(file.filename).toBe(`${result.documentNumber}.pdf`)
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)

      const job = await tx.job.findUniqueOrThrow({ where: { id: setup.job.id } })
      expect(job.status).toBe('REVIEWED')
      expect(job.reviewedAt).not.toBeNull()

      const history = await tx.jobStatusHistory.findMany({ where: { jobId: setup.job.id } })
      expect(history.some((entry) => entry.toStatus === 'REVIEWED')).toBe(true)
    })
  })

  it('refuses to approve the same report twice', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await approvalSetup(tx)
      await approveReport(setup.dispatcher, setup.reportId, {}, tx)
      await expect(approveReport(setup.dispatcher, setup.reportId, {}, tx)).rejects.toBeInstanceOf(
        RuleError,
      )
    })
  })

  it('refuses a technician — the capability is the gate, not the screen', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await approvalSetup(tx)
      await expect(
        approveReport(setup.technicianContext, setup.reportId, {}, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('sends an unapproved report back with its reason and no number', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await approvalSetup(tx)
      await returnReport(setup.dispatcher, setup.reportId, { reason: 'The crane tag is wrong.' }, tx)

      const report = await tx.report.findUniqueOrThrow({ where: { id: setup.reportId } })
      expect(report.status).toBe('RETURNED')
      expect(report.returnReason).toBe('The crane tag is wrong.')
      expect(report.documentNumber).toBeNull()
    })
  })
})

describe('amending an issued report', () => {
  it('creates a linked copy, then issues it with its own number and supersedes the original', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await approvalSetup(tx)
      const original = await approveReport(setup.dispatcher, setup.reportId, {}, tx)

      const { amendmentId } = await amendReport(
        setup.dispatcher,
        { reportId: setup.reportId, reason: 'The customer name was misspelt.' },
        tx,
      )

      const draft = await tx.report.findUniqueOrThrow({ where: { id: amendmentId } })
      expect(draft.status).toBe('DRAFT')
      expect(draft.amendmentOfId).toBe(setup.reportId)
      expect(draft.amendmentReason).toBe('The customer name was misspelt.')
      // Copied, not referenced: the correction can be edited without touching the issued document.
      expect(draft.data).toEqual(
        (await tx.report.findUniqueOrThrow({ where: { id: setup.reportId } })).data,
      )

      await submitAmendment(setup.dispatcher, amendmentId, tx)
      const issued = await approveReport(setup.dispatcher, amendmentId, {}, tx)
      expect(issued.documentNumber).not.toBe(original.documentNumber)

      const before = await tx.report.findUniqueOrThrow({ where: { id: setup.reportId } })
      expect(before.status).toBe('AMENDED')
      // The issued document is untouched — same number, same stored PDF.
      expect(before.documentNumber).toBe(original.documentNumber)
      expect(before.pdfFileId).toBe(original.pdfFileId)
    })
  })

  it('refuses a second open amendment of the same report', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await approvalSetup(tx)
      await approveReport(setup.dispatcher, setup.reportId, {}, tx)
      await amendReport(
        setup.dispatcher,
        { reportId: setup.reportId, reason: 'First correction.' },
        tx,
      )

      await expect(
        amendReport(setup.dispatcher, { reportId: setup.reportId, reason: 'Second correction.' }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })
})

describe('an issued report re-renders as issued', () => {
  it('renders the same bytes after the template it was filled under has been superseded', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await approvalSetup(tx)
      const approval = await approveReport(setup.dispatcher, setup.reportId, {}, tx)
      const stored = await tx.file.findUniqueOrThrow({
        where: { id: approval.pdfFileId },
        select: { sha256: true, sizeBytes: true },
      })

      // The office adds a field. This is a new version, exactly as the admin editor will do it —
      // the old row is never edited (CLAUDE.md rule 5).
      await tx.reportTemplate.create({
        data: {
          code: setup.template.code,
          name: 'Service report',
          version: 2,
          bodyHtml: '<p>template v2</p>',
          schema: TEMPLATE_V2,
        },
      })
      // And the job type now points at it, so "the template as it stands today" is version 2.
      const v2 = await tx.reportTemplate.findFirstOrThrow({
        where: { code: setup.template.code, version: 2 },
      })
      await tx.jobType.update({
        where: { id: setup.jobType.id },
        data: { defaultReportTemplateId: v2.id },
      })

      const report = await tx.report.findUniqueOrThrow({ where: { id: setup.reportId } })
      const loaded = await loadReport(setup.dispatcher, tx, setup.reportId)
      if (!loaded) throw new Error('the issued report should still be readable')

      const rendered = await renderStoredReport(
        // The same loader approval used — re-rendering through a different query would prove
        // something about that query rather than about the document that was issued.
        loaded,
        {
          documentNumber: report.documentNumber!,
          issuedAt: report.approvedAt!,
          timeZone: 'Asia/Singapore',
          client: tx,
        },
      )

      expect(report.templateVersion).toBe(1)
      expect(sha256(rendered)).toBe(stored.sha256)
    })
  })
})

describe('service reports', () => {
  it('keeps the general RPT series on the per-crane report, even for a Service Report job type', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await approvalSetup(tx)
      await tx.jobType.update({
        where: { id: setup.jobType.id },
        data: { isServiceReport: true },
      })

      // SR2606001 belongs to the job-level Service Report (tests/integration/service-reports.test.ts).
      // The checklist form the technician signs in per crane is a report, not the issued document.
      const result = await approveReport(setup.dispatcher, setup.reportId, {}, tx)
      expect(result.documentNumber).toMatch(/^RPT-\d{4}-\d{4}$/)
    })
  })

  it('refuses a service report whose answered lines are not all graded', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await craneFixtures(tx)
      const { user: techUser, technician } = await technicianFixture(tx)
      const techContext = contextFor(techUser, technician.id)

      // A checklist is what a grade is attached to, so this type needs one.
      const checklist = await tx.checklistTemplate.create({
        data: {
          code: `CHK-GRADE-${base.suffix}`,
          name: 'Service checklist',
          version: 1,
          items: {
            create: {
              section: 'Hoist',
              code: 'BRAKE',
              label: 'Brake holds',
              resultType: 'PASS_FAIL_NA',
              sortOrder: 1,
            },
          },
        },
      })
      const template = await tx.reportTemplate.create({
        data: {
          code: `RPT-GRADE-${base.suffix}`,
          name: 'Service report',
          version: 1,
          bodyHtml: '<p>template</p>',
          schema: TEMPLATE_V1,
        },
      })
      await tx.jobType.update({
        where: { id: base.jobType.id },
        data: {
          isServiceReport: true,
          defaultChecklistTemplateId: checklist.id,
          defaultReportTemplateId: template.id,
        },
      })

      const job = await tx.job.create({
        data: {
          number: `JOB-GRADE-${base.suffix}`,
          jobTypeId: base.jobType.id,
          customerId: base.customer.id,
          siteId: base.site.id,
          status: 'COMPLETED',
          priority: 'P2',
          cranes: { create: { craneId: base.crane.id } },
          technicians: { create: { technicianId: technician.id } },
        },
      })

      const signatureId = crypto.randomUUID()
      await tx.file.create({
        data: {
          id: signatureId,
          entity: 'Job',
          entityId: job.id,
          kind: 'SIGNATURE',
          filename: `${signatureId}.png`,
          mimeType: 'image/png',
          sizeBytes: 512,
          storageKey: `jobs/${job.id}/${signatureId}.png`,
          uploadedById: techUser.id,
          jobId: job.id,
        },
      })

      const input = {
        reportId: crypto.randomUUID(),
        jobId: job.id,
        craneId: base.crane.id,
        templateId: template.id,
        templateVersion: 1,
        data: { workDone: 'Adjusted the brake', safeToOperate: 'Yes' },
        checklist: { BRAKE: { result: 'Pass' } },
        parts: [],
        photoFileIds: [],
        technicianSignerName: 'Ahmad',
        technicianSignatureFileId: signatureId,
        customerSignerName: 'Mei Ling',
        customerSignerDesignation: 'Supervisor',
        customerSignatureFileId: signatureId,
        customerDeclinedReason: null,
      }

      await expect(submitReport(techContext, input, tx)).rejects.toThrow(/ungraded/)

      // Graded, it goes through, and the grade is snapshotted with the line's wording.
      const submitted = await submitReport(
        techContext,
        { ...input, reportId: crypto.randomUUID(), grades: { BRAKE: { grade: 3, comment: 'Sound' } } },
        tx,
      )
      const report = await tx.report.findUniqueOrThrow({ where: { id: submitted.reportId } })
      const data = report.data as { grades: Record<string, { grade: number; label: string }> }
      expect(data.grades.BRAKE.grade).toBe(3)
      expect(data.grades.BRAKE.label).toBe('Brake holds')
    })
  })
})
