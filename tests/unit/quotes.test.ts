import { describe, expect, it } from 'vitest'
import {
  canMoveQuote,
  createQuoteSchema,
  effectiveQuoteStatus,
  quoteTotals,
  quoteTransitionSchema,
} from '@/lib/validation/quotes'

/**
 * Quote rules (slice 19): the money arithmetic, the status flow and the derived expiry.
 *
 * The money cases are the ones a screen cannot show: per-line rounding before the subtotal, GST on
 * the rounded subtotal, and a half-cent never reaching the customer's copy. The expiry cases pin the
 * day boundary to the operating timezone, which is where "valid until today" must still be valid.
 */

describe('quote totals', () => {
  it('adds GST to the subtotal at the stored rate', () => {
    const totals = quoteTotals([{ quantity: 1, unitPrice: 100 }], 0.09)
    expect(totals.lineTotalsCents).toEqual([10_000])
    expect(totals.subtotalCents).toBe(10_000)
    expect(totals.gstCents).toBe(900)
    expect(totals.totalCents).toBe(10_900)
  })

  it('rounds each line before summing, and GST on the rounded subtotal', () => {
    const totals = quoteTotals(
      [
        { quantity: 3, unitPrice: 33.33 },
        { quantity: 0.5, unitPrice: 10 },
      ],
      0.09,
    )
    expect(totals.lineTotalsCents).toEqual([9_999, 500])
    expect(totals.subtotalCents).toBe(10_499)
    // 10499 × 0.09 = 944.91 cents
    expect(totals.gstCents).toBe(945)
    expect(totals.totalCents).toBe(11_444)
  })

  it('rounds a fractional quantity to the nearest cent on the line', () => {
    const totals = quoteTotals([{ quantity: 0.333, unitPrice: 3 }], 0.09)
    expect(totals.lineTotalsCents).toEqual([100])
  })

  it('charges no GST when the rate is zero', () => {
    const totals = quoteTotals([{ quantity: 2, unitPrice: 75 }], 0)
    expect(totals.subtotalCents).toBe(15_000)
    expect(totals.gstCents).toBe(0)
    expect(totals.totalCents).toBe(15_000)
  })
})

describe('the quote status flow', () => {
  it('sends from draft and answers only from sent', () => {
    expect(canMoveQuote('DRAFT', 'SENT')).toBe(true)
    expect(canMoveQuote('DRAFT', 'ACCEPTED')).toBe(false)
    expect(canMoveQuote('SENT', 'ACCEPTED')).toBe(true)
    expect(canMoveQuote('SENT', 'DECLINED')).toBe(true)
    expect(canMoveQuote('ACCEPTED', 'DECLINED')).toBe(false)
    expect(canMoveQuote('DECLINED', 'ACCEPTED')).toBe(false)
  })

  it('never lets a caller post EXPIRED — the date produces it', () => {
    expect(canMoveQuote('SENT', 'EXPIRED')).toBe(false)
    expect(quoteTransitionSchema.safeParse({ status: 'EXPIRED' }).success).toBe(false)
    expect(quoteTransitionSchema.safeParse({ status: 'ACCEPTED' }).success).toBe(true)
  })
})

describe('quote expiry', () => {
  const singapore = 'Asia/Singapore'
  const validUntil = new Date('2026-10-28T00:00:00.000Z')

  it('leaves a draft alone whatever its date', () => {
    expect(
      effectiveQuoteStatus(
        { status: 'DRAFT', validUntil },
        new Date('2026-11-30T00:00:00.000Z'),
        singapore,
      ),
    ).toBe('DRAFT')
  })

  it('is still valid on the last day, in the operating timezone', () => {
    // 15:00 UTC is 23:00 in Singapore on the 28th — still the valid-until day.
    expect(
      effectiveQuoteStatus({ status: 'SENT', validUntil }, new Date('2026-10-28T15:00:00.000Z'), singapore),
    ).toBe('SENT')
    // 16:30 UTC is 00:30 on the 29th in Singapore — one day past.
    expect(
      effectiveQuoteStatus({ status: 'SENT', validUntil }, new Date('2026-10-28T16:30:00.000Z'), singapore),
    ).toBe('EXPIRED')
  })

  it('never expires a sent quote with no validity date', () => {
    expect(
      effectiveQuoteStatus(
        { status: 'SENT', validUntil: null },
        new Date('2030-01-01T00:00:00.000Z'),
        singapore,
      ),
    ).toBe('SENT')
  })

  it('does not re-expire an accepted quote', () => {
    expect(
      effectiveQuoteStatus(
        { status: 'ACCEPTED', validUntil },
        new Date('2027-01-01T00:00:00.000Z'),
        singapore,
      ),
    ).toBe('ACCEPTED')
  })
})

describe('quote input', () => {
  it('requires at least one described line', () => {
    expect(
      createQuoteSchema.safeParse({ jobId: 'job-1', lines: [] }).success,
    ).toBe(false)
    expect(
      createQuoteSchema.safeParse({ jobId: 'job-1', lines: [{ description: '', quantity: 1, unitPrice: 1 }] })
        .success,
    ).toBe(false)
  })

  it('turns the variation flag into a boolean and defaults it to false', () => {
    const parsed = createQuoteSchema.parse({
      jobId: 'job-1',
      lines: [
        { description: 'Brake pads', quantity: '2', unitPrice: '150.00', isVariation: 'yes' },
        { description: 'Callout', quantity: '1', unitPrice: '80' },
      ],
    })
    expect(parsed.lines.map((line) => line.isVariation)).toEqual([true, false])
    expect(parsed.lines.map((line) => line.quantity)).toEqual([2, 1])
  })

  it('refuses a negative price, a zero quantity and an impossible date', () => {
    expect(
      createQuoteSchema.safeParse({
        jobId: 'job-1',
        lines: [{ description: 'Brake pads', quantity: 1, unitPrice: -1 }],
      }).success,
    ).toBe(false)
    expect(
      createQuoteSchema.safeParse({
        jobId: 'job-1',
        lines: [{ description: 'Brake pads', quantity: 0, unitPrice: 10 }],
      }).success,
    ).toBe(false)
    expect(
      createQuoteSchema.safeParse({
        jobId: 'job-1',
        validUntil: '2026-02-30',
        lines: [{ description: 'Brake pads', quantity: 1, unitPrice: 10 }],
      }).success,
    ).toBe(false)
  })
})
