import { describe, expect, it } from 'vitest'
import {
  approveStockTakeSchema,
  recordCountsSchema,
  stockTakeStatusFor,
  varianceFor,
} from '@/lib/validation/stock-takes'

/**
 * The stock take's pure rules (slice 26). The sign of a variance is the whole point: get it backwards
 * and every correction doubles the error it was written to fix, so it is pinned here rather than
 * trusted to a screen.
 */

describe('varianceFor', () => {
  it('is counted less system, so positive is stock the books did not have', () => {
    expect(varianceFor(7, 10)).toBe(-3)
    expect(varianceFor(12, 10)).toBe(2)
    expect(varianceFor(10, 10)).toBe(0)
  })

  it('rounds to the ledger precision', () => {
    expect(varianceFor(1.0004, 0)).toBe(1)
    expect(varianceFor(1.0005, 0)).toBe(1.001)
    expect(varianceFor(2.25, 1.5)).toBe(0.75)
  })
})

describe('stockTakeStatusFor', () => {
  /** An empty session is a result: the books show nothing there, so there is nothing left to count. */
  it('is REVIEW for an empty session', () => {
    expect(stockTakeStatusFor([])).toBe('REVIEW')
  })

  it('is DRAFT until something is counted', () => {
    expect(stockTakeStatusFor([{ countedQty: null }, { countedQty: null }])).toBe('DRAFT')
  })

  it('is COUNTING while some lines remain', () => {
    expect(stockTakeStatusFor([{ countedQty: 3 }, { countedQty: null }])).toBe('COUNTING')
  })

  it('is REVIEW once every line has a count, including a zero', () => {
    expect(stockTakeStatusFor([{ countedQty: 0 }, { countedQty: 4 }])).toBe('REVIEW')
  })
})

describe('recordCountsSchema', () => {
  it('reads a blank as uncounted, not as zero', () => {
    const parsed = recordCountsSchema.parse({ lines: [{ lineId: 'a', counted: '' }] })
    expect(parsed.lines[0]?.counted).toBeNull()
  })

  it('keeps a typed zero as a real answer', () => {
    const parsed = recordCountsSchema.parse({ lines: [{ lineId: 'a', counted: '0' }] })
    expect(parsed.lines[0]?.counted).toBe(0)
  })

  it('rejects a negative count rather than posting one', () => {
    const parsed = recordCountsSchema.parse({ lines: [{ lineId: 'a', counted: '-2' }] })
    expect(parsed.lines[0]?.counted).toBeNull()
  })
})

describe('approveStockTakeSchema', () => {
  it('treats a blank reason as none', () => {
    expect(approveStockTakeSchema.parse({ reasonCode: '' }).reasonCode).toBeNull()
    expect(approveStockTakeSchema.parse({}).reasonCode).toBeNull()
  })
})
