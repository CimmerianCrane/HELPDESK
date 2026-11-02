import { describe, expect, it } from 'vitest'
import {
  boardWindow,
  checkCompetency,
  dayKey,
  defaultVisitSpan,
  isoDay,
  jobConflicts,
  onCallGaps,
  parseIsoDay,
  spansOverlap,
  wallTimeToUtc,
  weekDays,
  type BoardJob,
  type BoardTechnician,
} from '@/server/schedule/board'

/**
 * The scheduling rules, without a database.
 *
 * These are the checks a dispatcher makes in their head a hundred times a day — is this person
 * already busy, are they on leave, does an overnight shift leave a hole — so getting them subtly
 * wrong is invisible until somebody misses a P1. Everything here is a pure function for exactly that
 * reason.
 */

const at = (iso: string) => new Date(iso)

function technician(overrides: Partial<BoardTechnician> = {}): BoardTechnician {
  return {
    id: 'tech-1',
    name: 'Ahmad',
    colour: null,
    employeeNo: 'T-001',
    competencyNames: [],
    unavailability: [],
    ...overrides,
  }
}

function job(overrides: Partial<BoardJob> = {}): BoardJob {
  return {
    id: 'job-1',
    number: 'JOB-2026-0001',
    status: 'SCHEDULED',
    priority: 'P3',
    scheduledStart: at('2026-10-26T08:00:00Z'),
    scheduledEnd: at('2026-10-26T10:00:00Z'),
    technicianIds: ['tech-1'],
    ...overrides,
  }
}

describe('spansOverlap', () => {
  it('treats a handover as free: ending when the next starts is not a clash', () => {
    expect(
      spansOverlap(
        { start: at('2026-10-26T08:00:00Z'), end: at('2026-10-26T10:00:00Z') },
        { start: at('2026-10-26T10:00:00Z'), end: at('2026-10-26T12:00:00Z') },
      ),
    ).toBe(false)
  })

  it('finds a genuine overlap', () => {
    expect(
      spansOverlap(
        { start: at('2026-10-26T08:00:00Z'), end: at('2026-10-26T10:00:00Z') },
        { start: at('2026-10-26T09:59:00Z'), end: at('2026-10-26T12:00:00Z') },
      ),
    ).toBe(true)
  })

  it('treats an unbounded side as extending forever', () => {
    expect(
      spansOverlap(
        { start: at('2026-10-26T08:00:00Z'), end: null },
        { start: at('2030-01-01T00:00:00Z'), end: at('2030-01-02T00:00:00Z') },
      ),
    ).toBe(true)
  })

  it('treats a job with no dates as not on the board at all', () => {
    expect(
      spansOverlap({ start: null, end: null }, { start: at('2026-10-26T08:00:00Z'), end: null }),
    ).toBe(false)
  })

  it('treats a zero-length span as a point that touches nothing', () => {
    expect(
      spansOverlap(
        { start: at('2026-10-26T09:00:00Z'), end: at('2026-10-26T09:00:00Z') },
        { start: at('2026-10-26T08:00:00Z'), end: at('2026-10-26T10:00:00Z') },
      ),
    ).toBe(false)
  })
})

