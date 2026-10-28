import { describe, expect, it } from 'vitest'
import {
  addMonths,
  daysUntil,
  dueBucket,
  isOverdue,
  recomputeNextDue,
} from '@/server/schedules/recurrence'

/**
 * Schedule recurrence without a database (slice 12).
 *
 * A wrong month here is not a visible crash — it is a servicing visit that arrives a month early or a
 * statutory examination that silently lapses, discovered weeks later. So each boundary is pinned.
 */

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('addMonths', () => {
  it('adds whole months on the same day number', () => {
    expect(addMonths(utc('2026-01-15'), 1).toISOString()).toBe('2026-02-15T00:00:00.000Z')
  })

  it('clamps 31 January to the end of February, not into March', () => {
    expect(addMonths(utc('2026-01-31'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z')
  })

  it('clamps to 29 February in a leap year', () => {
    expect(addMonths(utc('2028-01-31'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z')
  })

  it('adds twelve months across the year boundary', () => {
    expect(addMonths(utc('2026-03-01'), 12).toISOString()).toBe('2027-03-01T00:00:00.000Z')
  })

  it('does not mutate its input', () => {
    const date = utc('2026-01-31')
    addMonths(date, 1)
    expect(date.toISOString()).toBe('2026-01-31T00:00:00.000Z')
  })
})

describe('recomputeNextDue', () => {
  it('derives the next due date from the last done date and the interval', () => {
    expect(
      recomputeNextDue({
        intervalMonths: 12,
        lastDoneDate: utc('2026-04-10'),
        nextDueDate: utc('2027-01-01'),
      })?.toISOString(),
    ).toBe('2027-04-10T00:00:00.000Z')
  })

  it('keeps the typed date when there is no interval (a one-off obligation)', () => {
    expect(
      recomputeNextDue({
        intervalMonths: null,
        lastDoneDate: utc('2026-04-10'),
        nextDueDate: utc('2027-01-01'),
      })?.toISOString(),
    ).toBe('2027-01-01T00:00:00.000Z')
  })

  it('keeps the typed date when nothing has been done yet', () => {
    expect(
      recomputeNextDue({ intervalMonths: 6, lastDoneDate: null, nextDueDate: utc('2026-05-01') })
        ?.toISOString(),
    ).toBe('2026-05-01T00:00:00.000Z')
  })

  it('returns null when there is nothing to go on', () => {
    expect(recomputeNextDue({ intervalMonths: 6, lastDoneDate: null, nextDueDate: null })).toBeNull()
  })
})

describe('isOverdue', () => {
  const now = utc('2026-10-28')

  it('is overdue the day after the due date', () => {
    expect(isOverdue({ nextDueDate: utc('2026-10-27') }, now)).toBe(true)
  })

  it('is not overdue on the due date itself', () => {
    expect(isOverdue({ nextDueDate: utc('2026-10-28') }, now)).toBe(false)
  })

  it('compares calendar days, not instants, so a late-evening due time still counts as today', () => {
    expect(isOverdue({ nextDueDate: new Date('2026-10-28T23:59:00.000Z') }, now)).toBe(false)
  })

  it('treats an undated schedule as unconfigured, not overdue', () => {
    expect(isOverdue({ nextDueDate: null }, now)).toBe(false)
  })
})

describe('daysUntil and dueBucket', () => {
  const now = utc('2026-10-28')

  it('counts whole days either side of today', () => {
    expect(daysUntil(utc('2026-11-07'), now)).toBe(10)
    expect(daysUntil(utc('2026-10-18'), now)).toBe(-10)
    expect(daysUntil(utc('2026-10-28'), now)).toBe(0)
  })

  it('buckets each boundary on the inclusive side', () => {
    expect(dueBucket(utc('2026-10-27'), now)).toBe('overdue')
    expect(dueBucket(utc('2026-10-28'), now)).toBe('30')
    expect(dueBucket(utc('2026-11-27'), now)).toBe('30')
    expect(dueBucket(utc('2026-11-28'), now)).toBe('60')
    expect(dueBucket(utc('2026-12-27'), now)).toBe('60')
    expect(dueBucket(utc('2026-12-28'), now)).toBe('90')
    expect(dueBucket(utc('2027-01-26'), now)).toBe('90')
    expect(dueBucket(utc('2027-01-27'), now)).toBe('later')
    expect(dueBucket(null, now)).toBe('none')
  })
})
