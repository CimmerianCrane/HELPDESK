import { describe, expect, it } from 'vitest'
import type { JobStatus, Role } from '@prisma/client'
import { ForbiddenError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { utilisationReport } from '@/server/reports/utilisation'
import { inRolledBackTx, jobFixture, technicianFixture, testSuffix, type Tx } from './helpers'

/**
 * Technician utilisation against the real database, inside a transaction that always rolls back
 * (slice 33).
 *
 * The cases a screen cannot prove: hours are the in-progress spans from the status history rather
 * than anything typed, a job with two technicians divides its hours rather than crediting both, the
 * denominator is working days less working-hours leave, an unfinished job contributes nothing, and
 * the report is finance's.
 */

function contextFor(
  user: { id: string; name: string; email: string; role: Role },
  overrides: Partial<AuthContext> = {},
): AuthContext {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    technicianId: null,
    ip: '203.0.113.33',
    userAgent: 'vitest',
    ...overrides,
  }
}

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${role.toLowerCase()}-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

async function fixtures(tx: Tx) {
  const suffix = testSuffix()
  const customer = await tx.customer.create({
    data: { legalName: `Util Co ${suffix}`, status: 'ACTIVE' },
  })
  const site = await tx.site.create({ data: { customerId: customer.id, name: `Site ${suffix}` } })
  const jobType = await tx.jobType.create({
    data: { code: `UT_${suffix}`, name: `Servicing ${suffix}` },
  })
  return { customer, site, jobType, suffix, base: { customerId: customer.id, siteId: site.id, jobTypeId: jobType.id } }
}

/** A job that finished at a known instant, with the history rows that describe how it went. */
async function finishedJob(
  tx: Tx,
  base: { customerId: string; siteId: string; jobTypeId: string },
  steps: Array<{ toStatus: JobStatus; at: Date }>,
  technicianIds: string[] = [],
) {
  const job = await jobFixture(tx, base, { suffix: testSuffix() })
  const completedAt = steps.find((step) => step.toStatus === 'COMPLETED')?.at ?? new Date()

  await tx.job.update({
    where: { id: job.id },
    data: {
      status: 'COMPLETED',
      completedAt,
      onSiteAt: steps.find((step) => step.toStatus === 'IN_PROGRESS')?.at ?? null,
    },
  })
  for (const step of steps) {
    await tx.jobStatusHistory.create({
      data: { jobId: job.id, toStatus: step.toStatus, changedAt: step.at },
    })
  }
  for (const technicianId of technicianIds) {
    await tx.jobTechnician.create({ data: { jobId: job.id, technicianId } })
  }
  return job
}

const at = (iso: string) => new Date(iso)

