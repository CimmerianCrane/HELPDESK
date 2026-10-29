import { describe, expect, it } from 'vitest'
import { can } from '@/server/auth/permissions'
import {
  purchaseOrderStatusFor,
  raisePurchaseOrderSchema,
  receivePurchaseOrderSchema,
  remainingOnOrder,
  suggestedOrderQuantity,
} from '@/lib/validation/purchase-orders'

/**
 * The two pure rules behind reorder and purchase orders (slice 25): what to order, and what a receipt
 * makes the order. Both are read by the screen before any database round trip.
 */

describe('the suggested order quantity', () => {
  it("uses the store's standing order size when it set one", () => {
    expect(suggestedOrderQuantity(2, 10, 20)).toBe(20)
  })

  it('orders the shortfall when there is no standing size', () => {
    expect(suggestedOrderQuantity(4, 10, null)).toBe(6)
  })

  it('orders a negative shelf back past the level, not just up to zero', () => {
    expect(suggestedOrderQuantity(-3, 10, null)).toBe(13)
  })

  it('suggests nothing when no level is set', () => {
    expect(suggestedOrderQuantity(0, null, 20)).toBe(0)
  })
})

describe('the status a receipt produces', () => {
  it('stays draft until something arrives', () => {
    expect(purchaseOrderStatusFor([{ quantity: 5, received: 0 }])).toBe('DRAFT')
  })

  it('is partial when some of the order arrived', () => {
    expect(
      purchaseOrderStatusFor([
        { quantity: 5, received: 5 },
        { quantity: 3, received: 1 },
      ]),
    ).toBe('PARTIAL')
  })

  it('is received when every line is whole', () => {
    expect(
      purchaseOrderStatusFor([
        { quantity: 5, received: 5 },
        { quantity: 3, received: 3 },
      ]),
    ).toBe('RECEIVED')
  })

  it('has no lines to judge', () => {
    expect(purchaseOrderStatusFor([])).toBe('DRAFT')
  })
})

describe('what is still owed on a line', () => {
  it('is the order less the receipts', () => {
    expect(remainingOnOrder(10, 4)).toBe(6)
  })

  it('never goes below zero', () => {
    expect(remainingOnOrder(10, 12)).toBe(0)
  })
})

describe('the forms', () => {
  it('reads a blank quantity as zero and keeps a real one', () => {
    const parsed = raisePurchaseOrderSchema.parse({
      expectedAt: '2026-11-04',
      lines: [
        { partId: 'p1', quantity: '' },
        { partId: 'p2', quantity: '12.5' },
      ],
    })

    expect(parsed.lines.map((line) => line.quantity)).toEqual([0, 12.5])
    expect(parsed.expectedAt?.toISOString()).toBe('2026-11-04T00:00:00.000Z')
  })

  it('leaves an expected date as null when the store does not know it', () => {
    const parsed = raisePurchaseOrderSchema.parse({
      expectedAt: '',
      lines: [{ partId: 'p1', quantity: '1' }],
    })
    expect(parsed.expectedAt).toBeNull()
  })

  it('refuses a date that is not a real day', () => {
    const result = raisePurchaseOrderSchema.safeParse({
      expectedAt: '2026-02-31',
      lines: [{ partId: 'p1', quantity: '1' }],
    })
    expect(result.success).toBe(false)
  })

  it('refuses a negative receive quantity', () => {
    const result = receivePurchaseOrderSchema.safeParse({
      locationId: '',
      lines: [{ lineId: 'l1', received: '-1', serialOrBatch: '' }],
    })
    expect(result.success).toBe(false)
  })

  it('turns blank optional text into null rather than an empty string', () => {
    const parsed = receivePurchaseOrderSchema.parse({
      locationId: '',
      lines: [{ lineId: 'l1', received: '4', serialOrBatch: '' }],
    })
    expect(parsed.locationId).toBeNull()
    expect(parsed.lines[0]).toMatchObject({ received: 4, serialOrBatch: null })
  })
})

describe('who may order', () => {
  it('lets the store raise and receive purchase orders', () => {
    expect(can('STOREKEEPER', 'purchaseorder.write')).toBe(true)
    expect(can('ADMIN', 'purchaseorder.write')).toBe(true)
  })

  it('does not let dispatch or finance buy stock', () => {
    expect(can('DISPATCHER', 'purchaseorder.write')).toBe(false)
    expect(can('FINANCE', 'purchaseorder.write')).toBe(false)
    expect(can('TECHNICIAN', 'purchaseorder.write')).toBe(false)
  })
})
