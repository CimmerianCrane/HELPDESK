import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { renderInvoicePdf, type InvoicePdfInput } from '@/server/documents/invoice'

/**
 * The invoice renderer's contract (slice 20), the same claim the quote and delivery-order renderers
 * make: everything volatile is an argument and the document dates are pinned, so an unchanged invoice
 * re-renders to the same bytes.
 */

function input(overrides: Partial<InvoicePdfInput> = {}): InvoicePdfInput {
  return {
    number: 'INV-2026-0011',
    createdAt: new Date('2026-10-27T02:15:00.000Z'),
    issueDate: new Date('2026-10-28T00:00:00.000Z'),
    dueDate: new Date('2026-11-27T00:00:00.000Z'),
    timeZone: 'Asia/Singapore',
    currency: 'SGD',
    customer: { name: 'Harbour Logistics' },
    job: { number: 'JOB-2026-0042' },
    status: 'ISSUED',
    gstRate: 0.09,
    subtotal: 380,
    gstAmount: 34.2,
    total: 414.2,
    amountPaid: 0,
    lines: [{ description: 'Replace hoist brake pads', quantity: 2, unitPrice: 150, lineTotal: 300 }],
    ...overrides,
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('rendering an invoice PDF', () => {
  it('produces the same bytes twice for the same input', async () => {
    const first = await renderInvoicePdf(input())
    const second = await renderInvoicePdf(input())

    expect(first.subarray(0, 5).toString()).toBe('%PDF-')
    expect(first.byteLength).toBeGreaterThan(800)
    expect(sha256(second)).toBe(sha256(first))
  })

  it('renders a different document when a payment is recorded', async () => {
    const unpaid = await renderInvoicePdf(input())
    const partlyPaid = await renderInvoicePdf(input({ status: 'PART_PAID', amountPaid: 100 }))
    expect(sha256(partlyPaid)).not.toBe(sha256(unpaid))
  })

  it('renders a draft with no issue date and no job', async () => {
    const bytes = await renderInvoicePdf(
      input({ status: 'DRAFT', issueDate: null, dueDate: null, job: null }),
    )
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
