import { describe, expect, it } from 'vitest'
import {
  balanceCents,
  canMoveInvoice,
  createInvoiceSchema,
  isInvoiceEditable,
  isInvoiceOverdue,
  isInvoicePayable,
  paidStatusFor,
  recordPaymentSchema,
  voidInvoiceSchema,
} from '@/lib/validation/invoices'
import { documentTotals } from '@/lib/validation/money'

/**
 * The invoice rules (slice 20): the status flow, the derived paid status and the overdue day boundary.
 *
 * The money arithmetic itself is `documentTotals`, shared with quotes and pinned in
 * `tests/unit/quotes.test.ts` — one implementation, tested once.
 */

describe('invoice status flow', () => {
  it('lets a draft be issued or voided, and nothing else move', () => {
    expect(canMoveInvoice('DRAFT', 'ISSUED')).toBe(true)
    expect(canMoveInvoice('DRAFT', 'VOID')).toBe(true)
    expect(canMoveInvoice('ISSUED', 'VOID')).toBe(true)
    expect(canMoveInvoice('ISSUED', 'PAID')).toBe(false)
    expect(canMoveInvoice('PART_PAID', 'VOID')).toBe(false)
    expect(canMoveInvoice('PAID', 'VOID')).toBe(false)
    expect(canMoveInvoice('VOID', 'ISSUED')).toBe(false)
  })

  it('only edits and takes payment at the right moments', () => {
    expect(isInvoiceEditable('DRAFT')).toBe(true)
    expect(isInvoiceEditable('ISSUED')).toBe(false)
    expect(isInvoicePayable('ISSUED')).toBe(true)
    expect(isInvoicePayable('PART_PAID')).toBe(true)
    expect(isInvoicePayable('DRAFT')).toBe(false)
    expect(isInvoicePayable('VOID')).toBe(false)
    expect(isInvoicePayable('PAID')).toBe(false)
  })
})

describe('the paid status follows the money', () => {
  it('reads issued with nothing paid, part paid in between, and paid at the total', () => {
    expect(paidStatusFor(10_900, 0)).toBe('ISSUED')
    expect(paidStatusFor(10_900, 5_000)).toBe('PART_PAID')
    expect(paidStatusFor(10_900, 10_900)).toBe('PAID')
  })

  it('keeps the balance at zero rather than negative', () => {
    expect(balanceCents(10_900, 5_000)).toBe(5_900)
    expect(balanceCents(10_900, 10_900)).toBe(0)
    expect(balanceCents(10_900, 12_000)).toBe(0)
  })
})

describe('overdue is derived from the due date', () => {
  const singapore = 'Asia/Singapore'

  it('is not overdue on the due day, in the operating timezone', () => {
    // 2026-10-28 00:00 UTC is 08:00 on the 28th in Singapore — still the due day.
    const invoice = { status: 'ISSUED' as const, dueDate: new Date('2026-10-28T00:00:00Z') }
    expect(isInvoiceOverdue(invoice, new Date('2026-10-28T05:00:00Z'), singapore)).toBe(false)
  })

  it('is overdue the next day', () => {
    const invoice = { status: 'ISSUED' as const, dueDate: new Date('2026-10-28T00:00:00Z') }
    expect(isInvoiceOverdue(invoice, new Date('2026-10-29T05:00:00Z'), singapore)).toBe(true)
  })

  it('never marks a draft, a void or an invoice with no due date', () => {
    const past = new Date('2026-01-01T00:00:00Z')
    const now = new Date('2026-10-28T00:00:00Z')
    expect(isInvoiceOverdue({ status: 'DRAFT', dueDate: past }, now, singapore)).toBe(false)
    expect(isInvoiceOverdue({ status: 'VOID', dueDate: past }, now, singapore)).toBe(false)
    expect(isInvoiceOverdue({ status: 'PAID', dueDate: past }, now, singapore)).toBe(false)
    expect(isInvoiceOverdue({ status: 'ISSUED', dueDate: null }, now, singapore)).toBe(false)
  })
})

describe('invoice input', () => {
  it('accepts lines and requires a job', () => {
    const parsed = createInvoiceSchema.safeParse({
      jobId: 'job-1',
      lines: [{ description: '4 hours on site', quantity: '4', unitPrice: '120' }],
    })
    expect(parsed.success).toBe(true)
  })

  it('refuses an empty invoice', () => {
    expect(createInvoiceSchema.safeParse({ jobId: 'job-1', lines: [] }).success).toBe(false)
  })

  it('refuses a negative price', () => {
    const parsed = createInvoiceSchema.safeParse({
      jobId: 'job-1',
      lines: [{ description: 'Credit', quantity: '1', unitPrice: '-5' }],
    })
    expect(parsed.success).toBe(false)
  })

  it('needs a reason to void', () => {
    expect(voidInvoiceSchema.safeParse({ reason: '' }).success).toBe(false)
    expect(voidInvoiceSchema.safeParse({ reason: 'Raised in error' }).success).toBe(true)
  })

  it('refuses a zero payment', () => {
    expect(recordPaymentSchema.safeParse({ amount: '0', method: 'CASH' }).success).toBe(false)
    expect(recordPaymentSchema.safeParse({ amount: '20', method: 'CASH' }).success).toBe(true)
  })
})

describe('the shared arithmetic', () => {
  it('prices an invoice exactly as it prices a quote', () => {
    const totals = documentTotals([{ quantity: 2, unitPrice: 150 }], 0.09)
    expect(totals.subtotalCents).toBe(30_000)
    expect(totals.gstCents).toBe(2_700)
    expect(totals.totalCents).toBe(32_700)
  })
})
