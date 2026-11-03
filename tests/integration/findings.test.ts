import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, RuleError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  acknowledgeDecline,
  createFollowUpJob,
  findingsForCrane,
  findingsForReport,
  updateFindingStatus,
} from '@/server/findings/findings'
import { transitionJob } from '@/server/jobs/jobs'
import {
  craneFixtures,
  inRolledBackTx,
  jobFixture,
  technicianFixture,
  testSuffix,
  type Tx,
} from './helpers'

/**
 * Findings against the real database (slice 16). Everything runs in the transaction `withAudit` joins,
 * so a failing assertion leaves no finding, no job and no audit row behind.
 *
 * The cases worth proving are the ones a screen cannot: the flow refuses a move it should not allow,
 * a technician cannot see another technician's finding, a decline is impossible without a signature,
 * and one click never raises a second job for the same finding.
 */

const TEMPLATE = { sections: [] }

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
    ip: '203.0.113.11',
    userAgent: 'vitest',
  }
}

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${role.toLowerCase()}-finding-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

/** A crane, a job on it, a submitted report and one finding — the minimum a finding needs. */
async function findingFixture(
  tx: Tx,
  options: {
    status?: 'OPEN' | 'QUOTED' | 'SCHEDULED' | 'RECTIFIED'
    recommendation?: string | null
  } = {},
) {
  const base = await craneFixtures(tx)
  const job = await jobFixture(
    tx,
    { customerId: base.customer.id, siteId: base.site.id, jobTypeId: base.jobType.id },
    { suffix: base.suffix },
  )
  const template = await tx.reportTemplate.create({
    data: { code: `RPT-FND-${base.suffix}`, name: 'Report', version: 1, bodyHtml: '', schema: TEMPLATE },
  })

  const report = await tx.report.create({
    data: {
      jobId: job.id,
      craneId: base.crane.id,
      templateId: template.id,
      templateVersion: 1,
      data: {},
      status: 'SUBMITTED',
      submittedAt: new Date(),
    },
  })

  const finding = await tx.finding.create({
    data: {
      reportId: report.id,
      craneId: base.crane.id,
      component: 'Hoist brake',
      description: 'Brake travel is below the manufacturer minimum.',
      severity: 'MAJOR',
      recommendation: options.recommendation === undefined ? 'Replace the brake linings.' : options.recommendation,
      status: options.status ?? 'OPEN',
    },
  })

  return { ...base, job, report, finding }
}

async function signatureFile(tx: Tx, findingId: string) {
  const id = crypto.randomUUID()
  return tx.file.create({
    data: {
      id,
      entity: 'Finding',
      entityId: findingId,
      findingId,
      kind: 'SIGNATURE',
      filename: 'signature.png',
      mimeType: 'image/png',
      sizeBytes: 128,
      storageKey: `findings/${findingId}/signatures/${id}.png`,
    },
  })
}

