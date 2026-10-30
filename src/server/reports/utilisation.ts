import type { JobStatus } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { addDays, dayKey, wallTimeToUtc } from '@/lib/time'
import { parseInput } from '@/lib/validation/parse'
import { utilisationFilterSchema, type UtilisationFilter } from '@/lib/validation/utilisation'
import { assertCan } from '@/server/auth/permissions'
import { jobReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { getSettings } from '@/server/settings/settings'

/**
 * Technician utilisation (brief §11, slice 33).
 *
 * **Where the hours come from.** The app already records every status change of every job, with a
 * timestamp and the person who made it (`JobStatusHistory`, rule 7). This report reads that record
 * rather than adding an hours table: a technician's time on the tools is the span from `IN_PROGRESS`
 * to the next status change, and it is summed over however many visits the job took — a job put on
 * hold awaiting parts and resumed counts only the time actually spent on it.
 *
 * **Two numbers, not one.** *On the tools* is `IN_PROGRESS` → next change. *On the road* is
 * `DISPATCHED` → `COMPLETED`, so it carries the travel either side of the visit as well. Where a job
 * was never dispatched (a job moved straight to in-progress), on the road falls back to the on-site
 * span — understating travel rather than inventing it.
 *
 * **A job's hours are shared between the people on it.** Two technicians sent to one visit each get
 * half its hours, because the alternative is crediting the lead with work two people did.
 *
 * **The denominator is a weekday, not a calendar.** Nothing in the system knows anybody's shift (nor
 * was one ever asked for), so the available hours are Monday–Friday, 09:00–17:00 in the operating
 * timezone, less whatever leave the technician had booked that fell inside those hours.
 *
 * shortcut: fixed 8-hour weekday and no public holidays — move the day model into Settings when the
 * office works shifts or wants holidays excluded (it changes `workingDaysBetween` and the leave
 * subtraction and nothing else).
 *
 * Reads are scoped with `jobReadWhere`, so the capability decides *whether* and the scope decides
 * *which rows* — the same two halves as every other service (CLAUDE.md rule 1).
 */

/** 09:00–17:00 local, Monday to Friday. Documented above and in docs/ASSUMPTIONS.md. */
const WORKDAY_START_HOUR = 9
const WORKING_HOURS_PER_DAY = 8

/** The window the screen opens on when nobody has chosen one. */
const DEFAULT_WINDOW_DAYS = 30

/** Days in the working-day loop before it gives up counting. Ten years of a report is a typo. */
const MAX_WINDOW_DAYS = 3660

export interface UtilisationRow {
  technicianId: string
  name: string
  isActive: boolean
  /** Completed jobs in the window this technician was assigned to. */
  jobs: number
  onSiteHours: number
  roadHours: number
  leaveHours: number
  availableHours: number
  /** On-the-tools hours over available hours, or null when nothing was available. */
  utilisationRatio: number | null
}

export interface UtilisationReport {
  rows: UtilisationRow[]
  /** The days the report covers, as `YYYY-MM-DD` in the operating timezone, both ends inclusive. */
  fromDay: string
  toDay: string
  /** The instants those days cover; `to` is exclusive, so it is midnight the day after `toDay`. */
  window: { from: Date; to: Date }
  workingDays: number
  totals: { jobs: number; onSiteHours: number; roadHours: number; availableHours: number }
  /** Completed jobs in the window with nobody assigned — hours the report cannot attribute. */
  unassignedJobs: number
}

// ---------------------------------------------------------------------------
// One job's clock, from its own status history
// ---------------------------------------------------------------------------

export interface JobClock {
  /** `IN_PROGRESS` → next change, summed over every visit. */
  onSiteMinutes: number
  /** Earliest departure (`DISPATCHED`, else in-progress) → completion. Never less than on-site. */
  roadMinutes: number
}

function minutes(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000))
}

/**
 * The two spans one job's history describes.
 *
 * `IN_PROGRESS` is the only state that is *working*: it opens a segment, and any later change
 * (completion, a hold, a cancellation) closes it. That is what makes a job that sat on hold overnight
 * count the afternoon and not the night.
 *
 * The fallback columns cover a job whose history predates the state machine, or one written by the
 * seed: if no `IN_PROGRESS` row exists but the job carries `onSiteAt` and `completedAt`, those are
 * the span.
 */
