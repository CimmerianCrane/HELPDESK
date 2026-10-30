import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { createInvoice, transitionInvoice } from '@/server/invoices/invoices'
import { postMovement } from '@/server/inventory/stock'
import { profitabilityReport } from '@/server/reports/profitability'
import { inRolledBackTx, jobFixture, testSuffix, type Tx } from './helpers'

/**
 * Profitability against the real database, inside a transaction that always rolls back (slice 32).
 *
 * The cases a screen cannot prove: revenue is the ex-GST subtotal and only of billed invoices, the
 * cost is the ISSUE movements at cost price, a job's material is booked once however many invoices
 * carry it, and a line with no job is not attributed to a contract or a job type.
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
    customerId: null,
    ip: '203.0.113.32',
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

async function part(tx: Tx, cost: number) {
  const suffix = testSuffix()
  return tx.part.create({
    data: { partNumber: `P-${suffix}`, description: 'Wire rope', uom: 'm', cost, sellPrice: cost * 2 },
  })
}

/** A customer, site and job type — and a job on it, in the state invoicing expects. */
async function fixtures(tx: Tx) {
  const suffix = testSuffix()
  const customer = await tx.customer.create({
    data: { legalName: `Profit Co ${suffix}`, status: 'ACTIVE' },
  })
  const site = await tx.site.create({ data: { customerId: customer.id, name: `Site ${suffix}` } })
  const jobType = await tx.jobType.create({ data: { code: `PT_${suffix}`, name: `Load test ${suffix}` } })
  const job = await jobFixture(
    tx,
    { customerId: customer.id, siteId: site.id, jobTypeId: jobType.id },
    { suffix },
  )
  await tx.job.update({ where: { id: job.id }, data: { status: 'REVIEWED' } })
  return { customer, job, jobType, suffix }
}

/** Issue some parts on a job at a known cost, through the one writer of the ledger. */
async function issue(tx: Tx, jobId: string, cost: number, quantity: number) {
  const item = await part(tx, cost)
  const level = await tx.location.create({ data: { name: `Store ${testSuffix()}`, type: 'WAREHOUSE' } })
  await postMovement(tx, () => Promise.resolve(), {
    partId: item.id,
    type: 'ISSUE',
    quantity,
    fromLocationId: level.id,
    unitCost: cost,
    jobId,
  })
}

async function billed(
  tx: Tx,
  finance: AuthContext,
  jobId: string,
  lines: Array<{ description: string; quantity: number; unitPrice: number }>,
) {
  const draft = await createInvoice(finance, { jobId, lines }, tx)
  return transitionInvoice(finance, draft.id, { status: 'ISSUED' }, tx)
}

describe('profitability', () => {
  it('counts revenue ex-GST and the parts cost of the job behind it', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { customer, job, jobType } = await fixtures(tx)
      await issue(tx, job.id, 10, 3)

      await billed(tx, finance, job.id, [
        { description: 'Labour', quantity: 2, unitPrice: 100 },
        { description: 'Wire rope', quantity: 3, unitPrice: 30 },
      ])

      const report = await profitabilityReport(finance, {}, tx)
      const customerRow = report.byCustomer.find((row) => row.key === customer.id)
      const typeRow = report.byJobType.find((row) => row.key === jobType.id)

      // 2 × 100 + 3 × 30 = 290, no GST in a revenue figure; 3 × 10 = 30 of material.
      expect(customerRow).toMatchObject({ revenue: 290, partsCost: 30, margin: 260 })
      expect(typeRow).toMatchObject({ revenue: 290, partsCost: 30, margin: 260 })
      expect(report.totals).toMatchObject({ revenue: 290, partsCost: 30, margin: 260 })
      expect(report.unattributedRevenue).toBe(0)
    })
  })

  it('books a job’s material once when it is billed on two invoices', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await fixtures(tx)
      await issue(tx, job.id, 10, 2)

      await billed(tx, finance, job.id, [{ description: 'First', quantity: 1, unitPrice: 100 }])
      // Issuing the first invoice moved the job to INVOICED; put it back so a second can be raised.
      await tx.job.update({ where: { id: job.id }, data: { status: 'REVIEWED' } })
      await billed(tx, finance, job.id, [{ description: 'Second', quantity: 1, unitPrice: 100 }])

      const report = await profitabilityReport(finance, {}, tx)
      expect(report.totals.revenue).toBe(200)
      expect(report.totals.partsCost).toBe(20)
    })
  })

  it('does not count a draft invoice as revenue', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await fixtures(tx)

      await createInvoice(finance, { jobId: job.id, lines: [{ description: 'Draft', quantity: 1, unitPrice: 500 }] }, tx)

      const report = await profitabilityReport(finance, {}, tx)
      expect(report.totals.revenue).toBe(0)
      expect(report.invoiceCount).toBe(0)
    })
  })

  it('reports a line with no job as unattributed rather than hiding it', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { customer } = await fixtures(tx)

      // A line the office typed straight onto an invoice, with no job behind it.
      await tx.invoice.create({
        data: {
          number: `INV-9001-${testSuffix()}`,
          customerId: customer.id,
          status: 'ISSUED',
          issueDate: new Date(),
          gstRate: 0.09,
          subtotal: '400',
          gstAmount: '36',
          total: '436',
          lines: { create: [{ description: 'Day rate', quantity: '1', unitPrice: '400', lineTotal: '400' }] },
        },
      })

      const report = await profitabilityReport(finance, {}, tx)
      expect(report.totals.revenue).toBe(400)
      expect(report.unattributedRevenue).toBe(400)
      expect(report.byCustomer.find((row) => row.key === customer.id)?.revenue).toBe(400)
      // Nothing to attribute it to, so neither grouping invents a row for it.
      expect(report.byContract).toEqual([])
      expect(report.byJobType).toEqual([])
    })
  })

  it('refuses a role without report.financial', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      await expect(profitabilityReport(dispatcher, {}, tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})
