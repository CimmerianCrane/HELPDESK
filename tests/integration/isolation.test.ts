import { describe, expect, it } from 'vitest'
import type { AuthContext, Role } from '@/server/auth/types'
import {
  craneReadWhere,
  customerReadWhere,
  jobReadWhere,
  reportReadWhere,
} from '@/server/auth/scope'
import {
  craneFixtures,
  inRolledBackTx,
  jobFixture,
  jobFixtures,
  technicianFixture,
  type Tx,
} from './helpers'

/**
 * The brief's §12.9 rule, proven against the real database rather than asserted in a comment:
 * a technician cannot read another technician's jobs, and no role reads data belonging to a customer
 * it has no business seeing.
 *
 * Everything here runs inside a transaction that is rolled back, so the shared database is untouched.
 */

function context(role: Role, overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: `user-${role}`,
    name: `Test ${role}`,
    email: `${role.toLowerCase()}@example.test`,
    role,
    technicianId: null,
    customerId: null,
    ip: '203.0.113.1',
    userAgent: 'vitest',
    ...overrides,
  }
}

/** Two technicians, each with one job on a different customer. The setup the whole rule is about. */
async function twoTechniciansTwoCustomers(tx: Tx) {
  const first = await technicianFixture(tx)
  const second = await technicianFixture(tx)

  const customerA = await jobFixtures(tx)
  const customerB = await jobFixtures(tx)

  const jobA = await jobFixture(
    tx,
    { customerId: customerA.customer.id, siteId: customerA.site.id, jobTypeId: customerA.jobType.id },
    { suffix: `A${customerA.suffix}`, assignTo: first.technician.id },
  )
  const jobB = await jobFixture(
    tx,
    { customerId: customerB.customer.id, siteId: customerB.site.id, jobTypeId: customerB.jobType.id },
    { suffix: `B${customerB.suffix}`, assignTo: second.technician.id },
  )

  return { first, second, customerA, customerB, jobA, jobB }
}

describe('a technician can only read their own jobs', () => {
  it('returns their job and not the other technician’s', async () => {
    await inRolledBackTx(async (tx) => {
      const { first, jobA, jobB } = await twoTechniciansTwoCustomers(tx)

      const visibleToFirst = await tx.job.findMany({
        where: jobReadWhere(context('TECHNICIAN', { technicianId: first.technician.id })),
        select: { id: true },
      })

      expect(visibleToFirst.map((job) => job.id)).toContain(jobA.id)
      expect(visibleToFirst.map((job) => job.id)).not.toContain(jobB.id)
    })
  })

  it('shows the other technician the mirror image', async () => {
    await inRolledBackTx(async (tx) => {
      const { second, jobA, jobB } = await twoTechniciansTwoCustomers(tx)

      const visibleToSecond = (
        await tx.job.findMany({
          where: jobReadWhere(context('TECHNICIAN', { technicianId: second.technician.id })),
          select: { id: true },
        })
      ).map((job) => job.id)

      expect(visibleToSecond).toContain(jobB.id)
      expect(visibleToSecond).not.toContain(jobA.id)
      // Guards against a filter that accidentally matches the whole table.
      expect(visibleToSecond.length).toBeLessThan(50)
    })
  })

  it('denies a technician whose technician record is missing', async () => {
    await inRolledBackTx(async (tx) => {
      const { jobA } = await twoTechniciansTwoCustomers(tx)

      const visible = await tx.job.findMany({
        where: jobReadWhere(context('TECHNICIAN', { technicianId: null })),
        select: { id: true },
      })

      // The deny filter must match nothing. If Prisma compiled `{ id: '__denied__' }` into a query
      // that returned rows, this is where it would show.
      expect(visible).toHaveLength(0)
      expect(visible.map((job) => job.id)).not.toContain(jobA.id)
    })
  })
})

