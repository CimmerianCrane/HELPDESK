import { describe, expect, it } from 'vitest'
import type { CraneType, Role } from '@prisma/client'
import type { AuthContext } from '@/server/auth/types'
import { submitReport } from '@/server/reports/reports'
import { dispatchPack } from '@/server/schedule/dispatch'
import { checklistForJob } from '@/server/templates/checklist'
import { technicianJob } from '@/server/tech/my-jobs'
import { craneFixtures, inRolledBackTx, technicianFixture, testSuffix, type Tx } from './helpers'

/**
 * Which checklist a visit gets (slice 46).
 *
 * A PM visit to an overhead crane needs the Crane and Monorail sheet; a PM visit to a mobile crane
 * still gets the job type's generic list. The resolver, the phone bundle, the submitted report and
 * the dispatch pack all have to agree on that, so each is checked against the same rows.
 */

const CRANE_LINE = { section: 'Hoist', code: 'CM_HOIST_BRAKE_LINING', label: 'Hoist brake lining' }
const FALLBACK_LINE = { section: 'Visit', code: 'D-1', label: 'Default line' }

const TEMPLATE = {
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
    ip: '203.0.113.9',
    userAgent: 'vitest',
  }
}

async function lineTemplate(
  tx: Tx,
  options: {
    code: string
    name: string
    line: { section: string; code: string; label: string }
    jobTypeId?: string
    craneTypes?: CraneType[]
    version?: number
  },
) {
  return tx.checklistTemplate.create({
    data: {
      code: options.code,
      name: options.name,
      jobTypeId: options.jobTypeId,
      craneTypes: options.craneTypes ?? [],
      version: options.version ?? 1,
      items: {
        create: {
          ...options.line,
          resultType: 'PASS_FAIL_NA',
          sortOrder: 1,
        },
      },
    },
  })
}

/** A PM-style job type whose generic list is the fallback, plus a sheet for overhead cranes. */
async function sheetFixtures(tx: Tx) {
  const base = await craneFixtures(tx)
  const fallback = await lineTemplate(tx, {
    code: `CHK-DEFAULT-${base.suffix}`,
    name: 'Generic service',
    line: FALLBACK_LINE,
  })
  const craneSheet = await lineTemplate(tx, {
    code: `CHK-CM-${base.suffix}`,
    name: 'Crane and monorail',
    line: CRANE_LINE,
    jobTypeId: base.jobType.id,
    craneTypes: ['OVERHEAD', 'GANTRY', 'JIB'],
  })
  await tx.jobType.update({
    where: { id: base.jobType.id },
    data: { defaultChecklistTemplateId: fallback.id },
  })
  return { ...base, fallback, craneSheet, defaultChecklistTemplateId: fallback.id }
}

async function addCrane(tx: Tx, base: { site: { id: string }; customer: { id: string }; suffix: string }, type: CraneType) {
  return tx.crane.create({
    data: {
      siteId: base.site.id,
      customerId: base.customer.id,
      assetTag: `TAG-${type}-${base.suffix}`,
      qrValue: `QR-${type}-${base.suffix}`,
      type,
      swlKg: 5000,
    },
  })
}

describe('the checklist resolver', () => {
  it('gives a covered crane type its own sheet and leaves the rest on the job type default', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await sheetFixtures(tx)

      const sheets = await checklistForJob(
        tx,
        { id: base.jobType.id, defaultChecklistTemplateId: base.defaultChecklistTemplateId },
        ['OVERHEAD', 'MOBILE'],
      )

      expect(sheets.fallback.map((item) => item.code)).toEqual([FALLBACK_LINE.code])
      expect(sheets.byType.get('OVERHEAD')?.map((item) => item.code)).toEqual([CRANE_LINE.code])
      expect(sheets.byType.has('MOBILE')).toBe(false)
    })
  })

  it('takes the newest version when two sheets cover the same crane type', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await sheetFixtures(tx)
      await lineTemplate(tx, {
        code: `CHK-CM-${base.suffix}`,
        name: 'Crane and monorail',
        line: { ...CRANE_LINE, code: 'CM_V2' },
        jobTypeId: base.jobType.id,
        craneTypes: ['OVERHEAD'],
        version: 2,
      })

      const sheets = await checklistForJob(tx, base.jobType, ['OVERHEAD'])
      expect(sheets.byType.get('OVERHEAD')?.map((item) => item.code)).toEqual(['CM_V2'])
    })
  })

  it('does not leak a sheet in from another job type or one with no job type at all', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await sheetFixtures(tx)
      const otherJobType = await tx.jobType.create({
        data: { code: `OTHER-${base.suffix}`, name: 'Other job type' },
      })
      await lineTemplate(tx, {
        code: `CHK-OTHER-${base.suffix}`,
        name: 'Another type’s sheet',
        line: { ...CRANE_LINE, code: 'OTHER-1' },
        jobTypeId: otherJobType.id,
        craneTypes: ['OVERHEAD'],
      })
      await lineTemplate(tx, {
        code: `CHK-ORPHAN-${base.suffix}`,
        name: 'No job type',
        line: { ...CRANE_LINE, code: 'ORPHAN-1' },
        craneTypes: ['OVERHEAD'],
      })

      const sheets = await checklistForJob(tx, base.jobType, ['OVERHEAD'])
      expect(sheets.byType.get('OVERHEAD')?.map((item) => item.code)).toEqual([CRANE_LINE.code])
    })
  })
})

