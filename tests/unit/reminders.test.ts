import { describe, expect, it } from 'vitest'
import { reminderOffsetFor } from '@/server/reminders/reminders'

/**
 * Which reminder offset a due date has reached (slice 15).
 *
 * Getting this wrong is not a crash: it is either a reminder the office never receives or the same
 * one every day. The boundaries are pinned here, and the at-most-once claim is proven against the
 * database in `tests/integration/reminders.test.ts`.
 */

const OFFSETS = [90, 60, 30]

describe('reminderOffsetFor', () => {
  it('says nothing while the due date is beyond every offset', () => {
    expect(reminderOffsetFor(91, OFFSETS)).toBeNull()
    expect(reminderOffsetFor(365, OFFSETS)).toBeNull()
  })

  it('fires at the offset the due date has just reached', () => {
    expect(reminderOffsetFor(90, OFFSETS)).toBe('90')
    expect(reminderOffsetFor(85, OFFSETS)).toBe('90')
    expect(reminderOffsetFor(61, OFFSETS)).toBe('90')
    expect(reminderOffsetFor(60, OFFSETS)).toBe('60')
    expect(reminderOffsetFor(31, OFFSETS)).toBe('60')
    expect(reminderOffsetFor(30, OFFSETS)).toBe('30')
    expect(reminderOffsetFor(1, OFFSETS)).toBe('30')
  })

  it('reports the day itself as the nearest threshold, not as overdue', () => {
    expect(reminderOffsetFor(0, OFFSETS)).toBe('30')
  })

  it('reports anything past the due date as overdue', () => {
    expect(reminderOffsetFor(-1, OFFSETS)).toBe('overdue')
    expect(reminderOffsetFor(-400, OFFSETS)).toBe('overdue')
  })

  it('uses the schedule’s own offsets, and ignores duplicates and order', () => {
    expect(reminderOffsetFor(45, [30, 60, 60])).toBe('60')
    expect(reminderOffsetFor(7, [14])).toBe('14')
    expect(reminderOffsetFor(20, [14])).toBeNull()
  })

  it('says nothing for an undated schedule', () => {
    expect(reminderOffsetFor(null, OFFSETS)).toBeNull()
  })
})
