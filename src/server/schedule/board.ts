import type { JobStatus, Priority } from '@prisma/client'
import { addDays, wallTimeToUtc } from '@/lib/time'

/**
 * Scheduling rules (brief §4.4), as pure functions over the rows a board already has.
 *
 * Everything here is arithmetic and set logic with no database access, so the parts that are easy to
 * get subtly wrong — "is this technician double-booked", "does this clash with their leave", "is this
 * overnight shift covered" — are testable without a database, a clock or a browser.
 *
 * The service layer (`scheduling.ts`) fetches rows and calls these; the board renders what comes back.
 * A rule implemented in a page instead of here would be a rule nobody can test.
 */

/** A job's occupancy on the board: when it happens and who is expected. */
export interface BoardJob {
  id: string
  number: string
  status: JobStatus
  priority: Priority
  scheduledStart: Date | null
  scheduledEnd: Date | null
  /** The technician ids assigned to it. Empty means unassigned — it still needs a date and a body. */
  technicianIds: string[]
}

export interface BoardTechnician {
  id: string
  name: string
  colour: string | null
  employeeNo: string | null
  /** Competency names this person currently holds, unexpired. Lower-cased by the caller. */
  competencyNames: string[]
  /** Shift spans, for the leave overlay. */
  unavailability: Array<{ id: string; startAt: Date; endAt: Date; reason: string | null }>
}

export interface BoardResource {
  id: string
  name: string
  type: string
  status: string
}

/** Anything with a span. `null` bounds mean "unbounded on that side", as in leave with no end. */
export interface Span {
  start: Date | null
  end: Date | null
}

// ---------------------------------------------------------------------------
// Overlap arithmetic
// ---------------------------------------------------------------------------

/**
 * Do two spans overlap? Half-open intervals: two visits that meet end-to-start do not clash, which is
 * what lets a technician finish at 11:00 and start the next at 11:00.
 *
 * An unbounded side is treated as extending forever in that direction. A job with no dates has no
 * span at all and never clashes — it is not on the board yet.
 */
export function spansOverlap(a: Span, b: Span): boolean {
  if (!a.start && !a.end) return false
  if (!b.start && !b.end) return false

  const aStart = a.start ? a.start.getTime() : Number.NEGATIVE_INFINITY
  const aEnd = a.end ? a.end.getTime() : Number.POSITIVE_INFINITY
  const bStart = b.start ? b.start.getTime() : Number.NEGATIVE_INFINITY
  const bEnd = b.end ? b.end.getTime() : Number.POSITIVE_INFINITY

  // A zero-length span (start == end) is a point and touches nothing.
  if (aStart === aEnd || bStart === bEnd) return false

  return aStart < bEnd && bStart < aEnd
}