export function jobClock(
  history: ReadonlyArray<{ toStatus: JobStatus; changedAt: Date }>,
  fallback: { onSiteAt: Date | null; completedAt: Date | null },
): JobClock {
  const rows = [...history].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime())
  const firstAt = (status: JobStatus) => rows.find((row) => row.toStatus === status)?.changedAt ?? null

  const completedAt = firstAt('COMPLETED') ?? fallback.completedAt
  const onSiteAt = firstAt('IN_PROGRESS') ?? fallback.onSiteAt

  let onSiteMinutes = 0
  let workingSince: Date | null = null
  for (const row of rows) {
    if (row.toStatus === 'IN_PROGRESS') {
      workingSince ??= row.changedAt
      continue
    }
    if (!workingSince) continue
    onSiteMinutes += minutes(workingSince, row.changedAt)
    workingSince = null
  }
  // Still on the tools with no closing row: the job's own completion column is the next best end.
  if (workingSince && fallback.completedAt && fallback.completedAt > workingSince) {
    onSiteMinutes += minutes(workingSince, fallback.completedAt)
  }
  if (onSiteMinutes === 0 && fallback.onSiteAt && fallback.completedAt) {
    onSiteMinutes = minutes(fallback.onSiteAt, fallback.completedAt)
  }

  const departedAt = firstAt('DISPATCHED') ?? onSiteAt
  const roadMinutes =
    departedAt && completedAt && completedAt > departedAt
      ? minutes(departedAt, completedAt)
      : onSiteMinutes

  return { onSiteMinutes, roadMinutes }
}

