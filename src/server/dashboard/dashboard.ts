import type { JobStatus, OnHoldReason } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { addDays, dayKey, wallTimeToUtc } from '@/lib/time'
import { assertCan } from '@/server/auth/permissions'
import { jobReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { certificateCounts } from '@/server/certificates/certificates'
import { jobSla } from '@/server/jobs/jobs'
import { scheduleCounts } from '@/server/schedules/schedules'
import { getSettings } from '@/server/settings/settings'

/**
 * The office dashboard (brief §8).
 *
 * Every tile is a question asked on a Monday morning, and every count is built from the same rows the
 * list screens read — `jobReadWhere` and the shared `jobSla` — so a tile cannot disagree with the list
 * it links to. That is the whole reason this is a service rather than eight queries in a page.
 *
 * Counts are numbers, not lists: the tile's job is to say "eleven are late"; finding out which eleven
 * is what the link is for.
 */

export interface DashboardCounts {
  p1Open: number
  slaBreached: number
  overdue: number
  awaitingInvoicing: number
  visitsBooked: number
  /** Recurring obligations due in the next 30 days, excluding any already overdue. */
  dueWithin30Days: number
  /** Recurring obligations already past their due date (slice 12). */
  schedulesOverdue: number
  /** Certificates expiring in the next 30 days, excluding any already lapsed (slice 13). */
  certificatesExpiring: number
}

export interface OnHoldBreakdown {
  reason: OnHoldReason
  count: number
}

export interface DashboardSummary extends DashboardCounts {
  onHoldByReason: OnHoldBreakdown[]
  onHoldTotal: number
  /** The next visits by date, for the "what is coming" list. */
  upcoming: Array<{
    jobId: string
    number: string
    priority: string
    scheduledStart: Date
    customerName: string
    siteName: string
    assetTags: string[]
  }>
  /** Today's visits and who is on call now (UI-REVIEW §5: the board leads with today). */
  today: {
    visits: Array<{
      jobId: string
      number: string
      priority: string
      status: JobStatus
      scheduledStart: Date
      customerName: string
      siteName: string
      assetTags: string[]
    }>
    onCall: Array<{ technicianId: string; technicianName: string; until: Date }>
  }
  /**
   * Each figure against where it stood at the same time yesterday, so a dispatcher can read the
   * number as a direction rather than a fact: positive means more of it than yesterday.
   */
  sinceYesterday: {
    p1Open: number
    slaBreached: number
    lateVisits: number
    awaitingInvoicing: number
  }
}

const CLOSED: JobStatus[] = ['CLOSED', 'CANCELLED']

/**
 * "Overdue" means the visit was due and nobody has been: a dated job still waiting to be dispatched
 * after its start time. It is deliberately not the same as an SLA breach — a job can be late for its
 * appointment while still inside its contractual window, and a dispatcher needs to see both.
 */
export async function dashboardSummary(
  context: AuthContext,
  client: Tx = db,
  now: Date = new Date(),
): Promise<DashboardSummary> {
  assertCan(context, 'dashboard.office')

  const horizon = addDays(now, 30)
  const yesterday = addDays(now, -1)

  // Today's window needs the timezone, so the settings read is its own hop before the rest.
  const settings = await getSettings(client)
  const [jobs, certificates, upcoming, visitsBooked, dueSchedules, todayVisits, onCall] =
    await Promise.all([
    client.job.findMany({
      where: { ...jobReadWhere(context), status: { notIn: CLOSED } },
      select: {
        id: true,
        status: true,
        priority: true,
        scheduledStart: true,
        reportedAt: true,
        respondedAt: true,
        completedAt: true,
        closedAt: true,
        slaResponseDue: true,
        slaResolveDue: true,
        onHoldReason: true,
      },
    }),
    // Through the certificate service, not a count of its own, so this tile and the `/certificates`
    // list it links to bucket the same dates the same way (slice 13; the slice-10 lesson).
    certificateCounts(context, client, now),
    client.job.findMany({
      where: {
        ...jobReadWhere(context),
        status: { notIn: CLOSED },
        scheduledStart: { gte: now, lte: horizon },
      },
      orderBy: { scheduledStart: 'asc' },
      take: 10,
      select: {
        id: true,
        number: true,
        priority: true,
        scheduledStart: true,
        customer: { select: { legalName: true, tradingName: true } },
        site: { select: { name: true } },
        cranes: { select: { crane: { select: { assetTag: true } } } },
      },
    }),
    // A count of its own: the list above is capped at ten, and the tile says how many there are.
    client.job.count({
      where: {
        ...jobReadWhere(context),
        status: { notIn: CLOSED },
        scheduledStart: { gte: now, lte: horizon },
      },
    }),
    // Recurring obligations, counted through the schedule service rather than by a query of its own
    // so this tile and the `/schedules` list it links to cannot disagree (slice 12; the slice-10
    // lesson). The service buckets against the clock itself, which is why it needs no horizon here.
    scheduleCounts(context, client, now),
    client.job.findMany({
      where: {
        ...jobReadWhere(context),
        status: { notIn: CLOSED },
        scheduledStart: { gte: startOfDay(now, settings.timezone), lt: endOfDay(now, settings.timezone) },
      },
      orderBy: { scheduledStart: 'asc' },
      select: {
        id: true,
        number: true,
        priority: true,
        status: true,
        scheduledStart: true,
        customer: { select: { legalName: true, tradingName: true } },
        site: { select: { name: true } },
        cranes: { select: { crane: { select: { assetTag: true } } } },
      },
    }),
    // Who is reachable right now, and until when — the roster answer to "who takes the 2am call".
    client.onCallShift.findMany({
      where: { startAt: { lte: now }, endAt: { gt: now } },
      orderBy: { endAt: 'asc' },
      select: {
        technicianId: true,
        endAt: true,
        technician: { select: { user: { select: { name: true } } } },
      },
    }),
  ])

  const holdCounts = new Map<OnHoldReason, number>()
  for (const row of jobs) {
    if (row.status === 'ON_HOLD' && row.onHoldReason) {
      holdCounts.set(row.onHoldReason, (holdCounts.get(row.onHoldReason) ?? 0) + 1)
    }
  }

  const counts = countJobs(jobs, now)
  // The comparison is the same rows read against yesterday's clock, not a second query: an SLA that
  // was reached at 09:00 today was still running at 09:00 yesterday, and only the deadlines decide
  // which. A job created since yesterday is counted, which is the honest answer — it was not late then.
  const before = countJobs(jobs, yesterday)
  const trend = (today: number, then: number): number => today - then

  return {
    ...counts,
    visitsBooked,
    dueWithin30Days: dueSchedules.dueWithin30Days,
    schedulesOverdue: dueSchedules.overdue,
    certificatesExpiring: certificates.dueWithin30Days,
    onHoldByReason: [...holdCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    onHoldTotal: [...holdCounts.values()].reduce((sum, count) => sum + count, 0),
    upcoming: upcoming.map((row) => ({
      jobId: row.id,
      number: row.number,
      priority: row.priority,
      scheduledStart: row.scheduledStart!,
      customerName: row.customer.tradingName ?? row.customer.legalName,
      siteName: row.site.name,
      assetTags: row.cranes.map(({ crane }) => crane.assetTag),
    })),
    today: {
      visits: todayVisits.map((row) => ({
        jobId: row.id,
        number: row.number,
        priority: row.priority,
        status: row.status,
        scheduledStart: row.scheduledStart!,
        customerName: row.customer.tradingName ?? row.customer.legalName,
        siteName: row.site.name,
        assetTags: row.cranes.map(({ crane }) => crane.assetTag),
      })),
      // A handover can put two people on call at once. Both are shown: either can take the call.
      onCall: onCall.map((row) => ({
        technicianId: row.technicianId,
        technicianName: row.technician.user.name,
        until: row.endAt,
      })),
    },
    sinceYesterday: {
      p1Open: trend(counts.p1Open, before.p1Open),
      slaBreached: trend(counts.slaBreached, before.slaBreached),
      lateVisits: trend(counts.overdue, before.overdue),
      awaitingInvoicing: trend(counts.awaitingInvoicing, before.awaitingInvoicing),
    },
  }
}

/** The four attention counts, read at one instant. Pulled out so "now" and "yesterday" share a rule. */
function countJobs(
  rows: Array<{
    status: JobStatus
    priority: string
    scheduledStart: Date | null
    reportedAt: Date | null
    respondedAt: Date | null
    completedAt: Date | null
    closedAt: Date | null
    slaResponseDue: Date | null
    slaResolveDue: Date | null
  }>,
  at: Date,
): Pick<DashboardCounts, 'p1Open' | 'slaBreached' | 'overdue' | 'awaitingInvoicing'> {
  let p1Open = 0
  let slaBreached = 0
  let overdue = 0
  let awaitingInvoicing = 0

  for (const row of rows) {
    if (row.priority === 'P1') p1Open += 1

    const sla = jobSla(row, at)
    if (sla.response.state === 'breached' || sla.resolution.state === 'breached') slaBreached += 1

    // The visit was due, the technician has not started it, and the job has not been finished.
    const started = row.status === 'IN_PROGRESS' || row.status === 'COMPLETED'
    if (row.scheduledStart && row.scheduledStart.getTime() < at.getTime() && !started) overdue += 1

    // Reviewed means the work is signed off and the paperwork is waiting for an invoice.
    if (row.status === 'REVIEWED') awaitingInvoicing += 1
  }

  return { p1Open, slaBreached, overdue, awaitingInvoicing }
}

/** Midnight today in the operating timezone, as an instant. */
function startOfDay(at: Date, timeZone: string): Date {
  const { year, month, day } = dayKeyParts(at, timeZone)
  return wallTimeToUtc(year, month, day, 0, 0, timeZone)
}

/** Midnight tomorrow in the operating timezone — the exclusive end of today's window. */
function endOfDay(at: Date, timeZone: string): Date {
  const { year, month, day } = dayKeyParts(at, timeZone)
  return wallTimeToUtc(year, month, day + 1, 0, 0, timeZone)
}

function dayKeyParts(at: Date, timeZone: string): { year: number; month: number; day: number } {
  const [year, month, day] = dayKey(at, timeZone).split('-').map(Number) as [number, number, number]
  return { year, month, day }
}
