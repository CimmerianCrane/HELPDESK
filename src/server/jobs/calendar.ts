import { addDays, dayKey, wallTimeToUtc } from '@/lib/time'
import type { JobSummary } from '@/server/jobs/jobs'

/** `YYYY-MM-DD` for a `YYYY-MM-DD` carrier, which is what `addDays` works on. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * The calendar view of the job list (brief §8).
 *
 * A month, as a fixed six-week grid, with the scheduled jobs bucketed onto the wall date they start
 * on. The bucketing is by wall date in the operating timezone, not by UTC day: a visit at 08:00
 * Singapore is 00:00 UTC, and a UTC day key would put late-evening visits on the wrong square.
 *
 * Pure, so a month with a 31st, a February and a clock change are all testable without a browser.
 */

export interface CalendarDay {
  /** `YYYY-MM-DD`, the wall date this square is. */
  date: string
  /** True for days outside the month being shown — rendered dimmed, to keep the grid rectangular. */
  outside: boolean
  isToday: boolean
  jobs: JobSummary[]
}

/** The first month day and the grid of days for `month` (`YYYY-MM`). Falls back to the current month. */
export function calendarMonth(month: string | undefined, now: Date): string {
  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return month
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Six weeks starting on the Monday on or before the first of the month. Six rows always, so the grid
 * does not jump height between months — a layout that shifts under the cursor is how a dispatcher
 * clicks the wrong day.
 */
export function calendarDays(
  month: string,
  jobs: readonly JobSummary[],
  timezone: string,
  now: Date,
): CalendarDay[] {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number]
  const first = new Date(Date.UTC(year, monthNumber - 1, 1))

  // getUTCDay: 0 = Sunday. Monday-first weeks, so Sunday is 6 days after the Monday.
  const offset = (first.getUTCDay() + 6) % 7
  const gridStart = addDays(first, -offset)
  const today = dayKey(now, timezone)

  const byDate = new Map<string, JobSummary[]>()
  for (const job of jobs) {
    if (!job.scheduledStart) continue
    const key = dayKey(job.scheduledStart, timezone)
    const list = byDate.get(key) ?? []
    list.push(job)
    byDate.set(key, list)
  }

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index)
    const key = isoDay(date)
    return {
      date: key,
      outside: date.getUTCMonth() !== monthNumber - 1,
      isToday: key === today,
      // P1 first inside a day: the same working order as the list.
      jobs: (byDate.get(key) ?? []).sort((a, b) => a.priority.localeCompare(b.priority)),
    }
  })
}

/** The month before or after `YYYY-MM`, as `YYYY-MM`. */
export function shiftMonth(month: string, months: number): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number]
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + months, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * The instants that bound a month of wall time in `timezone`, so the list can be filtered in SQL
 * rather than fetched whole. The `to` bound is exclusive: the first instant of the following month.
 */
export function monthRange(month: string, timezone: string): { from: Date; to: Date } {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number]
  const next = shiftMonth(month, 1).split('-').map(Number) as [number, number]
  return {
    from: wallTimeToUtc(year, monthNumber, 1, 0, 0, timezone),
    to: wallTimeToUtc(next[0], next[1], 1, 0, 0, timezone),
  }
}

/** The grid's own bounds — six weeks from the Monday before the first — for the month's query. */
export function calendarRange(month: string, timezone: string): { from: Date; to: Date } {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number]
  const first = new Date(Date.UTC(year, monthNumber - 1, 1))
  const gridStart = addDays(first, -((first.getUTCDay() + 6) % 7))
  const gridEnd = addDays(gridStart, 42)

  const toWall = (date: Date) =>
    wallTimeToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 0, 0, timezone)

  return { from: toWall(gridStart), to: toWall(gridEnd) }
}