describe('jobConflicts', () => {
  it('flags a double booking against another job for the same person', () => {
    const other = job({ id: 'job-2', number: 'JOB-2026-0002' })
    const conflicts = jobConflicts(job(), [technician()], [job(), other])

    expect(conflicts.map((conflict) => conflict.kind)).toContain('double-booked')
    expect(conflicts[0]?.message).toContain('JOB-2026-0002')
  })

  it('ignores an undated job when looking for clashes', () => {
    const undated = job({ id: 'job-2', scheduledStart: null, scheduledEnd: null })
    const conflicts = jobConflicts(job(), [technician()], [job(), undated])
    expect(conflicts.some((conflict) => conflict.kind === 'double-booked')).toBe(false)
  })

  it("flags a clash with the technician's leave, naming the reason", () => {
    const onLeave = technician({
      unavailability: [
        {
          id: 'leave-1',
          startAt: at('2026-10-26T00:00:00Z'),
          endAt: at('2026-10-27T00:00:00Z'),
          reason: 'Annual leave',
        },
      ],
    })
    const conflicts = jobConflicts(job(), [onLeave], [job()])

    expect(conflicts.map((conflict) => conflict.kind)).toContain('on-leave')
    expect(conflicts.find((conflict) => conflict.kind === 'on-leave')?.message).toContain(
      'Annual leave',
    )
  })

  it('flags a job with no dates and a job with nobody on it', () => {
    const conflicts = jobConflicts(
      job({ scheduledStart: null, scheduledEnd: null, technicianIds: [] }),
      [technician()],
      [],
    )
    expect(conflicts.map((conflict) => conflict.kind).sort()).toEqual(['no-dates', 'unassigned'])
  })

  it('reports nothing when the visit is clean', () => {
    expect(jobConflicts(job(), [technician()], [job()])).toEqual([])
  })
})

describe('checkCompetency', () => {
  const now = at('2026-10-26T00:00:00Z')

  it('matches names case-insensitively and trimmed', () => {
    const result = checkCompetency(
      ['  rigging '],
      [{ name: 'Rigging', expiryDate: null }],
      { now, blockOnExpired: true },
    )
    expect(result.missing).toEqual([])
    expect(result.expired).toEqual([])
  })

  it('separates a name that is missing from one that has expired', () => {
    const result = checkCompetency(
      ['Rigging', 'Load test'],
      [
        { name: 'Rigging', expiryDate: at('2026-01-01T00:00:00Z') },
        { name: 'Slinging', expiryDate: null },
      ],
      { now, blockOnExpired: true },
    )

    expect(result.missing).toEqual(['Load test'])
    expect(result.expired).toEqual(['Rigging'])
  })

  it('blocks only when the office asked it to', () => {
    const held = [{ name: 'Rigging', expiryDate: at('2026-01-01T00:00:00Z') }]

    expect(checkCompetency(['Rigging'], held, { now, blockOnExpired: true }).blocked).toBe(true)
    expect(checkCompetency(['Rigging'], held, { now, blockOnExpired: false }).blocked).toBe(false)
  })

  it('does not call a competency with no expiry date expired', () => {
    const result = checkCompetency(
      ['Rigging'],
      [{ name: 'Rigging', expiryDate: null }],
      { now, blockOnExpired: true },
    )
    expect(result.expired).toEqual([])
    expect(result.blocked).toBe(false)
  })
})

describe('onCallGaps', () => {
  const from = at('2026-10-26T00:00:00Z')
  const to = at('2026-10-27T00:00:00Z')

  it('reports the whole window when nobody is on call', () => {
    const gaps = onCallGaps([], from, to)
    expect(gaps).toEqual([{ start: from, end: to }])
  })

  it('reports nothing when one shift covers the window', () => {
    expect(onCallGaps([{ startAt: from, endAt: to }], from, to)).toEqual([])
  })

  it('merges an overlapping handover rather than inventing a gap between it', () => {
    const gaps = onCallGaps(
      [
        { startAt: from, endAt: at('2026-10-26T13:00:00Z') },
        { startAt: at('2026-10-26T12:00:00Z'), endAt: to },
      ],
      from,
      to,
    )
    expect(gaps).toEqual([])
  })

  it('finds the hole between two shifts, including the tail', () => {
    const gaps = onCallGaps(
      [
        { startAt: from, endAt: at('2026-10-26T08:00:00Z') },
        { startAt: at('2026-10-26T12:00:00Z'), endAt: at('2026-10-26T18:00:00Z') },
      ],
      from,
      to,
    )

    expect(gaps).toEqual([
      { start: at('2026-10-26T08:00:00Z'), end: at('2026-10-26T12:00:00Z') },
      { start: at('2026-10-26T18:00:00Z'), end: to },
    ])
  })

  it('clips shifts that start before the window', () => {
    const gaps = onCallGaps(
      [{ startAt: at('2026-10-25T00:00:00Z'), endAt: at('2026-10-26T06:00:00Z') }],
      from,
      to,
    )
    expect(gaps).toEqual([{ start: at('2026-10-26T06:00:00Z'), end: to }])
  })

  it('returns nothing for an inverted window', () => {
    expect(onCallGaps([], to, from)).toEqual([])
  })
})

