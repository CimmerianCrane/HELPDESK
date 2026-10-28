import { describe, expect, it } from 'vitest'
import type { JobStatus, Role } from '@prisma/client'
import { ForbiddenError, NotFoundError, RuleError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  createInvoice,
  getInvoice,
  invoicesForJob,
  jobCosting,
  listInvoices,
  recordPayment,
  renderInvoice,
  transitionInvoice,
  updateInvoice,
} from '@/server/invoices/invoices'
import { craneFixtures, inRolledBackTx, jobFixture, technicianFixture, testSuffix, type Tx } from './helpers'

/**
 * Invoices against the real database, inside a transaction that always rolls back (slice 20).
 *
 * The cases a screen cannot prove: only a reviewed job can be invoiced, the numbers are computed from
 * the lines rather than posted, issuing stamps the due date from the customer's terms and moves the
 * job through its own status machine, the paid status follows the payments, and a voided or partly
 * paid invoice behaves the way the money says it should.
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
    ip: '203.0.113.11',
    userAgent: 'vitest',
    ...overrides,
  }
}

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${role.toLowerCase()}-invoice-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

const line = (overrides: Partial<{ description: string; quantity: number; unitPrice: number }> = {}) => ({
  description: 'Replace hoist brake pads',
  quantity: 1,
  unitPrice: 100,
  ...overrides,
})

/** A customer on 30-day terms, a crane, a job due for invoicing, and the GST rate pinned. */
async function invoiceFixture(tx: Tx, options: { jobStatus?: JobStatus; paymentTerms?: number } = {}) {
  await tx.setting.upsert({
    where: { key: 'gstRate' },
    create: { key: 'gstRate', value: 0.09 },
    update: { value: 0.09 },
  })
  const base = await craneFixtures(tx)
  await tx.customer.update({
    where: { id: base.customer.id },
    data: { paymentTerms: options.paymentTerms ?? 30 },
  })
  const job = await jobFixture(
    tx,
    { customerId: base.customer.id, siteId: base.site.id, jobTypeId: base.jobType.id },
    { suffix: base.suffix },
  )
  await tx.job.update({ where: { id: job.id }, data: { status: options.jobStatus ?? 'REVIEWED' } })
  return { ...base, job }
}

/** Raise and issue an invoice, which is the state most of the payment tests start from. */
async function issuedInvoice(
  tx: Tx,
  context: AuthContext,
  jobId: string,
  lines = [line({ quantity: 2, unitPrice: 150 })],
) {
  const draft = await createInvoice(context, { jobId, lines }, tx)
  return transitionInvoice(context, draft.id, { status: 'ISSUED' }, tx)
}

describe('raising an invoice', () => {
  it('numbers a draft from a reviewed job and computes GST from its lines', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await invoiceFixture(tx)

      const invoice = await createInvoice(
        finance,
        {
          jobId: job.id,
          lines: [
            { description: 'Four hours on site', quantity: 4, unitPrice: 120 },
            { description: 'Wire rope', quantity: 2, unitPrice: 100 },
          ],
        },
        tx,
      )

      expect(invoice.number).toMatch(/^INV-\d{4}-\d{4,}$/)
      expect(invoice.status).toBe('DRAFT')
      expect(invoice.issueDate).toBeNull()
      expect(invoice.subtotal).toBe(680)
      expect(invoice.gstAmount).toBeCloseTo(61.2)
      expect(invoice.total).toBeCloseTo(741.2)
      expect(invoice.amountPaid).toBe(0)
      expect(invoice.balance).toBeCloseTo(741.2)
      expect(invoice.editable).toBe(true)
      expect(invoice.payable).toBe(false)
      expect(invoice.job?.id).toBe(job.id)

      const audit = await tx.auditLog.findFirst({
        where: { entity: 'Invoice', entityId: invoice.id, action: 'CREATE' },
      })
      expect(audit?.after).toMatchObject({ number: invoice.number, status: 'DRAFT', jobId: job.id })

      // A draft bills nothing yet, so the job stays where it was.
      const stored = await tx.job.findUniqueOrThrow({ where: { id: job.id } })
      expect(stored.status).toBe('REVIEWED')
    })
  })

  it('refuses a job that has not been reviewed', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await invoiceFixture(tx, { jobStatus: 'COMPLETED' })

      await expect(createInvoice(finance, { jobId: job.id, lines: [line()] }, tx)).rejects.toBeInstanceOf(
        RuleError,
      )
    })
  })

  it('gives each invoice its own number', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await invoiceFixture(tx)

      const first = await createInvoice(finance, { jobId: job.id, lines: [line()] }, tx)
      const second = await createInvoice(finance, { jobId: job.id, lines: [line()] }, tx)

      expect(second.number).not.toBe(first.number)
      expect(Number(second.number.slice(-4))).toBe(Number(first.number.slice(-4)) + 1)
    })
  })

  it('is refused to everyone who does not hold invoice.write', async () => {
    await inRolledBackTx(async (tx) => {
      const { job } = await invoiceFixture(tx)
      for (const role of ['DISPATCHER', 'STOREKEEPER', 'TECHNICIAN'] as Role[]) {
        const context = contextFor(await makeUser(tx, role))
        await expect(
          createInvoice(context, { jobId: job.id, lines: [line()] }, tx),
        ).rejects.toBeInstanceOf(ForbiddenError)
        await expect(listInvoices(context, {}, tx)).rejects.toBeInstanceOf(ForbiddenError)
      }
    })
  })
})

