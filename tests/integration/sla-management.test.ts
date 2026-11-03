import { afterAll, describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { listUpcomingRenewals } from '@/server/contracts/contracts'
import {
  DEFAULT_SLA_POLICIES,
  getCompanySlaTargets,
  resolveSlaTargets,
  updateCompanySlaTargets,
} from '@/server/sla/sla'
import { deleteUsersByEmailPrefix, db, inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * The company-wide SLA targets and the renewal board (slice 30), against the real database.
 *
 * The company-wide targets are rows every other suite reads — `tickets.test.ts` asserts the seeded
 * numbers — so a write here runs inside `inRolledBackTx` and leaves nothing behind. `withAudit` joins
 * the caller's transaction when one is passed, which is what makes that possible.
 */

const PREFIX = 'sla30-'

afterAll(async () => {
  await deleteUsersByEmailPrefix(PREFIX)
  await db.$disconnect()
})

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
    ip: '203.0.113.7',
    userAgent: 'vitest',
    ...overrides,
  }
}

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${PREFIX}${role.toLowerCase()}-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

function companyInput(overrides: Record<string, unknown> = {}) {
  return {
    responseP1: '20',
    resolutionP1: '120',
    responseP2: '60',
    resolutionP2: '240',
    responseP3: '240',
    resolutionP3: '1440',
    responseP4: '720',
    resolutionP4: '3600',
    ...overrides,
  }
}

describe('company-wide SLA targets', () => {
  it('writes all four rows and audits each one that changed', async () => {
    const admin = contextFor(await makeUser(db, 'ADMIN'))

    await inRolledBackTx(async (tx) => {
      const before = await tx.slaPolicy.findMany({
        where: { contractId: null },
        select: { id: true, priority: true },
      })

      await updateCompanySlaTargets(admin, companyInput(), tx)

      const after = await tx.slaPolicy.findMany({
        where: { contractId: null, isActive: true },
        select: { id: true, priority: true, responseMinutes: true, resolutionMinutes: true },
      })
      expect(after).toHaveLength(4)
      // Updated in place wherever a row already existed, so `@@unique([priority, contractId])` is
      // never asked to hold two company-wide rows for one priority.
      for (const row of after) {
        const prior = before.find((candidate) => candidate.priority === row.priority)
        if (prior) expect(row.id).toBe(prior.id)
      }
      expect(after.find((row) => row.priority === 'P1')).toMatchObject({
        responseMinutes: 20,
        resolutionMinutes: 120,
      })

      const audit = await tx.auditLog.findMany({
        where: { entity: 'SlaPolicy', userId: admin.userId },
        select: { entityId: true, action: true },
      })
      expect(audit.length).toBeGreaterThan(0)
      expect(audit.every((row) => after.some((policy) => policy.id === row.entityId))).toBe(true)

      // And the number the app actually counts down from follows.
      expect(await resolveSlaTargets('P1', null, tx)).toEqual({
        responseMinutes: 20,
        resolutionMinutes: 120,
      })
    })
  })

  it('shows the built-in fallback rather than nothing when a priority has no row', async () => {
    const admin = contextFor(await makeUser(db, 'ADMIN'))

    await inRolledBackTx(async (tx) => {
      // Remove P4's company-wide row, the one case `resolveSlaTargets` falls back for.
      const p4 = await tx.slaPolicy.deleteMany({ where: { contractId: null, priority: 'P4' } })
      expect(p4.count).toBeGreaterThan(0)

      const targets = await getCompanySlaTargets(admin, tx)
      const row = targets.find((target) => target.priority === 'P4')
      const fallback = DEFAULT_SLA_POLICIES.find((policy) => policy.priority === 'P4')!
      expect(row).toMatchObject({
        id: null,
        isFallback: true,
        responseMinutes: fallback.responseMinutes,
        resolutionMinutes: fallback.resolutionMinutes,
      })
    })
  })

  it('lets nobody but an administrator change them, and nobody but one read them', async () => {
    for (const role of ['DISPATCHER', 'TECHNICIAN', 'STOREKEEPER', 'FINANCE'] as const) {
      const context = contextFor(await makeUser(db, role))
      await expect(updateCompanySlaTargets(context, companyInput())).rejects.toBeInstanceOf(
        ForbiddenError,
      )
      await expect(getCompanySlaTargets(context)).rejects.toBeInstanceOf(ForbiddenError)
    }
  })
})

describe('the renewal board', () => {
  async function customerWithRenewal(tx: Tx, renewalDate: string) {
    const suffix = testSuffix()
    const customer = await tx.customer.create({
      data: { legalName: `Renewal ${suffix}`, status: 'ACTIVE' },
    })
    await tx.contract.create({
      data: {
        customerId: customer.id,
        type: 'AMC',
        reference: `REF-${suffix}`,
        renewalDate: new Date(`${renewalDate}T00:00:00.000Z`),
      },
    })
    return customer
  }

  it('lists what renews inside the window or is overdue, soonest first, and drops the rest', async () => {
    const admin = contextFor(await makeUser(db, 'ADMIN'))

    await inRolledBackTx(async (tx) => {
      const now = new Date('2026-10-29T09:30:00.000Z')
      const overdue = await customerWithRenewal(tx, '2026-10-01')
      const soon = await customerWithRenewal(tx, '2026-12-01')
      const distant = await customerWithRenewal(tx, '2027-06-01')

      const rows = (await listUpcomingRenewals(admin, tx, now)).filter(
        (row) =>
          row.customer.id === overdue.id ||
          row.customer.id === soon.id ||
          row.customer.id === distant.id,
      )

      expect(rows.map((row) => row.customer.id)).toEqual([overdue.id, soon.id])
      expect(rows[0]).toMatchObject({ state: 'overdue', daysUntil: -28 })
      expect(rows[1]).toMatchObject({ state: 'due' })
      expect(rows[1]!.daysUntil).toBeGreaterThan(0)
    })
  })

  it('does not show a retired contract', async () => {
    const admin = contextFor(await makeUser(db, 'ADMIN'))

    await inRolledBackTx(async (tx) => {
      const customer = await customerWithRenewal(tx, '2026-11-15')
      await tx.contract.updateMany({
        where: { customerId: customer.id },
        data: { deletedAt: new Date() },
      })

      const rows = await listUpcomingRenewals(admin, tx, new Date('2026-10-29T00:00:00.000Z'))
      expect(rows.some((row) => row.customer.id === customer.id)).toBe(false)
    })
  })

  it('is readable by every role that reads the customer list, and refused to one that does not', async () => {
    for (const role of ['DISPATCHER', 'FINANCE'] as const) {
      // Same gate as `/customers` itself: if a role reaches that page, it reaches this board.
      const context = contextFor(await makeUser(db, role))
      await expect(listUpcomingRenewals(context)).resolves.toBeInstanceOf(Array)
    }

    const technician = contextFor(await makeUser(db, 'TECHNICIAN'))
    await expect(listUpcomingRenewals(technician)).rejects.toBeInstanceOf(ForbiddenError)
  })
})
