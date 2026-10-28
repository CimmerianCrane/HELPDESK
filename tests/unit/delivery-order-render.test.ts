import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { renderDeliveryOrderPdf, type DeliveryOrderPdfInput } from '@/server/documents/delivery-order'

/**
 * The delivery order renderer's contract (slice 18), the same claim `report-render.test.ts` makes for
 * reports: everything volatile is an argument and the document dates are pinned, so the same DO
 * re-renders to the same bytes. That matters because a DO has no stored copy — it is rendered on demand
 * every time somebody downloads it.
 */

function input(overrides: Partial<DeliveryOrderPdfInput> = {}): DeliveryOrderPdfInput {
  return {
    number: 'DO-2026-0003',
    issuedAt: new Date('2026-10-27T02:15:00.000Z'),
    timeZone: 'Asia/Singapore',
    customer: { name: 'Harbour Logistics' },
    job: { number: 'JOB-2026-0042' },
    deliveryAddress: ['12 Jurong Port Road', 'Singapore', '619093'],
    receiverName: null,
    receivedAt: null,
    signature: null,
    lines: [
      {
        description: 'WR-12 — Wire rope, 12 mm, 100 m coil',
        quantity: 2,
        receivedQuantity: 0,
        serialOrBatch: 'LOT-7781',
        condition: 'New, sealed',
        chargeType: 'LOAN',
        expectedReturnDate: new Date('2026-11-10T00:00:00.000Z'),
      },
    ],
    ...overrides,
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('rendering a delivery order PDF', () => {
  it('produces the same bytes twice for the same input', async () => {
    const first = await renderDeliveryOrderPdf(input())
    const second = await renderDeliveryOrderPdf(input())

    expect(first.subarray(0, 5).toString()).toBe('%PDF-')
    expect(first.byteLength).toBeGreaterThan(800)
    expect(sha256(second)).toBe(sha256(first))
  })

  it('renders a different document once it has been signed for', async () => {
    // The DO mutates as it is receipted, which is the reason there is no stored copy to go stale.
    const unsigned = await renderDeliveryOrderPdf(input())
    const signed = await renderDeliveryOrderPdf(
      input({
        receiverName: 'Mei Ling',
        receivedAt: new Date('2026-10-27T06:30:00.000Z'),
        lines: [{ ...input().lines[0]!, receivedQuantity: 2 }],
      }),
    )
    expect(sha256(signed)).not.toBe(sha256(unsigned))
  })

  it('renders without a job, which a customer-level delivery can be', async () => {
    const bytes = await renderDeliveryOrderPdf(input({ job: null }))
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
