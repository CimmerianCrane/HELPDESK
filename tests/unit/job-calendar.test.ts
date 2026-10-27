import { describe, expect, it } from 'vitest'
import {
  calendarDays,
  calendarMonth,
  calendarRange,
  monthRange,
  shiftMonth,
} from '@/server/jobs/calendar'
import type { JobSummary } from '@/server/jobs/jobs'

/**
 * The job calendar (slice 10). Pure arithmetic over dates and a timezone, so the things that go wrong
 * in a calendar — a six-week grid that shifts, a visit filed on the wrong square because UTC and
 * Singapore disagree about which day it is — are testable without a browser.
 */

const TZ = 'Asia/Singapore'

/** Only the fields the calendar reads, so a test does not have to build a whole `JobSummary`. */
function job(id: string, scheduledStart: Date | null, priority: 'P1' | 'P2' | 'P3' | 'P4' = 'P3') {
  return { id, scheduledStart, priority } as JobSummary
}

describe('the calendar month', () => {
  it('accepts a real month and falls back to the current one', () => {
    expect(calendarMonth('2026-02', new Date('2026-10-27T00:00:00Z'))).toBe('2026-02')
    expect(calendarMonth('2026-13', new Date('2026-10-27T00:00:00Z'))).toBe('2026-10')
    expect(calendarMonth(undefined, new Date('2026-10-27T00:00:00Z'))).toBe('2026-10')
  })

  it('always shows six weeks, starting on a Monday', () => {
    for (const month of ['2026-02', '2026-03', '2026-08', '2027-01']) {
      const days = calendarDays(month, [], TZ, new Date('2026-10-27T00:00:00Z'))
      expect(days).toHaveLength(42)
      // 2026-03-01 is a Sunday; the grid must start on 2026-02-23 (a Monday) and not on the 1st.
      expect(new Date(`${days[0]!.date}T00:00:00Z`).getUTCDay()).toBe(1)
    }
  })

  it('marks the days either side of the month as outside', () => {
    const days = calendarDays('2026-02', [], TZ, new Date('2026-10-27T00:00:00Z'))
    const inside = days.filter((day) => !day.outside)
    expect(inside).toHaveLength(28)
    expect(inside[0]!.date).toBe('2026-02-01')
    expect(inside.at(-1)!.date).toBe('2026-02-28')
  })

  it('files a visit by its wall date, not its UTC date', () => {
    // 08:00 on 5 March in Singapore is 00:00 UTC on the same day; 23:30 is 15:30 UTC. The interesting
    // case is 00:30 local, which is 16:30 UTC the previous day: a UTC key files it under the 4th.
    const lateEvening = new Date('2026-03-05T15:30:00Z') // 23:30 local on the 5th
    const justAfterMidnight = new Date('2026-03-04T16:30:00Z') // 00:30 local on the 5th

    const days = calendarDays(
      '2026-03',
      [job('a', lateEvening), job('b', justAfterMidnight)],
      TZ,
      new Date('2026-10-27T00:00:00Z'),
    )
    const fifth = days.find((day) => day.date === '2026-03-05')!
    expect(fifth.jobs.map((entry) => entry.id).sort()).toEqual(['a', 'b'])
    expect(days.find((day) => day.date === '2026-03-04')!.jobs).toHaveLength(0)
  })

  it('leaves undated jobs off the grid, and puts P1 first inside a day', () => {
    const at = new Date('2026-03-05T02:00:00Z')
    const days = calendarDays(
      '2026-03',
      [job('late', at, 'P3'), job('dead', at, 'P1'), job('undated', null)],
      TZ,
      new Date('2026-10-27T00:00:00Z'),
    )
    const fifth = days.find((day) => day.date === '2026-03-05')!
    expect(fifth.jobs.map((entry) => entry.id)).toEqual(['dead', 'late'])
  })

  it('marks today', () => {
    const now = new Date('2026-10-27T03:00:00Z') // 11:00 in Singapore
    const days = calendarDays('2026-10', [], TZ, now)
    expect(days.filter((day) => day.isToday).map((day) => day.date)).toEqual(['2026-10-27'])
  })
})

describe('the calendar bounds', () => {
  it('steps months across a year boundary in both directions', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })

  it('bounds a month as half-open instants in the operating timezone', () => {
    const { from, to } = monthRange('2026-03', TZ)
    // 1 March 00:00 Singapore is 16:00 UTC on 28 February.
    expect(from.toISOString()).toBe('2026-02-28T16:00:00.000Z')
    expect(to.toISOString()).toBe('2026-03-31T16:00:00.000Z')
  })

  it('bounds the six-week grid wider than the month it shows', () => {
    const month = monthRange('2026-03', TZ)
    const grid = calendarRange('2026-03', TZ)
    expect(grid.from.getTime()).toBeLessThan(month.from.getTime())
    expect(grid.to.getTime()).toBeGreaterThan(month.to.getTime())
  })
})
