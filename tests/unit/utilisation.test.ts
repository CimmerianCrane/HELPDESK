import { describe, expect, it } from 'vitest'
import { jobClock, leaveWorkingHours, workingDaysBetween } from '@/server/reports/utilisation'

/**
 * The arithmetic behind the utilisation report (slice 33), with no database and no clock.
 *
 * Two things here are easy to get subtly wrong and expensive to notice later: a job that was put on
 * hold must not count the time it was parked, and the denominator must be working hours only — leave
 * taken out of a working calendar has to be measured on the same clock.
 */

const at = (iso: string) => new Date(iso)

describe('jobClock', () => {
  it('sums the in-progress spans of a job that was held and resumed', () => {
    const clock = jobClock(
      [
        { toStatus: 'DISPATCHED', changedAt: at('2026-03-02T08:00:00Z') },
        { toStatus: 'IN_PROGRESS', changedAt: at('2026-03-02T09:00:00Z') },
        { toStatus: 'ON_HOLD', changedAt: at('2026-03-02T10:00:00Z') },
        { toStatus: 'IN_PROGRESS', changedAt: at('2026-03-02T14:00:00Z') },
        { toStatus: 'COMPLETED', changedAt: at('2026-03-02T15:30:00Z') },
      ],
      { onSiteAt: null, completedAt: null },
    )

    // 09:00–10:00 plus 14:00–15:30. The four hours on hold are not on the tools.
    expect(clock.onSiteMinutes).toBe(150)
    // On the road runs dispatch to completion, so it carries the travel and the hold.
    expect(clock.roadMinutes).toBe(450)
  })

  it('falls back to the job columns when no in-progress row exists', () => {
    const clock = jobClock([], {
      onSiteAt: at('2026-03-02T09:00:00Z'),
      completedAt: at('2026-03-02T12:00:00Z'),
    })

    expect(clock.onSiteMinutes).toBe(180)
    expect(clock.roadMinutes).toBe(180)
  })

  it('never reports on-the-road below on-the-tools', () => {
    // Dispatched an hour before the visit started, completed when it did.
    const clock = jobClock(
      [
        { toStatus: 'DISPATCHED', changedAt: at('2026-03-02T08:00:00Z') },
        { toStatus: 'IN_PROGRESS', changedAt: at('2026-03-02T09:00:00Z') },
        { toStatus: 'COMPLETED', changedAt: at('2026-03-02T09:30:00Z') },
      ],
      { onSiteAt: null, completedAt: null },
    )

    expect(clock.onSiteMinutes).toBe(30)
    expect(clock.roadMinutes).toBe(90)
  })

  it('reports a still-open visit as nothing on the tools', () => {
    // No closing row: the job is in progress right now, so its total is not known yet.
    const clock = jobClock(
      [
        { toStatus: 'IN_PROGRESS', changedAt: at('2026-03-02T09:00:00Z') },
      ],
      { onSiteAt: at('2026-03-02T09:00:00Z'), completedAt: null },
    )

    expect(clock.onSiteMinutes).toBe(0)
    expect(clock.roadMinutes).toBe(0)
  })
})

describe('workingDaysBetween', () => {
  it('counts Monday to Friday and skips the weekend', () => {
    // 2 March 2026 is a Monday; the 8th is a Sunday.
    expect(workingDaysBetween('2026-03-02', '2026-03-08')).toBe(5)
    expect(workingDaysBetween('2026-03-06', '2026-03-09')).toBe(2)
  })

  it('counts a single working day as one', () => {
    expect(workingDaysBetween('2026-03-03', '2026-03-03')).toBe(1)
    expect(workingDaysBetween('2026-03-07', '2026-03-07')).toBe(0)
  })
})

describe('leaveWorkingHours', () => {
  const window = { from: at('2026-03-02T00:00:00Z'), to: at('2026-03-09T00:00:00Z') }

  it('counts a weekday off as eight hours, not twenty-four', () => {
    const hours = leaveWorkingHours(
      [{ startAt: at('2026-03-03T00:00:00Z'), endAt: at('2026-03-04T00:00:00Z') }],
      window.from,
      window.to,
      'UTC',
    )
    expect(hours).toBe(8)
  })

  it('ignores leave that falls entirely on a weekend', () => {
    const hours = leaveWorkingHours(
      [{ startAt: at('2026-03-07T00:00:00Z'), endAt: at('2026-03-08T00:00:00Z') }],
      window.from,
      window.to,
      'UTC',
    )
    expect(hours).toBe(0)
  })

  it('trims a booking that only clips working hours', () => {
    // 06:00–12:00 is six hours, of which 09:00–12:00 is working time.
    const hours = leaveWorkingHours(
      [{ startAt: at('2026-03-03T06:00:00Z'), endAt: at('2026-03-03T12:00:00Z') }],
      window.from,
      window.to,
      'UTC',
    )
    expect(hours).toBe(3)
  })

  it('clips leave to the report window', () => {
    // Booked from the Friday before the window to the Tuesday after it opens.
    const hours = leaveWorkingHours(
      [{ startAt: at('2026-02-27T00:00:00Z'), endAt: at('2026-03-04T00:00:00Z') }],
      window.from,
      window.to,
      'UTC',
    )
    expect(hours).toBe(16)
  })
})
