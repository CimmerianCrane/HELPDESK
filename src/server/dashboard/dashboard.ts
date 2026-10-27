import type { JobStatus, OnHoldReason } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { addDays } from '@/lib/time'
import { assertCan } from '@/server/auth/permissions'
import { jobReadWhere, craneReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { jobSla } from '@/server/jobs/jobs'

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
  dueWithin30Days: number
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

  const [jobs, expiringCertificates, upcoming, visitsBooked, dueSchedules] = await Promise.all([
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
    client.certificate.count({
      where: {
        deletedAt: null,
        expiryDate: { gte: now, lte: horizon },
        crane: { deletedAt: null },
      },
    }),
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
    // Recurring obligations due in the next 30 days. `CraneSchedule` is seeded by later slices; until
    // it has rows this tile honestly reads zero rather than inventing an estimate from job history.
    client.craneSchedule.count({
      where: { nextDueDate: { gte: now, lte: horizon }, crane: craneReadWhere(context) },
    }),
  ])

  let p1Open = 0
  let slaBreached = 0
  let overdue = 0
  let awaitingInvoicing = 0
  const holdCounts = new Map<OnHoldReason, number>()

  for (const row of jobs) {
    if (row.priority === 'P1') p1Open += 1

    const sla = jobSla(row, now)
    if (sla.response.state === 'breached' || sla.resolution.state === 'breached') slaBreached += 1

    // The visit was due, the technician has not started it, and the job has not been finished.
    const started = row.status === 'IN_PROGRESS' || row.status === 'COMPLETED'
    if (row.scheduledStart && row.scheduledStart.getTime() < now.getTime() && !started) overdue += 1

    // Reviewed means the work is signed off and the paperwork is waiting for an invoice.
    if (row.status === 'REVIEWED') awaitingInvoicing += 1

    if (row.status === 'ON_HOLD' && row.onHoldReason) {
      holdCounts.set(row.onHoldReason, (holdCounts.get(row.onHoldReason) ?? 0) + 1)
    }
  }

  return {
    p1Open,
    slaBreached,
    overdue,
    awaitingInvoicing,
    visitsBooked,
    dueWithin30Days: dueSchedules,
    certificatesExpiring: expiringCertificates,
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
  }
}