describe('issuing an invoice', () => {
  it('stamps the issue date, the due date from the customer terms, and moves the job to INVOICED', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await invoiceFixture(tx, { paymentTerms: 14 })
      const draft = await createInvoice(finance, { jobId: job.id, lines: [line()] }, tx)

      const issued = await transitionInvoice(finance, draft.id, { status: 'ISSUED' }, tx)
      expect(issued.status).toBe('ISSUED')
      expect(issued.payable).toBe(true)
      expect(issued.editable).toBe(false)
      expect(issued.issueDate).not.toBeNull()
      // 14 days after the issue day, as a UTC-midnight day like every date the office types.
      const days =
        (issued.dueDate!.getTime() - new Date(`${issued.issueDate!.toISOString().slice(0, 10)}T00:00:00Z`).getTime()) /
        86_400_000
      expect(days).toBe(14)

      const stored = await tx.job.findUniqueOrThrow({ where: { id: job.id } })
      expect(stored.status).toBe('INVOICED')
      expect(stored.invoicedAt).not.toBeNull()

      const history = await tx.jobStatusHistory.findFirst({ where: { jobId: job.id, toStatus: 'INVOICED' } })
      expect(history?.reason).toContain(draft.number)
      expect(history?.changedById).toBe(finance.userId)
    })
  })

  it('snapshots the GST rate at the moment of issue', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await invoiceFixture(tx)
      const draft = await createInvoice(finance, { jobId: job.id, lines: [line({ unitPrice: 100 })] }, tx)

      // The rate changes between draft and issue; the issue date is when the customer is charged.
      await tx.setting.update({ where: { key: 'gstRate' }, data: { value: 0.1 } })
      const issued = await transitionInvoice(finance, draft.id, { status: 'ISSUED' }, tx)

      expect(issued.gstRate).toBe(0.1)
      // The amount is the one computed at issue, not the draft's 9 cents on the dollar.
      expect(issued.gstAmount).toBeCloseTo(10)
    })
  })

  it('leaves a job that has already moved on where it is', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await invoiceFixture(tx)
      const draft = await createInvoice(finance, { jobId: job.id, lines: [line()] }, tx)
      // Something else completed the paperwork in the meantime.
      await tx.job.update({ where: { id: job.id }, data: { status: 'COMPLETED' } })

      const issued = await transitionInvoice(finance, draft.id, { status: 'ISSUED' }, tx)
      expect(issued.status).toBe('ISSUED')

      const stored = await tx.job.findUniqueOrThrow({ where: { id: job.id } })
      expect(stored.status).toBe('COMPLETED')
    })
  })

  it('refuses to void once money has been recorded, and needs a reason before then', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await invoiceFixture(tx)
      const issued = await issuedInvoice(tx, finance, job.id)

      await expect(
        transitionInvoice(finance, issued.id, { status: 'VOID', reason: '' }, tx),
      ).rejects.toBeTruthy()

      await recordPayment(finance, issued.id, { amount: 50, method: 'CASH' }, tx)
      await expect(
        transitionInvoice(finance, issued.id, { status: 'VOID', reason: 'Raised twice' }, tx),
      ).rejects.toBeInstanceOf(RuleError)

      const stored = await tx.invoice.findUniqueOrThrow({ where: { id: issued.id } })
      expect(stored.status).toBe('PART_PAID')
    })
  })

  it('voids an unpaid invoice, keeping the row and the reason', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await invoiceFixture(tx)
      const draft = await createInvoice(finance, { jobId: job.id, lines: [line()] }, tx)

      const voided = await transitionInvoice(finance, draft.id, { status: 'VOID', reason: 'Wrong job' }, tx)
      expect(voided.status).toBe('VOID')

      const stored = await tx.invoice.findUniqueOrThrow({ where: { id: draft.id } })
      expect(stored.status).toBe('VOID')

      const audit = await tx.auditLog.findFirst({
        where: { entity: 'Invoice', entityId: draft.id, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      })
      expect(audit?.after).toMatchObject({ status: 'VOID', reason: 'Wrong job' })
    })
  })
})

describe('editing an invoice', () => {
  it('replaces the lines of a draft and keeps the job link', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await invoiceFixture(tx)
      const draft = await createInvoice(finance, { jobId: job.id, lines: [line()] }, tx)

      const updated = await updateInvoice(
        finance,
        draft.id,
        { lines: [{ description: 'Full brake service', quantity: 1, unitPrice: 250 }] },
        tx,
      )
      expect(updated.lines).toHaveLength(1)
      expect(updated.lines[0]?.description).toBe('Full brake service')
      expect(updated.subtotal).toBe(250)
      expect(updated.total).toBeCloseTo(272.5)
      expect(updated.job?.id).toBe(job.id)
    })
  })

  it('refuses to edit an issued invoice', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await invoiceFixture(tx)
      const issued = await issuedInvoice(tx, finance, job.id)

      await expect(
        updateInvoice(finance, issued.id, { lines: [line()] }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })
})

