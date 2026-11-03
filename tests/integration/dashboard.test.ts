import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import type { AuthContext } from '@/server/auth/types'
import { dashboardSummary } from '@/server/dashboard/dashboard'
import { jobFixtures, testSuffix, type Tx } from './helpers'

/**
 * The board's new half (UI-REVIEW §5): today's visits, who is on call, and the figure's direction
 * since yesterday.
 *
 * These are integration tests because the three new answers all come from different tables —
 * `Job.scheduledStart`, `OnCallShift` and the SLA deadlines — and the questions worth asking are
 * whether they agree with the clock and whether the yesterday comparison is honest rather than a
 * second, differently-defined query.
 */

function contextFor(userId: string, role: Role = 'DISPATCHER'): AuthContext {
  return {
    userId,
    name: 'Board tester',
    email: `board-${testSuffix()}@example.test`,
    role,
    technicianId: null,
    ip: '203.0.113.9',
    userAgent: 'vitest',
  }
}

async function dispatcher(tx: Tx) {
  const suffix = testSuffix()
  const user = await tx.user.create({
    data: {
      email: `board-${suffix}@example.test`,
      name: 'Board tester',
      role: 'DISPATCHER',
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
  return contextFor(user.id)
}

const TZ = 'Asia/Singapore'

// The board counts every open job, so any seeded P1 or breach on the shared database is already in
// the figures. These assert on the direction and the presence of the row under test, not on a total.
describe('dashboardSummary', () => {
  it('puts a visit scheduled today on today’s board and one tomorrow off it', async () => {
    await inRolledBack(async (tx) => {
      const context = await dispatcher(tx)
      const { customer, site, jobType } = await jobFixtures(tx)

      // 10:00 and 11:00 Singapore today. The date is built from the zone, not from the server's clock.
      const now = new Date('2026-03-10T02:00:00.000Z') // 10:00 SGT
      const todayAt = new Date('2026-03-10T03:00:00.000Z') // 11:00 SGT
      const tomorrowAt = new Date('2026-03-11T03:00:00.000Z')

      for (const [number, scheduledStart] of [
        ['BOARD-TODAY', todayAt],
        ['BOARD-TOMORROW', tomorrowAt],
      ] as const) {
        await tx.job.create({
          data: {
            number,
            jobTypeId: jobType.id,
            customerId: customer.id,
            siteId: site.id,
            status: 'SCHEDULED',
            priority: 'P3',
            scheduledStart,
          },
        })
      }

      const board = await dashboardSummary(context, tx, now)
      const numbers = board.today.visits.map((visit) => visit.number)

      expect(numbers).toContain('BOARD-TODAY')
      expect(numbers).not.toContain('BOARD-TOMORROW')
    })
  })

  it('names who is on call now, and only them', async () => {
    await inRolledBack(async (tx) => {
      const context = await dispatcher(tx)
      const suffix = testSuffix()
      const now = new Date('2026-03-10T02:00:00.000Z')

      async function technician(name: string) {
        const user = await tx.user.create({
          data: {
            email: `${name}-${suffix}@example.test`,
            name,
            role: 'TECHNICIAN',
            passwordHash: 'placeholder-not-a-real-hash',
          },
        })
        return tx.technician.create({ data: { userId: user.id, employeeNo: `${name}-${suffix}` } })
      }

      const onCall = await technician('Oncall')
      const finished = await technician('Finished')

      await tx.onCallShift.create({
        data: {
          technicianId: onCall.id,
          startAt: new Date(now.getTime() - 3_600_000),
          endAt: new Date(now.getTime() + 3_600_000),
        },
      })
      await tx.onCallShift.create({
        data: {
          technicianId: finished.id,
          startAt: new Date(now.getTime() - 7_200_000),
          endAt: new Date(now.getTime() - 3_600_000),
        },
      })

      const board = await dashboardSummary(context, tx, now)
      const names = board.today.onCall.map((shift) => shift.technicianName)

      expect(names).toContain('Oncall')
      expect(names).not.toContain('Finished')
    })
  })

  it('reads a job that breached its SLA between yesterday and now as up one', async () => {
    await inRolledBack(async (tx) => {
      const context = await dispatcher(tx)
      const { customer, site, jobType } = await jobFixtures(tx)

      const now = new Date('2026-03-10T02:00:00.000Z')

      // Reported two hours ago with a target that ran out an hour ago: breached now, still running at
      // yesterday's clock. That is the only shape where the direction can be read off one row.
      await tx.job.create({
        data: {
          number: `BOARD-SLA-${testSuffix()}`,
          jobTypeId: jobType.id,
          customerId: customer.id,
          siteId: site.id,
          status: 'SCHEDULED',
          priority: 'P2',
          reportedAt: new Date(now.getTime() - 2 * 3_600_000),
          slaResponseDue: new Date(now.getTime() - 3_600_000),
        },
      })

      const board = await dashboardSummary(context, tx, now)

      // Due an hour ago, so breached now; at yesterday's clock the deadline was 25 hours away, so it
      // was not. The comparison is the same rows read at a different instant.
      expect(board.slaBreached).toBeGreaterThanOrEqual(1)
      expect(board.sinceYesterday.slaBreached).toBeGreaterThanOrEqual(1)
    })
  })

  it('refuses a caller with no office board', async () => {
    await inRolledBack(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `board-tech-${testSuffix()}@example.test`,
          name: 'Phone only',
          role: 'TECHNICIAN',
          passwordHash: 'placeholder-not-a-real-hash',
        },
      })

      await expect(dashboardSummary(contextFor(user.id, 'TECHNICIAN'), tx)).rejects.toThrow(
        /forbidden|permission/i,
      )
    })
  })
})

/** The file's own wrapper, so each test is one read against a rolled-back transaction. */
async function inRolledBack<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const { inRolledBackTx } = await import('./helpers')
  return inRolledBackTx(fn)
}