describe('findings', () => {
  it('moves a finding along its flow and audits the change', async () => {
    await inRolledBackTx(async (tx) => {
      const context = contextFor(await makeUser(tx, 'ADMIN'))
      const { finding } = await findingFixture(tx)

      const updated = await updateFindingStatus(context, finding.id, { status: 'QUOTED' }, tx)
      expect(updated.status).toBe('QUOTED')
      expect(updated.open).toBe(true)

      const audit = await tx.auditLog.findFirst({
        where: { entity: 'Finding', entityId: finding.id, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      })
      expect(audit?.before).toMatchObject({ status: 'OPEN' })
      expect(audit?.after).toMatchObject({ status: 'QUOTED' })
    })
  })

  it('refuses a move the flow does not allow', async () => {
    await inRolledBackTx(async (tx) => {
      const context = contextFor(await makeUser(tx, 'ADMIN'))
      const { finding } = await findingFixture(tx, { status: 'SCHEDULED' })

      await expect(
        updateFindingStatus(context, finding.id, { status: 'QUOTED' }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('refuses the status form as a way to decline', async () => {
    await inRolledBackTx(async (tx) => {
      const context = contextFor(await makeUser(tx, 'ADMIN'))
      const { finding } = await findingFixture(tx)

      await expect(
        updateFindingStatus(context, finding.id, { status: 'DECLINED_BY_CUSTOMER' }, tx),
      ).rejects.toThrow()
    })
  })

  it('keeps a finding off a technician’s list when the report is not theirs', async () => {
    await inRolledBackTx(async (tx) => {
      const mine = await technicianFixture(tx)
      const theirs = await technicianFixture(tx)
      const { finding, report, job } = await findingFixture(tx)

      await tx.report.update({ where: { id: report.id }, data: { createdById: mine.user.id } })
      await tx.jobTechnician.create({
        data: { jobId: job.id, technicianId: mine.technician.id, isLead: true },
      })

      const visible = await findingsForReport(contextFor(mine.user, mine.technician.id), report.id, tx)
      expect(visible.map((row) => row.id)).toEqual([finding.id])

      const hidden = await findingsForReport(
        contextFor(theirs.user, theirs.technician.id),
        report.id,
        tx,
      )
      expect(hidden).toEqual([])
    })
  })

  it('lists only open findings on the crane page', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { crane, report } = await findingFixture(tx, { status: 'RECTIFIED' })
      const open = await tx.finding.create({
        data: {
          reportId: report.id,
          craneId: crane.id,
          component: 'Limit switch',
          description: 'Slow to trip.',
          severity: 'MINOR',
          status: 'OPEN',
        },
      })

      const rows = await findingsForCrane(dispatcher, crane.id, { openOnly: true }, tx)
      expect(rows.map((row) => row.id)).toEqual([open.id])
      expect(rows[0]?.suggestedPriority).toBe('P3')
    })
  })

  it('records a declined repair only with a signature, and only when there is a recommendation', async () => {
    await inRolledBackTx(async (tx) => {
      const context = contextFor(await makeUser(tx, 'ADMIN'))
      const { finding } = await findingFixture(tx)
      const signature = await signatureFile(tx, finding.id)

      const declined = await acknowledgeDecline(
        context,
        finding.id,
        {
          name: 'J. Field',
          date: '2026-10-20',
          note: 'Not budgeted this quarter.',
          signatureFileId: signature.id,
        },
        tx,
      )

      expect(declined.status).toBe('DECLINED_BY_CUSTOMER')
      expect(declined.open).toBe(false)
      expect(declined.declined?.name).toBe('J. Field')
      expect(declined.declined?.note).toBe('Not budgeted this quarter.')
      expect(declined.declined?.signatureUrl).toBeTruthy()

      const stored = await tx.finding.findUniqueOrThrow({ where: { id: finding.id } })
      expect(stored.declinedSignatureFileId).toBe(signature.id)
      expect(stored.declinedAcknowledgedAt?.toISOString()).toBe('2026-10-20T00:00:00.000Z')
    })
  })

  it('refuses a decline with no signature row', async () => {
    await inRolledBackTx(async (tx) => {
      const context = contextFor(await makeUser(tx, 'ADMIN'))
      const { finding } = await findingFixture(tx)

      await expect(
        acknowledgeDecline(
          context,
          finding.id,
          { name: 'J. Field', date: '2026-10-20', signatureFileId: crypto.randomUUID() },
          tx,
        ),
      ).rejects.toThrow()
    })
  })

  it('refuses to decline a finding with nothing recommended', async () => {
    await inRolledBackTx(async (tx) => {
      const context = contextFor(await makeUser(tx, 'ADMIN'))
      const { finding } = await findingFixture(tx, { recommendation: null })
      const signature = await signatureFile(tx, finding.id)

      await expect(
        acknowledgeDecline(
          context,
          finding.id,
          { name: 'J. Field', date: '2026-10-20', signatureFileId: signature.id },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('raises one follow-up job, links both ends, and refuses a second', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { finding, job, jobType } = await findingFixture(tx)

      const first = await createFollowUpJob(
        dispatcher,
        { findingId: finding.id, jobTypeId: jobType.id, priority: 'P2', description: 'Fix the brake.' },
        tx,
      )

      expect(first.number).toBeTruthy()
      expect(first.finding.status).toBe('SCHEDULED')
      expect(first.finding.followUpJob?.id).toBe(first.jobId)

      const created = await tx.job.findUniqueOrThrow({
        where: { id: first.jobId },
        include: { cranes: true, parentJob: true },
      })
      expect(created.parentJobId).toBe(job.id)
      expect(created.description).toBe('Fix the brake.')
      expect(created.cranes.map((row) => row.craneId)).toEqual([finding.craneId])

      await expect(
        createFollowUpJob(
          dispatcher,
          { findingId: finding.id, jobTypeId: jobType.id, priority: 'P2' },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('needs `finding.followUpJob` to raise a job', async () => {
    await inRolledBackTx(async (tx) => {
      const technician = await technicianFixture(tx)
      const context = contextFor(technician.user, technician.technician.id)
      const { finding, jobType } = await findingFixture(tx)

      await expect(
        createFollowUpJob(context, { findingId: finding.id, jobTypeId: jobType.id, priority: 'P2' }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  /**
   * The slice-16 carry-over, wired by slice 19 (PLAN §7.7): a follow-up job completing is the record
   * that its defect is fixed. The dispatcher does not hold `finding.write`, so this is the job
   * transition's own write, and it must happen in the same transaction as the status change.
   */
  it('moves a scheduled finding to rectified when its follow-up job completes', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { finding, job } = await findingFixture(tx, { status: 'SCHEDULED' })

      await tx.finding.update({
        where: { id: finding.id },
        data: { followUpJobId: job.id },
      })
      await tx.job.update({ where: { id: job.id }, data: { status: 'IN_PROGRESS' } })

      await transitionJob(dispatcher, job.id, { status: 'COMPLETED' }, tx)

      const stored = await tx.finding.findUniqueOrThrow({ where: { id: finding.id } })
      expect(stored.status).toBe('RECTIFIED')

      const audit = await tx.auditLog.findFirst({
        where: { entity: 'Finding', entityId: finding.id, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      })
      expect(audit?.after).toMatchObject({ status: 'RECTIFIED', completedJobId: job.id })
    })
  })
})