describe('the sheet on the phone', () => {
  it('keys a sheet per crane and keeps the job type list as the fallback', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await sheetFixtures(tx)
      const mobile = await addCrane(tx, base, 'MOBILE')
      const { user, technician } = await technicianFixture(tx)

      const job = await tx.job.create({
        data: {
          number: `JOB-SHEET-${testSuffix()}`,
          jobTypeId: base.jobType.id,
          customerId: base.customer.id,
          siteId: base.site.id,
          status: 'SCHEDULED',
          priority: 'P2',
          cranes: { create: [{ craneId: base.crane.id }, { craneId: mobile.id }] },
          technicians: { create: { technicianId: technician.id } },
        },
      })

      const detail = await technicianJob(contextFor(user, technician.id), job.id, tx)

      expect(detail.checklist.map((item) => item.code)).toEqual([FALLBACK_LINE.code])
      expect(detail.checklistByCraneId?.[base.crane.id]?.map((item) => item.code)).toEqual([
        CRANE_LINE.code,
      ])
      expect(detail.checklistByCraneId?.[mobile.id]?.map((item) => item.code)).toEqual([
        FALLBACK_LINE.code,
      ])
    })
  })
})

describe('the dispatch pack', () => {
  it('previews the union of the cranes’ sheets without repeating a shared line', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await sheetFixtures(tx)
      const gantry = await addCrane(tx, base, 'GANTRY')
      const mobile = await addCrane(tx, base, 'MOBILE')
      const dispatcher = await tx.user.create({
        data: {
          email: `dispatch-${testSuffix()}@example.test`,
          name: 'Dispatcher',
          role: 'DISPATCHER',
          passwordHash: 'placeholder-not-a-real-hash',
        },
      })

      const job = await tx.job.create({
        data: {
          number: `JOB-PACK-${testSuffix()}`,
          jobTypeId: base.jobType.id,
          customerId: base.customer.id,
          siteId: base.site.id,
          status: 'SCHEDULED',
          priority: 'P2',
          cranes: {
            create: [{ craneId: base.crane.id }, { craneId: gantry.id }, { craneId: mobile.id }],
          },
        },
      })

      const pack = await dispatchPack(contextFor(dispatcher), job.id, tx)
      expect(pack.checklist.map((item) => item.code).sort()).toEqual(
        [CRANE_LINE.code, FALLBACK_LINE.code].sort(),
      )
    })
  })
})

describe('submitting a report against the resolved sheet', () => {
  async function reportSetup(tx: Tx) {
    const base = await sheetFixtures(tx)
    const { user, technician } = await technicianFixture(tx)
    const suffix = testSuffix()

    const reportTemplate = await tx.reportTemplate.create({
      data: {
        code: `RPT-CM-${suffix}`,
        name: 'Service report',
        version: 1,
        bodyHtml: '<p>template</p>',
        schema: TEMPLATE,
      },
    })
    await tx.jobType.update({
      where: { id: base.jobType.id },
      data: { isServiceReport: true, defaultReportTemplateId: reportTemplate.id },
    })

    const job = await tx.job.create({
      data: {
        number: `JOB-REPORT-${suffix}`,
        jobTypeId: base.jobType.id,
        customerId: base.customer.id,
        siteId: base.site.id,
        status: 'IN_PROGRESS',
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
        uploadedById: user.id,
        jobId: job.id,
      },
    })

    const input = (overrides: Record<string, unknown>) => ({
      reportId: crypto.randomUUID(),
      jobId: job.id,
      craneId: base.crane.id,
      templateId: reportTemplate.id,
      templateVersion: 1,
      data: { workDone: 'Inspected the hoist', safeToOperate: 'Yes' },
      checklist: {},
      parts: [],
      photoFileIds: [],
      technicianSignerName: 'Ahmad',
      technicianSignatureFileId: signatureId,
      customerSignerName: null,
      customerSignerDesignation: null,
      customerSignatureFileId: null,
      customerDeclinedReason: 'Site contact unavailable.',
      ...overrides,
    })

    return { ...base, context: contextFor(user, technician.id), job, input }
  }

  it('accepts the crane sheet’s line and snapshots its wording with the grade', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await reportSetup(tx)
      const submitted = await submitReport(
        setup.context,
        setup.input({
          checklist: { [CRANE_LINE.code]: { result: 'Pass' } },
          grades: { [CRANE_LINE.code]: { grade: 2, comment: 'Lining low.' } },
        }),
        tx,
      )

      const report = await tx.report.findUniqueOrThrow({ where: { id: submitted.reportId } })
      const data = report.data as {
        checklist: Record<string, unknown>
        grades: Record<string, { grade: number; comment: string | null; label: string | null }>
      }
      expect(Object.keys(data.checklist)).toEqual([CRANE_LINE.code])
      expect(data.grades[CRANE_LINE.code]).toEqual({
        grade: 2,
        comment: 'Lining low.',
        label: CRANE_LINE.label,
      })
    })
  })

  it('refuses a line the chosen sheet does not contain, rather than storing it empty', async () => {
    await inRolledBackTx(async (tx) => {
      const setup = await reportSetup(tx)

      await expect(
        submitReport(
          setup.context,
          setup.input({ checklist: { [FALLBACK_LINE.code]: { result: 'Pass' } } }),
          tx,
        ),
      ).rejects.toMatchObject({
        fields: {
          checklist: ['The checklist for this crane has changed. Sync and fill the report in again.'],
        },
      })
    })
  })
})