describe('a technician cannot reach another customer’s data', () => {
  it('sees only the reports on their own jobs', async () => {
    await inRolledBackTx(async (tx) => {
      const { first, customerA, customerB, jobA, jobB } = await twoTechniciansTwoCustomers(tx)

      const template = await tx.reportTemplate.create({
        data: {
          code: `TPL_${customerA.suffix}`,
          name: `Template ${customerA.suffix}`,
          version: 1,
          bodyHtml: '<p>test</p>',
          schema: {},
        },
      })
      const craneA = await tx.crane.create({
        data: {
          siteId: customerA.site.id,
          customerId: customerA.customer.id,
          assetTag: `TAG-A-${customerA.suffix}`,
          qrValue: `QR-A-${customerA.suffix}`,
          type: 'OVERHEAD',
          swlKg: 5000,
        },
      })
      const craneB = await tx.crane.create({
        data: {
          siteId: customerB.site.id,
          customerId: customerB.customer.id,
          assetTag: `TAG-B-${customerB.suffix}`,
          qrValue: `QR-B-${customerB.suffix}`,
          type: 'OVERHEAD',
          swlKg: 5000,
        },
      })

      const reportA = await tx.report.create({
        data: { jobId: jobA.id, craneId: craneA.id, templateId: template.id, templateVersion: 1, data: {} },
      })
      await tx.report.create({
        data: { jobId: jobB.id, craneId: craneB.id, templateId: template.id, templateVersion: 1, data: {} },
      })

      const visible = await tx.report.findMany({
        where: reportReadWhere(context('TECHNICIAN', { technicianId: first.technician.id })),
        select: { id: true },
      })

      expect(visible.map((report) => report.id)).toEqual([reportA.id])
    })
  })

  it('sees the cranes at a site they are working at, and nothing else', async () => {
    await inRolledBackTx(async (tx) => {
      const { first, customerA, customerB } = await twoTechniciansTwoCustomers(tx)

      const onMySite = await tx.crane.create({
        data: {
          siteId: customerA.site.id,
          customerId: customerA.customer.id,
          assetTag: `MINE-${customerA.suffix}`,
          qrValue: `QR-MINE-${customerA.suffix}`,
          type: 'OVERHEAD',
          swlKg: 5000,
        },
      })
      const onTheirSite = await tx.crane.create({
        data: {
          siteId: customerB.site.id,
          customerId: customerB.customer.id,
          assetTag: `THEIRS-${customerB.suffix}`,
          qrValue: `QR-THEIRS-${customerB.suffix}`,
          type: 'OVERHEAD',
          swlKg: 5000,
        },
      })

      const visible = (
        await tx.crane.findMany({
          where: craneReadWhere(context('TECHNICIAN', { technicianId: first.technician.id })),
          select: { id: true },
        })
      ).map((crane) => crane.id)

      expect(visible).toContain(onMySite.id)
      expect(visible).not.toContain(onTheirSite.id)
    })
  })

  it('cannot look up a customer at all', async () => {
    await inRolledBackTx(async (tx) => {
      const { first } = await twoTechniciansTwoCustomers(tx)

      const visible = await tx.customer.findMany({
        where: customerReadWhere(context('TECHNICIAN', { technicianId: first.technician.id })),
        select: { id: true },
      })

      expect(visible).toHaveLength(0)
    })
  })
})

describe('office roles see the whole picture', () => {
  it('lets a dispatcher read both technicians’ jobs', async () => {
    await inRolledBackTx(async (tx) => {
      const { jobA, jobB } = await twoTechniciansTwoCustomers(tx)

      const visible = (
        await tx.job.findMany({
          where: jobReadWhere(context('DISPATCHER')),
          select: { id: true },
          // Narrowed for speed; the filter under test is the one above.
          take: 500,
        })
      ).map((job) => job.id)

      expect(visible).toContain(jobA.id)
      expect(visible).toContain(jobB.id)
    })
  })
})

describe('soft-deleted records are invisible', () => {
  it('hides a job that has been deleted, even from an administrator', async () => {
    await inRolledBackTx(async (tx) => {
      const { jobA } = await twoTechniciansTwoCustomers(tx)
      await tx.job.update({ where: { id: jobA.id }, data: { deletedAt: new Date() } })

      const visible = await tx.job.findMany({
        where: jobReadWhere(context('ADMIN')),
        select: { id: true },
      })

      expect(visible.map((job) => job.id)).not.toContain(jobA.id)
    })
  })

  it('hides a soft-deleted crane', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await craneFixtures(tx)
      await tx.crane.update({ where: { id: base.crane.id }, data: { deletedAt: new Date() } })

      const visible = await tx.crane.findMany({
        where: craneReadWhere(context('DISPATCHER')),
        select: { id: true },
      })

      expect(visible.map((crane) => crane.id)).not.toContain(base.crane.id)
    })
  })
})