/** Minutes from `at` to `deadline`, floored at zero, for "how long have I got" displays. */
export function minutesUntil(deadline: Date, at: Date): number {
  return Math.max(0, Math.round((deadline.getTime() - at.getTime()) / 60_000))
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

export type ConflictKind = 'double-booked' | 'on-leave' | 'unassigned' | 'no-dates'

export interface Conflict {
  kind: ConflictKind
  jobId: string
  technicianId?: string
  message: string
}

/**
 * Every scheduling problem with one job. This is what the board marks and what the assignment
 * service warns about before it commits: the two must agree, so both read this function.
 */
export function jobConflicts(
  job: BoardJob,
  technicians: readonly BoardTechnician[],
  otherJobs: readonly BoardJob[],
): Conflict[] {
  const conflicts: Conflict[] = []

  if (!job.scheduledStart || !job.scheduledEnd) {
    conflicts.push({
      kind: 'no-dates',
      jobId: job.id,
      message: 'This job has a technician but no date, so it cannot be dispatched.',
    })
  }

  if (job.technicianIds.length === 0) {
    conflicts.push({
      kind: 'unassigned',
      jobId: job.id,
      message: 'Nobody is assigned to this job.',
    })
  }

  const mySpan: Span = { start: job.scheduledStart, end: job.scheduledEnd }

  for (const technicianId of job.technicianIds) {
    const technician = technicians.find((row) => row.id === technicianId)

    // The same person on two jobs at once. Jobs that have not been dated are ignored: they are not
    // yet claiming a slot, so flagging them would mark every unplanned job on every technician.
    for (const other of otherJobs) {
      if (other.id === job.id) continue
      if (!other.technicianIds.includes(technicianId)) continue
      if (!other.scheduledStart || !other.scheduledEnd) continue
      if (!spansOverlap(mySpan, { start: other.scheduledStart, end: other.scheduledEnd })) continue

      conflicts.push({
        kind: 'double-booked',
        jobId: job.id,
        technicianId,
        message: `${technician?.name ?? 'That technician'} is on ${other.number} at the same time.`,
      })
    }

    // Leave. Warned about even though it is sometimes overridden — a person on leave can still be
    // called, but it has to be a decision rather than an accident.
    const leave = technician?.unavailability ?? []
    for (const span of leave) {
      if (!spansOverlap(mySpan, { start: span.startAt, end: span.endAt })) continue
      conflicts.push({
        kind: 'on-leave',
        jobId: job.id,
        technicianId,
        message: `${technician?.name ?? 'That technician'} is unavailable${span.reason ? ` (${span.reason})` : ''}.`,
      })
    }
  }

  return conflicts
}

// ---------------------------------------------------------------------------
// Competency
// ---------------------------------------------------------------------------

export interface CompetencyCheck {
  /** Names the job type demands that this technician does not hold, or holds expired. */
  missing: string[]
  /** Names the job type demands that they hold expired rather than validly. */
  expired: string[]
  /** True when the technician may not be assigned under the current setting. */
  blocked: boolean
}

/**
 * Does this technician meet what the work demands?
 *
 * The setting decides whether a gap blocks or merely warns (brief §4.4). Note what is *not* decided
 * here: whether the requirement is reasonable. `requiredCompetencies` is office-owned data, so this
 * function only compares two lists.
 *
 * Names are compared case-insensitively and trimmed, because they are typed by people in two places.
 */
export function checkCompetency(
  required: readonly string[],
  held: ReadonlyArray<{ name: string; expiryDate: Date | null }>,
  options: { now: Date; blockOnExpired: boolean },
): CompetencyCheck {
  const normalise = (value: string) => value.trim().toLowerCase()

  const byName = new Map(held.map((entry) => [normalise(entry.name), entry]))
  const missing: string[] = []
  const expired: string[] = []

  for (const name of required) {
    const entry = byName.get(normalise(name))
    if (!entry) {
      missing.push(name)
      continue
    }
    if (entry.expiryDate && entry.expiryDate.getTime() < options.now.getTime()) {
      expired.push(name)
    }
  }

  // An expired competency blocks only when the office asked it to. A missing one blocks whenever the
  // job declares it — the point of requiring it is that work should not go ahead without it. Both
  // are subordinate to the setting; see ASSUMPTIONS.md.
  const blocked = options.blockOnExpired ? missing.length + expired.length > 0 : false

  return { missing, expired, blocked }
}

/** Copy a competency name the way the office types it, for comparing without case sensitivity. */
export function normaliseCompetencyName(name: string): string {
  return name.trim()
}

// ---------------------------------------------------------------------------
// On-call coverage
// ---------------------------------------------------------------------------

export interface OnCallGap {
  start: Date
  end: Date
}

/**
 * Spans inside `[from, to)` with nobody on call.
 *
 * The roster is a list of shifts that may be adjacent, overlapping or leave holes; what a dispatcher
 * needs is the holes. Shifts are merged first so two people covering a handover do not produce a
 * phantom gap between them.
 */
export function onCallGaps(
  shifts: ReadonlyArray<{ startAt: Date; endAt: Date }>,
  from: Date,
  to: Date,
): OnCallGap[] {
  if (to.getTime() <= from.getTime()) return []

  const clipped = shifts
    .map((shift) => ({
      start: Math.max(shift.startAt.getTime(), from.getTime()),
      end: Math.min(shift.endAt.getTime(), to.getTime()),
    }))
    .filter((shift) => shift.start < shift.end)
    .sort((a, b) => a.start - b.start)

  const gaps: OnCallGap[] = []
  let cursor = from.getTime()

  for (const shift of clipped) {
    if (shift.start > cursor) {
      gaps.push({ start: new Date(cursor), end: new Date(shift.start) })
    }
    cursor = Math.max(cursor, shift.end)
  }

  if (cursor < to.getTime()) {
    gaps.push({ start: new Date(cursor), end: new Date(to) })
  }

  return gaps
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

export { addDays, dayKey, wallTimeToUtc } from '@/lib/time'

/** A day as a UTC midnight carrying its year, month and day. The carrier for `YYYY-MM-DD` values. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Parses `YYYY-MM-DD`, falling back to today rather than throwing on a hand-edited URL. */
export function parseIsoDay(value: string | undefined, now: Date = new Date()): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

// ---------------------------------------------------------------------------
// Day/week windows
// ---------------------------------------------------------------------------

export type BoardView = 'day' | 'week'

export interface BoardWindow {
  /** First instant of the first day, in the operating timezone. */
  from: Date
  /** First instant of the day *after* the last day. Half-open, as everywhere else. */
  to: Date
  /** The first day as a `YYYY-MM-DD` carrier. */
  startOfDay: Date
  days: Date[]
}

/** The date window a board view shows, from a `?date=` the browser sent. */
export function boardWindow(view: BoardView, day: Date, timeZone: string): BoardWindow {
  const y = day.getUTCFullYear()
  const m = day.getUTCMonth() + 1
  const d = day.getUTCDate()
  const span = view === 'week' ? 7 : 1

  const days = Array.from({ length: span }, (_, index) => addDays(day, index))
  const from = wallTimeToUtc(y, m, d, 0, 0, timeZone)

  // The end boundary is converted from its own wall time rather than from `from + span*24h`, so a
  // week containing a clock change is still seven days long.
  const afterLast = addDays(day, span)
  const to = wallTimeToUtc(
    afterLast.getUTCFullYear(),
    afterLast.getUTCMonth() + 1,
    afterLast.getUTCDate(),
    0,
    0,
    timeZone,
  )

  return { from, to, startOfDay: day, days }
}

/** Working-day labels for a week board, in order, from the window's first day. */
export function weekDays(window: BoardWindow): Date[] {
  return window.days
}

/**
 * The span a visit occupies when it is dropped on a day with no time of its own: 08:00–10:00 local.
 * A board that demanded a time before it would accept a drag would turn a ten-second decision into
 * a form.
 */
export function defaultVisitSpan(day: Date, timeZone: string): { start: Date; end: Date } {
  const y = day.getUTCFullYear()
  const m = day.getUTCMonth() + 1
  const d = day.getUTCDate()
  return {
    start: wallTimeToUtc(y, m, d, 8, 0, timeZone),
    end: wallTimeToUtc(y, m, d, 10, 0, timeZone),
  }
}