// ---------------------------------------------------------------------------
// The working calendar
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` back to a UTC carrier at midnight, which is what `addDays` walks by. */
function dayCarrier(key: string): Date {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day))
}

function isWorkingDay(carrier: Date): boolean {
  const weekday = carrier.getUTCDay()
  return weekday !== 0 && weekday !== 6
}

/** Weekdays in an inclusive `YYYY-MM-DD` range, in the operating timezone. */
export function workingDaysBetween(fromDay: string, toDay: string): number {
  let cursor = dayCarrier(fromDay)
  const last = dayCarrier(toDay)
  let count = 0
  for (let guard = 0; cursor <= last && guard < MAX_WINDOW_DAYS; guard += 1) {
    if (isWorkingDay(cursor)) count += 1
    cursor = addDays(cursor, 1)
  }
  return count
}

/**
 * Leave hours that fell inside working hours: each booked span is intersected with 09:00–17:00 on
 * each weekday it covers. A fortnight off is 80 hours, not 336 — the denominator is working time,
 * so the leave taken out of it has to be working time too.
 */
export function leaveWorkingHours(
  spans: ReadonlyArray<{ startAt: Date; endAt: Date }>,
  from: Date,
  to: Date,
  timeZone: string,
): number {
  let total = 0
  for (const span of spans) {
    const start = span.startAt > from ? span.startAt : from
    const end = span.endAt < to ? span.endAt : to
    if (end <= start) continue

    let cursor = dayCarrier(dayKey(start, timeZone))
    const last = dayCarrier(dayKey(end, timeZone))
    for (let guard = 0; cursor <= last && guard < MAX_WINDOW_DAYS; guard += 1) {
      if (isWorkingDay(cursor)) {
        const [year, month, day] = [cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate()]
        const opensAt = wallTimeToUtc(year, month, day, WORKDAY_START_HOUR, 0, timeZone)
        const closesAt = wallTimeToUtc(year, month, day, WORKDAY_START_HOUR + WORKING_HOURS_PER_DAY, 0, timeZone)
        const overlapStart = start > opensAt ? start : opensAt
        const overlapEnd = end < closesAt ? end : closesAt
        if (overlapEnd > overlapStart) total += minutes(overlapStart, overlapEnd)
      }
      cursor = addDays(cursor, 1)
    }
  }
  return total / 60
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** Midnight at the start of a `YYYY-MM-DD` wall date, or null when it is not one. */
function dayStart(value: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return wallTimeToUtc(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0, timezone)
}

/** The range as wall days, defaulting to the last 30, and the instants they cover. */
async function resolveWindow(
  filters: UtilisationFilter,
  client: Tx,
  now: Date,
): Promise<{
  fromDay: string
  toDay: string
  from: Date
  toExclusive: Date
  timezone: string
}> {
  const timezone = (await getSettings(client)).timezone
  const today = dayKey(now, timezone)

  let fromDay = filters.from || dayKey(addDays(dayCarrier(today), -(DEFAULT_WINDOW_DAYS - 1)), timezone)
  let toDay = filters.to || today
  // A pair the wrong way round still answers: the range is a period, not an ordering.
  if (fromDay > toDay) [fromDay, toDay] = [toDay, fromDay]

  const from = dayStart(fromDay, timezone) ?? new Date(0)
  const toStart = dayStart(toDay, timezone) ?? now
  return { fromDay, toDay, from, toExclusive: addDays(toStart, 1), timezone }
}

export async function utilisationReport(
  context: AuthContext,
  raw: unknown = {},
  client: Tx = db,
  now: Date = new Date(),
): Promise<UtilisationReport> {
  assertCan(context, 'report.financial')
  const filters = parseInput(utilisationFilterSchema, raw)
  const window = await resolveWindow(filters, client, now)

  const [jobs, technicians] = await Promise.all([
    client.job.findMany({
      where: {
        ...jobReadWhere(context),
        // Work counts on the day it finished: a job still in progress has hours but no known total,
        // and billing it to a period it may leave is how a report starts disagreeing with itself.
        completedAt: { gte: window.from, lt: window.toExclusive },
      },
      select: {
        id: true,
        onSiteAt: true,
        completedAt: true,
        statusHistory: {
          orderBy: { changedAt: 'asc' },
          select: { toStatus: true, changedAt: true },
        },
        technicians: { select: { technicianId: true } },
      },
    }),
    client.technician.findMany({
      where: { user: { deletedAt: null } },
      orderBy: { user: { name: 'asc' } },
      select: {
        id: true,
        user: { select: { name: true, isActive: true } },
        unavailability: {
          where: { startAt: { lt: window.toExclusive }, endAt: { gt: window.from } },
          select: { startAt: true, endAt: true },
        },
      },
    }),
  ])

  const workingDays = workingDaysBetween(window.fromDay, window.toDay)
  const availableFromWeekdays = workingDays * WORKING_HOURS_PER_DAY

  const onSiteMinutes = new Map<string, number>()
  const roadMinutes = new Map<string, number>()
  const jobCount = new Map<string, number>()
  let unassignedJobs = 0

  for (const job of jobs) {
    const crew = [...new Set(job.technicians.map((row) => row.technicianId))]
    if (crew.length === 0) {
      unassignedJobs += 1
      continue
    }

    const clock = jobClock(job.statusHistory, job)
    for (const technicianId of crew) {
      jobCount.set(technicianId, (jobCount.get(technicianId) ?? 0) + 1)
      // Shared, not credited twice: two people on one visit each earned half of it.
      onSiteMinutes.set(technicianId, (onSiteMinutes.get(technicianId) ?? 0) + clock.onSiteMinutes / crew.length)
      roadMinutes.set(technicianId, (roadMinutes.get(technicianId) ?? 0) + clock.roadMinutes / crew.length)
    }
  }

  const rows: UtilisationRow[] = technicians.map((technician) => {
    const leaveHours = leaveWorkingHours(
      technician.unavailability,
      window.from,
      window.toExclusive,
      window.timezone,
    )
    // Leave only ever removes time that was there: a booking dragged into the window from outside it
    // cannot make the denominator negative.
    const availableHours = Math.max(0, availableFromWeekdays - leaveHours)
    const onSiteHours = (onSiteMinutes.get(technician.id) ?? 0) / 60
    return {
      technicianId: technician.id,
      name: technician.user.name,
      isActive: technician.user.isActive,
      jobs: jobCount.get(technician.id) ?? 0,
      onSiteHours: roundHours(onSiteHours),
      roadHours: roundHours((roadMinutes.get(technician.id) ?? 0) / 60),
      leaveHours: roundHours(leaveHours),
      availableHours: roundHours(availableHours),
      utilisationRatio: availableHours > 0 ? onSiteHours / availableHours : null,
    }
  })

  // Busiest first, and a technician with no work last rather than scattered through the list.
  rows.sort((a, b) => (b.utilisationRatio ?? -1) - (a.utilisationRatio ?? -1))

  const sum = (pick: (row: UtilisationRow) => number) => rows.reduce((total, row) => total + pick(row), 0)

  return {
    rows,
    fromDay: window.fromDay,
    toDay: window.toDay,
    window: { from: window.from, to: window.toExclusive },
    workingDays,
    totals: {
      // The jobs themselves, not the per-person count: one visit with two technicians on it is one
      // job, and adding the column up would report it twice.
      jobs: jobs.length,
      onSiteHours: roundHours(sum((row) => row.onSiteHours)),
      roadHours: roundHours(sum((row) => row.roadHours)),
      availableHours: roundHours(sum((row) => row.availableHours)),
    },
    unassignedJobs,
  }
}

function roundHours(hours: number): number {
  return Math.round(hours * 10) / 10
}