describe('recording payments', () => {
  it('turns PART_PAID at a part payment and PAID at the total', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await invoiceFixture(tx)
      const issued = await issuedInvoice(tx, finance, job.id) // 300 + 9% = 327

      const partial = await recordPayment(finance, issued.id, { amount: 100, method: 'PAYNOW' }, tx)
      expect(partial.status).toBe('PART_PAID')
      expect(partial.amountPaid).toBe(100)
      expect(partial.balance).toBeCloseTo(227)
      expect(partial.payments).toHaveLength(1)

      const paid = await recordPayment(
        finance,
        issued.id,
        { amount: 227, method: 'BANK_TRANSFER', reference: 'TX-991' },
        tx,
      )
      expect(paid.status).toBe('PAID')
      expect(paid.amountPaid).toBeCloseTo(327)
      expect(paid.balance).toBe(0)
      expect(paid.payable).toBe(false)

      const stored = await tx.invoice.findUniqueOrThrow({ where: { id: issued.id } })
      expect(Number(stored.amountPaid)).toBeCloseTo(327)
      expect(stored.status).toBe('PAID')

      const audit = await tx.auditLog.findFirst({
        where: { entity: 'Invoice', entityId: issued.id, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      })
      expect(audit?.after).toMatchObject({ status: 'PAID', amountPaid: 327 })
    })
  })

  it('refuses an overpayment and says what is owed', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await invoiceFixture(tx)
      const issued = await issuedInvoice(tx, finance, job.id)

      await expect(
        recordPayment(finance, issued.id, { amount: 400, method: 'CASH' }, tx),
      ).rejects.toBeInstanceOf(RuleError)

      const stored = await tx.invoice.findUniqueOrThrow({ where: { id: issued.id } })
      expect(Number(stored.amountPaid)).toBe(0)
      expect(await tx.payment.count({ where: { invoiceId: issued.id } })).toBe(0)
    })
  })

  it('refuses a payment on a draft invoice', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await invoiceFixture(tx)
      const draft = await createInvoice(finance, { jobId: job.id, lines: [line()] }, tx)

      await expect(
        recordPayment(finance, draft.id, { amount: 10, method: 'CASH' }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })
})

describe('reading the invoice book', () => {
  it('scopes to the caller and totals what is still outstanding', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await invoiceFixture(tx)
      const issued = await issuedInvoice(tx, finance, job.id)
      await recordPayment(finance, issued.id, { amount: 27, method: 'CASH' }, tx)

      const list = await listInvoices(finance, {}, tx)
      expect(list.invoices.map((row) => row.id)).toEqual([issued.id])
      expect(list.counts.PART_PAID).toBe(1)
      expect(list.outstanding).toBeCloseTo(300)
      expect((await invoicesForJob(finance, job.id, tx)).map((row) => row.id)).toEqual([issued.id])

      await expect(getInvoice(finance, 'no-such-id', tx)).rejects.toBeInstanceOf(NotFoundError)

      // A technician reads no invoice at all — the capability is the gate, not the row filter.
      const tech = await technicianFixture(tx, testSuffix())
      const technician = contextFor(tech.user, { technicianId: tech.technician.id })
      await expect(getInvoice(technician, issued.id, tx)).rejects.toBeInstanceOf(ForbiddenError)
      await expect(invoicesForJob(technician, job.id, tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('prices the parts on a job from its stock movements', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job, suffix } = await invoiceFixture(tx)
      const part = await tx.part.create({
        data: {
          partNumber: `ROPE-${suffix}`,
          description: 'Wire rope 8mm',
          uom: 'M',
          cost: 10,
          sellPrice: 20,
        },
      })
      await tx.stockMovement.create({
        data: { partId: part.id, jobId: job.id, type: 'ISSUE', quantity: 3, unitCost: 10 },
      })
      // A receipt is not work done, so it is not offered as an invoice line.
      await tx.stockMovement.create({
        data: { partId: part.id, jobId: job.id, type: 'RECEIVE', quantity: 10 },
      })

      const costing = await jobCosting(finance, job.id, tx)
      expect(costing.parts).toEqual([
        { description: `ROPE-${suffix} — Wire rope 8mm`, quantity: 3, unitPrice: 20 },
      ])
      expect(costing.partsCost).toBe(30)
    })
  })

  it('renders the invoice as a PDF', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { job } = await invoiceFixture(tx)
      const issued = await issuedInvoice(tx, finance, job.id)

      const { filename, bytes } = await renderInvoice(finance, issued.id, tx)
      expect(filename).toBe(`${issued.number}.pdf`)
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    })
  })
})
