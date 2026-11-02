import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { renderQuotePdf, type QuotePdfInput } from '@/server/documents/quote'

/**
 * The quotation renderer's contract (slice 19), the same claim the delivery-order renderer makes:
 * everything volatile is an argument and the document dates are pinned, so an unchanged quote
 * re-renders to the same bytes.
 */

function input(overrides: Partial<QuotePdfInput> = {}): QuotePdfInput {
  return {
    number: 'QTE-2026-0007',
    createdAt: new Date('2026-10-27T02:15:00.000Z'),
    timeZone: 'Asia/Singapore',
    currency: 'SGD',
    customer: { name: 'Harbour Logistics' },
    job: { number: 'JOB-2026-0042' },
    validUntil: new Date('2026-11-26T00:00:00.000Z'),
    status: 'SENT',
    notes: 'Prices include a two-year warranty on the replacement brake unit.',
    gstRate: 0.09,
    subtotal: 380,
    gstAmount: 34.2,
    total: 414.2,
    lines: [
      {
        description: 'Replace hoist brake pads',
        quantity: 2,
        unitPrice: 150,
        lineTotal: 300,
        isVariation: false,
      },
      { description: 'Additional counterweight', quantity: 1, unitPrice: 80, lineTotal: 80, isVariation: true },
    ],
    ...overrides,
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('rendering a quotation PDF', () => {
  it('produces the same bytes twice for the same input', async () => {
    const first = await renderQuotePdf(input())
    const second = await renderQuotePdf(input())

    expect(first.subarray(0, 5).toString()).toBe('%PDF-')
    expect(first.byteLength).toBeGreaterThan(800)
    expect(sha256(second)).toBe(sha256(first))
  })

  it('renders a different document when a price changes', async () => {
    const original = await renderQuotePdf(input())
    const repriced = await renderQuotePdf(
      input({ lines: [{ ...input().lines[0]!, unitPrice: 160, lineTotal: 320 }], total: 434.2 }),
    )
    expect(sha256(repriced)).not.toBe(sha256(original))
  })

  it('renders a quote with no job and no expiry', async () => {
    const bytes = await renderQuotePdf(input({ job: null, validUntil: null, notes: null }))
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