describe('wall time in the operating timezone', () => {
  it('converts a Singapore wall time to the right instant', () => {
    // 08:00 in Singapore (UTC+8) is midnight UTC.
    expect(wallTimeToUtc(2026, 10, 26, 8, 0, 'Asia/Singapore').toISOString()).toBe(
      '2026-10-26T00:00:00.000Z',
    )
  })

  it('gives the day an instant falls on locally, not in UTC', () => {
    // 23:30 Singapore on the 26th is 15:30 UTC on the same day — but 00:30 Singapore on the 27th is
    // 16:30 UTC on the 26th, and the board must call that Tuesday.
    expect(dayKey(at('2026-10-26T16:30:00Z'), 'Asia/Singapore')).toBe('2026-10-27')
    expect(dayKey(at('2026-10-26T15:30:00Z'), 'Asia/Singapore')).toBe('2026-10-26')
  })

  it('builds a Singapore day that starts at the right instant', () => {
    const window = boardWindow('day', parseIsoDay('2026-10-26'), 'Asia/Singapore')
    expect(window.from.toISOString()).toBe('2026-10-25T16:00:00.000Z')
    expect(window.to.toISOString()).toBe('2026-10-26T16:00:00.000Z')
    expect(window.days).toHaveLength(1)
  })

  it('builds a week as seven local days, not 168 hours', () => {
    const window = boardWindow('week', parseIsoDay('2026-10-26'), 'Asia/Singapore')
    expect(weekDays(window)).toHaveLength(7)
    expect(isoDay(weekDays(window)[6]!)).toBe('2026-11-01')
    // 26 October 2026 is a Monday; Singapore has no daylight saving, so exactly seven days.
    const hours = (window.to.getTime() - window.from.getTime()) / 3_600_000
    expect(hours).toBe(7 * 24)
  })

  it('handles a week containing a daylight-saving change', () => {
    // America/New_York goes back an hour on 1 November 2026. A week from the 26th is 169 wall-clock
    // hours, which is why the end boundary is converted from its own wall time.
    const window = boardWindow('week', parseIsoDay('2026-10-26'), 'America/New_York')
    const hours = (window.to.getTime() - window.from.getTime()) / 3_600_000
    expect(hours).toBe(7 * 24 + 1)

    // And each day still begins at local midnight, so the columns line up with the clocks.
    expect(window.days.map((day) => isoDay(day))).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ])
    expect(wallTimeToUtc(2026, 11, 1, 0, 0, 'America/New_York').toISOString()).toBe(
      '2026-11-01T04:00:00.000Z',
    )
  })

  it('drops an undated visit at 08:00 local', () => {
    const span = defaultVisitSpan(parseIsoDay('2026-10-26'), 'Asia/Singapore')
    expect(span.start.toISOString()).toBe('2026-10-26T00:00:00.000Z')
    expect(span.end.toISOString()).toBe('2026-10-26T02:00:00.000Z')
  })

  it('falls back to today rather than throwing on a hand-edited URL', () => {
    const now = at('2026-10-26T04:00:00Z')
    expect(isoDay(parseIsoDay('not-a-date', now))).toBe('2026-10-26')
    expect(isoDay(parseIsoDay(undefined, now))).toBe('2026-10-26')
    expect(isoDay(parseIsoDay('2026-01-15', now))).toBe('2026-01-15')
  })
})
