/**
 * When a recurring obligation is next due — the one implementation (slice 12, PLAN §7.3 decision 3).
 *
 * Three callers need the same answer: saving a schedule, marking one done from a completed job, and
 * (from slice 15) the daily reminder scan. Overdue is deliberately *not* stored: it is this file's
 * `isOverdue` computed against the clock, so no cron has to flip a flag that can drift.
 *
 * Pure on purpose — no Prisma import — so the awkward cases (a month-end interval, a job completed
 * before the last one recorded) are unit-tested without a database.
 */

/**
 * `date` plus `months`, clamped to the end of the month.
 *
 * The clamp is the whole point. A monthly service due on 31 January is next due 28 or 29 February,
 * not 3 March, which is what `setUTCMonth` alone would give.
 *
 * shortcut: a clamp is lossy — 31 January going monthly becomes 28 February, and the following step
 * from that date is 28 March. It self-corrects at the next long month, because `recomputeNextDue`
 * always counts from a real completion date rather than a chained projection. A cadence that has to
 * hold "the 31st" forever would need the anchor day stored on the schedule.
 */
export function addMonths(date: Date, months: number): Date {
  const day = date.getUTCDate()
  const target = new Date(date.getTime())
  // Setting the day to 1 first stops the month rollover from skipping a short month entirely.
  target.setUTCDate(1)
  target.setUTCMonth(target.getUTCMonth() + months)

  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target
}

export interface RecurrenceRule {
  intervalMonths: number | null
  lastDoneDate: Date | null
  nextDueDate: Date | null
}

/**
 * The next due date for a schedule, given where it stands.
 *
 * An interval wins over a stored date: a schedule with a cadence is defined by when it was last done,
 * and carrying a stale `nextDueDate` forward alongside it is how the two drift apart. A one-off
 * (no interval) keeps whatever date was typed, because there is nothing to derive it from.
 */
export function recomputeNextDue(rule: RecurrenceRule): Date | null {
  if (!rule.intervalMonths || rule.intervalMonths < 1) return rule.nextDueDate
  if (!rule.lastDoneDate) return rule.nextDueDate
  return addMonths(rule.lastDoneDate, rule.intervalMonths)
}

/**
 * Has this schedule passed its due date?
 *
 * A schedule with no date at all is not overdue — it is unconfigured, which the list shows as its own
 * state. Comparing at day granularity rather than to the millisecond means a service due today is not
 * reported as a week's work in arrears at 00:01.
 */
export function isOverdue(schedule: { nextDueDate: Date | null }, now: Date = new Date()): boolean {
  if (!schedule.nextDueDate) return false
  return startOfUtcDay(schedule.nextDueDate).getTime() < startOfUtcDay(now).getTime()
}

/** Whole days from `now` until the due date; negative when it has passed. Null when undated. */
export function daysUntil(nextDueDate: Date | null, now: Date = new Date()): number | null {
  if (!nextDueDate) return null
  const ms = startOfUtcDay(nextDueDate).getTime() - startOfUtcDay(now).getTime()
  return Math.round(ms / 86_400_000)
}

/**
 * Which bucket a due date falls in, for the list and the dashboard tile.
 *
 * The buckets are the ones the brief asks for (§8: 90/60/30 then overdue), and they are mutually
 * exclusive and ordered, so "due in 30 days" never also counts as "due in 90".
 */
export type DueBucket = 'overdue' | '30' | '60' | '90' | 'later' | 'none'

export function dueBucket(nextDueDate: Date | null, now: Date = new Date()): DueBucket {
  const days = daysUntil(nextDueDate, now)
  if (days === null) return 'none'
  if (days < 0) return 'overdue'
  if (days <= 30) return '30'
  if (days <= 60) return '60'
  if (days <= 90) return '90'
  return 'later'
}

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: 'Overdue',
  '30': 'Due within 30 days',
  '60': 'Due in 31–60 days',
  '90': 'Due in 61–90 days',
  later: 'Later',
  none: 'No date',
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}