describe('utilisation', () => {
  it('counts the in-progress span of a completed job, not the time it sat on hold', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { technician, user } = await technicianFixture(tx)
      const { base } = await fixtures(tx)

      await finishedJob(tx, base, [
        { toStatus: 'DISPATCHED', at: at('2026-03-02T08:00:00Z') },
        { toStatus: 'IN_PROGRESS', at: at('2026-03-02T09:00:00Z') },
        { toStatus: 'ON_HOLD', at: at('2026-03-02T10:00:00Z') },
        { toStatus: 'IN_PROGRESS', at: at('2026-03-02T14:00:00Z') },
        { toStatus: 'COMPLETED', at: at('2026-03-02T15:00:00Z') },
      ], [technician.id])

      const report = await utilisationReport(
        finance,
        { from: '2026-03-02', to: '2026-03-02' },
        tx,
        at('2026-03-10T00:00:00Z'),
      )
      const row = report.rows.find((entry) => entry.technicianId === technician.id)

      // 09:00–10:00 + 14:00–15:00 = 2 h on the tools; dispatch to completion = 7 h on the road.
      expect(row).toMatchObject({ name: user.name, jobs: 1, onSiteHours: 2, roadHours: 7 })
      expect(report.workingDays).toBe(1)
      expect(row?.availableHours).toBe(8)
      expect(row?.utilisationRatio).toBeCloseTo(0.25)
    })
  })

  it('splits a job’s hours between the technicians on it', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const lead = await technicianFixture(tx)
      const second = await technicianFixture(tx)
      const { base } = await fixtures(tx)

      await finishedJob(tx, base, [
        { toStatus: 'IN_PROGRESS', at: at('2026-03-03T09:00:00Z') },
        { toStatus: 'COMPLETED', at: at('2026-03-03T13:00:00Z') },
      ], [lead.technician.id, second.technician.id])

      const report = await utilisationReport(
        finance,
        { from: '2026-03-03', to: '2026-03-03' },
        tx,
        at('2026-03-10T00:00:00Z'),
      )

      for (const technician of [lead, second]) {
        const row = report.rows.find((entry) => entry.technicianId === technician.technician.id)
        expect(row?.jobs).toBe(1)
        expect(row?.onSiteHours).toBe(2)
      }
      // One visit, two people: the job total is one, not two.
      expect(report.totals.jobs).toBe(1)
    })
  })

  it('takes booked leave out of the available hours, in working hours only', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { technician } = await technicianFixture(tx)
      const { base } = await fixtures(tx)

      // A full weekday off, booked as a whole calendar day.
      await tx.unavailability.create({
        data: {
          technicianId: technician.id,
          startAt: at('2026-03-03T00:00:00Z'),
          endAt: at('2026-03-04T00:00:00Z'),
          reason: 'Leave',
        },
      })
      await finishedJob(tx, base, [
        { toStatus: 'IN_PROGRESS', at: at('2026-03-02T09:00:00Z') },
        { toStatus: 'COMPLETED', at: at('2026-03-02T17:00:00Z') },
      ], [technician.id])

      const report = await utilisationReport(
        finance,
        { from: '2026-03-02', to: '2026-03-06' },
        tx,
        at('2026-03-10T00:00:00Z'),
      )
      const row = report.rows.find((entry) => entry.technicianId === technician.id)

      // Five working days less one off is 32 h available, against the 8 h worked.
      expect(report.workingDays).toBe(5)
      expect(row?.leaveHours).toBe(8)
      expect(row?.availableHours).toBe(32)
      expect(row?.onSiteHours).toBe(8)
      expect(row?.utilisationRatio).toBeCloseTo(0.25)
    })
  })

  it('ignores a job that has not completed, and says how many had nobody on them', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { technician } = await technicianFixture(tx)
      const { base } = await fixtures(tx)

      // A window no demo data lands in, so the totals are this test's alone.
      const day = '2019-05-06'

      // Still in progress: its hours are unknown, so it lands in no row.
      const open = await jobFixture(tx, base, { suffix: testSuffix() })
      await tx.job.update({ where: { id: open.id }, data: { status: 'IN_PROGRESS' } })
      await tx.jobStatusHistory.create({
        data: { jobId: open.id, toStatus: 'IN_PROGRESS', changedAt: at('2019-05-06T09:00:00Z') },
      })
      await tx.jobTechnician.create({ data: { jobId: open.id, technicianId: technician.id } })

      // Completed but never assigned to anyone.
      await finishedJob(tx, base, [
        { toStatus: 'IN_PROGRESS', at: at('2019-05-06T09:00:00Z') },
        { toStatus: 'COMPLETED', at: at('2019-05-06T11:00:00Z') },
      ])

      const report = await utilisationReport(
        finance,
        { from: day, to: day },
        tx,
        at('2019-05-10T00:00:00Z'),
      )

      const row = report.rows.find((entry) => entry.technicianId === technician.id)
      expect(row?.jobs).toBe(0)
      // The unfinished job is in no total at all; the completed unassigned one is counted as work
      // done, and named separately because its hours are in nobody's row.
      expect(report.totals.jobs).toBe(1)
      expect(report.unassignedJobs).toBe(1)
    })
  })

  it('refuses a role without report.financial', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const technician = contextFor(await makeUser(tx, 'TECHNICIAN'))
      await expect(utilisationReport(dispatcher, {}, tx)).rejects.toBeInstanceOf(ForbiddenError)
      await expect(utilisationReport(technician, {}, tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})
