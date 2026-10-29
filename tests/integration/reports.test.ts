import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { NotFoundError, RuleError, ValidationError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { submitReport } from '@/server/reports/reports'
import { applyTechSync } from '@/server/tech/outbox'
import { craneFixtures, inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * Submit a report, against the real database (slice 8).
 *
 * Everything here runs in a transaction `withAudit` joins rather than opens, so a failing assertion
 * leaves no report, no finding and no stock movement behind. The things worth proving are the ones a
 * phone in a lift shaft depends on: the template is checked again on the server, a replay creates one
 * report rather than two, and the technician's own data wins without silently overwriting anything.
 */

const REPORT_TEMPLATE = {
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
    {
      key: 'findings',
      label: 'Findings',
      layout: 'table',
      fields: [
        { key: 'component', label: 'Component', type: 'TEXT', required: true },
        { key: 'description', label: 'What is wrong', type: 'TEXT', required: true },
        {
          key: 'severity',
          label: 'Severity',
          type: 'RADIO',
          options: ['Critical', 'Major', 'Minor', 'Observation'],
          required: true,
        },
      ],
    },
  ],
}

function contextFor(
  user: { id: string; name: string; email: string; role: Role },
  technicianId: string,
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

async function makeTechnician(tx: Tx) {
  const suffix = testSuffix()
  const user = await tx.user.create({
    data: {
      email: `tech-report-${suffix}@example.test`,
      name: `Report Tech ${suffix}`,
      role: 'TECHNICIAN',
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
  const technician = await tx.technician.create({ data: { userId: user.id } })
  return { user, technician, context: contextFor(user, technician.id) }
}

/** A job the technician is on, with a report template, a checklist and a crane attached. */
async function reportSetup(tx: Tx, technicianId: string) {
  const base = await craneFixtures(tx)
  const suffix = testSuffix()

  const checklistTemplate = await tx.checklistTemplate.create({
    data: { code: `CHK-RPT-${suffix}`, name: 'Service checklist', version: 1 },
  })
  await tx.checklistItem.create({
    data: {
      templateId: checklistTemplate.id,
      section: 'Hoist',
      code: 'BRAKE',
      label: 'Brake holds',
      resultType: 'PASS_FAIL_NA',
      sortOrder: 1,
    },
  })

  const reportTemplate = await tx.reportTemplate.create({
    data: {
      code: `RPT-${suffix}`,
      name: 'Service report',
      version: 1,
      bodyHtml: '<p>template</p>',
      schema: REPORT_TEMPLATE,
    },
  })

  await tx.jobType.update({
    where: { id: base.jobType.id },
    data: {
      defaultChecklistTemplateId: checklistTemplate.id,
      defaultReportTemplateId: reportTemplate.id,
    },
  })

  const job = await tx.job.create({
    data: {
      number: `JOB-RPT-${suffix}`,
      jobTypeId: base.jobType.id,
      customerId: base.customer.id,
      siteId: base.site.id,
      status: 'IN_PROGRESS',
      priority: 'P2',
    },
  })
  await tx.jobTechnician.create({
    data: { jobId: job.id, technicianId, isLead: true },
  })
  await tx.jobCrane.create({ data: { jobId: job.id, craneId: base.crane.id } })

  return { ...base, job, reportTemplate }
}

async function makeFile(
  tx: Tx,
  options: { jobId: string; userId: string; kind: 'PHOTO' | 'SIGNATURE' },
) {
  const id = crypto.randomUUID()
  await tx.file.create({
    data: {
      id,
      entity: 'Job',
      entityId: options.jobId,
      kind: options.kind,
      filename: `${id}.${options.kind === 'SIGNATURE' ? 'png' : 'jpg'}`,
      mimeType: options.kind === 'SIGNATURE' ? 'image/png' : 'image/jpeg',
      sizeBytes: 1024,
      storageKey: `jobs/${options.jobId}/${id}`,
      uploadedById: options.userId,
      jobId: options.jobId,
    },
  })
  return id
}

async function payloadFor(
  tx: Tx,
  setup: Awaited<ReturnType<typeof reportSetup>>,
  user: { id: string },
  overrides: Record<string, unknown> = {},
) {
  const photo = await makeFile(tx, { jobId: setup.job.id, userId: user.id, kind: 'PHOTO' })
  const techSignature = await makeFile(tx, {
    jobId: setup.job.id,
    userId: user.id,
    kind: 'SIGNATURE',
  })
  const customerSignature = await makeFile(tx, {
    jobId: setup.job.id,
    userId: user.id,
    kind: 'SIGNATURE',
  })

  return {
    reportId: crypto.randomUUID(),
    jobId: setup.job.id,
    craneId: setup.crane.id,
    templateId: setup.reportTemplate.id,
    templateVersion: 1,
    data: {
      workDone: 'Adjusted the brake',
      safeToOperate: 'Yes',
      findings: [
        {
          component: 'Hoist brake',
          description: 'Lining worn to 40%',
          severity: 'Major',
          recommendation: 'Replace at next service',
        },
      ],
    },
    checklist: { BRAKE: { result: 'Pass' } },
    parts: [],
    photoFileIds: [photo],
    technicianSignerName: 'Ahmad',
    technicianSignatureFileId: techSignature,
    customerSignerName: 'Mei Ling',
    customerSignerDesignation: 'Supervisor',
    customerSignatureFileId: customerSignature,
    customerDeclinedReason: null,
    ...overrides,
  }
}

describe('submitting a report', () => {
  it('writes the report, its findings, its stock movements and an audit entry for each', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await reportSetup(tx, (await makeTechnician(tx)).technician.id)
      const mine = await makeTechnician(tx)
      // Re-point the job at the technician whose payload we build, so the file rows belong to them.
      await tx.jobTechnician.deleteMany({ where: { jobId: setup.job.id } })
      await tx.jobTechnician.create({
        data: { jobId: setup.job.id, technicianId: mine.technician.id, isLead: true },
      })

      const part = await tx.part.create({
        data: {
          partNumber: `PART-${testSuffix()}`,
          description: 'Brake lining',
          uom: 'ea',
          cost: '45.00',
          sellPrice: '90.00',
        },
      })

      const payload = await payloadFor(tx, setup, mine.user, {
        parts: [{ partNumber: part.partNumber, quantity: 2, serialOrBatch: 'B-42' }],
      })
      const summary = await submitReport(mine.context, payload, tx)

      const report = await tx.report.findUniqueOrThrow({
        where: { id: summary.reportId },
        include: { findings: true, partsUsed: true },
      })
      expect(report.status).toBe('SUBMITTED')
      expect(report.safeToOperate).toBe('YES')
      expect(report.submittedAt).not.toBeNull()
      expect(report.findings).toHaveLength(1)
      expect(report.findings[0]?.severity).toBe('MAJOR')
      expect(report.partsUsed).toHaveLength(1)
      expect(report.partsUsed[0]?.type).toBe('ISSUE')
      expect(report.partsUsed[0]?.quantity.toNumber()).toBe(2)
      expect(report.partsUsed[0]?.serialOrBatch).toBe('B-42')
      // The issue now moves the on-hand level too, through the one stock writer (slice 22). No stock
      // was received first, so the shelf goes negative rather than the signed report being refused.
      expect(report.partsUsed[0]?.fromLocationId).not.toBeNull()
      const level = await tx.stockLevel.findFirst({
        where: { partId: part.id, locationId: report.partsUsed[0]!.fromLocationId! },
      })
      expect(Number(level?.quantity)).toBe(-2)

      const audits = await tx.auditLog.findMany({
        where: {
          entityId: {
            in: [report.id, report.findings[0]!.id, report.partsUsed[0]!.id],
          },
        },
      })
      expect(audits.map((entry) => entry.entity).sort()).toEqual([
        'Finding',
        'Report',
        'StockMovement',
      ])
    })
  })

  it('refuses an issue of a traced part with no serial, and takes one that has it', async () => {
    await inRolledBackTx(async (tx) => {
      const mine = await makeTechnician(tx)
      const setup = await reportSetup(tx, mine.technician.id)
      const part = await tx.part.create({
        data: {
          partNumber: `HOOK-${testSuffix()}`,
          description: 'Hook block',
          uom: 'pc',
          cost: '320.00',
          sellPrice: '610.00',
          trackSerialOrBatch: true,
        },
      })

      await expect(
        submitReport(
          mine.context,
          await payloadFor(tx, setup, mine.user, {
            parts: [{ partNumber: part.partNumber, quantity: 1, serialOrBatch: null }],
          }),
          tx,
        ),
      ).rejects.toBeInstanceOf(ValidationError)

      // The same report with the serial recorded is accepted — the refusal is the missing field,
      // not the part.
      await expect(
        submitReport(
          mine.context,
          await payloadFor(tx, setup, mine.user, {
            parts: [{ partNumber: part.partNumber, quantity: 1, serialOrBatch: 'SN-9001' }],
          }),
          tx,
        ),
      ).resolves.toMatchObject({ status: 'SUBMITTED' })
    })
  })

  it('refuses a template version the phone did not render', async () => {
    await inRolledBackTx(async (tx) => {
      const mine = await makeTechnician(tx)
      const setup = await reportSetup(tx, mine.technician.id)
      const payload = await payloadFor(tx, setup, mine.user, { templateVersion: 2 })

      await expect(submitReport(mine.context, payload, tx)).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it('refuses an answer the template does not declare', async () => {
    await inRolledBackTx(async (tx) => {
      const mine = await makeTechnician(tx)
      const setup = await reportSetup(tx, mine.technician.id)
      const payload = await payloadFor(tx, setup, mine.user, {
        data: { workDone: '', safeToOperate: 'Yes' },
      })

      await expect(submitReport(mine.context, payload, tx)).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it("treats somebody else's job as not found", async () => {
    await inRolledBackTx(async (tx) => {
      const theirs = await makeTechnician(tx)
      const setup = await reportSetup(tx, theirs.technician.id)
      const mine = await makeTechnician(tx)
      const payload = await payloadFor(tx, setup, theirs.user)

      await expect(submitReport(mine.context, payload, tx)).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  it('refuses a photo uploaded by somebody else', async () => {
    await inRolledBackTx(async (tx) => {
      const mine = await makeTechnician(tx)
      const setup = await reportSetup(tx, mine.technician.id)
      const other = await makeTechnician(tx)
      const payload = await payloadFor(tx, setup, mine.user)
      const someoneElses = await makeFile(tx, {
        jobId: setup.job.id,
        userId: other.user.id,
        kind: 'PHOTO',
      })

      await expect(
        submitReport(mine.context, { ...payload, photoFileIds: [someoneElses] }, tx),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it('logs a conflict and keeps the technician’s report when one already exists', async () => {
    await inRolledBackTx(async (tx) => {
      const mine = await makeTechnician(tx)
      const setup = await reportSetup(tx, mine.technician.id)

      const existing = await tx.report.create({
        data: {
          jobId: setup.job.id,
          craneId: setup.crane.id,
          templateId: setup.reportTemplate.id,
          templateVersion: 1,
          data: {},
          status: 'DRAFT',
        },
      })

      const payload = await payloadFor(tx, setup, mine.user)
      const summary = await submitReport(mine.context, payload, tx)

      const conflicts = await tx.conflictLog.findMany({
        where: { entity: 'Report', entityId: summary.reportId },
      })
      expect(conflicts).toHaveLength(1)
      expect((conflicts[0]?.detail as { otherReportId?: string }).otherReportId).toBe(existing.id)

      const reports = await tx.report.findMany({ where: { jobId: setup.job.id } })
      expect(reports).toHaveLength(2)
      expect(reports.find((report) => report.id === existing.id)?.status).toBe('DRAFT')
    })
  })
})

describe('replaying the outbox', () => {
  it('applies the same queued report twice as one report', async () => {
    await inRolledBackTx(async (tx) => {
      const mine = await makeTechnician(tx)
      const setup = await reportSetup(tx, mine.technician.id)
      const payload = await payloadFor(tx, setup, mine.user)
      const item = { id: crypto.randomUUID(), kind: 'report.submit' as const, payload }

      const first = await applyTechSync(mine.context, [item], tx)
      const second = await applyTechSync(mine.context, [item], tx)

      expect(first[0]?.ok).toBe(true)
      expect(second[0]?.ok).toBe(true)
      expect(second[0]?.result?.reportId).toBe(first[0]?.result?.reportId)

      const reports = await tx.report.findMany({ where: { jobId: setup.job.id } })
      expect(reports).toHaveLength(1)
      const receipts = await tx.syncReceipt.findMany({ where: { id: item.id } })
      expect(receipts).toHaveLength(1)
    })
  })

  it('reports one bad item without stopping the next', async () => {
    await inRolledBackTx(async (tx) => {
      const mine = await makeTechnician(tx)
      const setup = await reportSetup(tx, mine.technician.id)
      const good = await payloadFor(tx, setup, mine.user)
      const bad = await payloadFor(tx, setup, mine.user, { craneId: 'not-a-crane' })

      const results = await applyTechSync(
        mine.context,
        [
          { id: crypto.randomUUID(), kind: 'report.submit', payload: bad },
          { id: crypto.randomUUID(), kind: 'report.submit', payload: good },
        ],
        tx,
      )

      expect(results.map((result) => result.ok)).toEqual([false, true])
      expect(results[0]?.error).toBeTruthy()
    })
  })
})

describe('a job type with no template', () => {
  it('says so plainly instead of storing an unshapeable report', async () => {
    await inRolledBackTx(async (tx) => {
      const mine = await makeTechnician(tx)
      const setup = await reportSetup(tx, mine.technician.id)
      await tx.jobType.update({
        where: { id: setup.jobType.id },
        data: { defaultReportTemplateId: null },
      })
      const payload = await payloadFor(tx, setup, mine.user)

      await expect(submitReport(mine.context, payload, tx)).rejects.toBeInstanceOf(RuleError)
    })
  })
})
