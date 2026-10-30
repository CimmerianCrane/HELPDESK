import type { Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import { routeFilterSchema, type RouteFilter } from '@/lib/validation/schedule'
import { assertCan } from '@/server/auth/permissions'
import { jobReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { formatDate } from '@/lib/format'
import { getSettings } from '@/server/settings/settings'
import { boardWindow, isoDay, parseIsoDay } from './board'
import { planRoute, type RoutePoint } from './routes'

/**
 * The day's round (brief §4.4, slice 35).
 *
 * A read, not a write: the order is a suggestion the dispatcher acts on by moving cards, so nothing
 * here reschedules anything. What it adds over the board is the one thing the board cannot show —
 * which of today's visits is on the way to which.
 *
 * The road is measured in straight lines and the driving time comes from one average speed constant,
 * because nothing in the system knows traffic or real road distance. The screen says both, rather
 * than presenting a guess as a measurement.
 */

/** One stop on the round. */
export interface RouteStop {
  jobId: string
  jobNumber: string
  customerName: string
  siteName: string
  /** The one-line address the technician gets on the dispatch, or null when none is recorded. */
  address: string | null
  /** Arrival order on the round, 1-based. `0` when the stop could not be placed on a map. */
  position: number
  scheduledStart: Date | null
  scheduledEnd: Date | null
  /** Straight-line kilometres from the previous stop in the round. 0 for the first. */
  legKm: number
  technicianIds: string[]
  assetTags: string[]
}

export interface DayRoute {
  /** The day as `YYYY-MM-DD`, the form the URL and the board already use. */
  day: string
  timezone: string
  /** The day as `YYYY-MM-DD`, rendered for a person. */
  dayLabel: string
  stops: RouteStop[]
  /** Visits at a site with no coordinates: they cannot be placed, and the screen says so. */
  unlocated: RouteStop[]
  /** The round's total, straight-line. */
  totalKm: number
  /** The total at `AVERAGE_SPEED_KMH`, rounded to the minute. */
  driveMinutes: number
  averageSpeedKmh: number
}

/**
 * Driving speed for the estimate. Singapore industrial estates are slow going; 30 km/h covers the
 * lights and the gate queues. A constant rather than a setting because it was never asked for — move
 * it into `Setting` if the office ever wants to tune it.
 */
const AVERAGE_SPEED_KMH = 30

const routeJobSelect = {
  id: true,
  number: true,
  scheduledStart: true,
  scheduledEnd: true,
  customer: { select: { legalName: true, tradingName: true } },
  site: { select: { name: true, address: true, latitude: true, longitude: true } },
  cranes: { select: { crane: { select: { assetTag: true } } } },
  technicians: { select: { technicianId: true } },
} satisfies Prisma.JobSelect

type RouteJobRow = Prisma.JobGetPayload<{ select: typeof routeJobSelect }>

/** The JSON address column into one line, the way a dispatch writes it. */
function formatAddress(address: unknown): string | null {
  if (!address || typeof address !== 'object') return null
  const parts = ['line1', 'line2', 'city', 'postalCode']
    .map((key) => (address as Record<string, unknown>)[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  return parts.length ? parts.join(', ') : null
}

function toStop(row: RouteJobRow): RouteStop {
  return {
    jobId: row.id,
    jobNumber: row.number,
    customerName: row.customer.tradingName ?? row.customer.legalName,
    siteName: row.site.name,
    address: formatAddress(row.site.address),
    position: 0,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    legKm: 0,
    technicianIds: row.technicians.map((entry) => entry.technicianId),
    assetTags: row.cranes.map(({ crane }) => crane.assetTag),
  }
}

/**
 * Every visit that overlaps the day, in driving order.
 *
 * A technician filter narrows it to one person's day — the round that matters when you are the one
 * driving. Unassigned visits stay in: they are still a place somebody has to get to.
 */
export async function dayRoute(
  context: AuthContext,
  rawFilter: unknown = {},
  client: Tx = db,
  now: Date = new Date(),
): Promise<DayRoute> {
  assertCan(context, 'job.schedule')
  const filter = parseInput(routeFilterSchema, rawFilter) as RouteFilter
  const { timezone } = await getSettings(client)

  const day = parseIsoDay(filter.date, now)
  const window = boardWindow('day', day, timezone)

  const rows = await client.job.findMany({
    where: {
      ...jobReadWhere(context),
      status: { notIn: ['CLOSED', 'CANCELLED'] },
      scheduledStart: { lt: window.to },
      scheduledEnd: { gt: window.from },
      ...(filter.technicianId ? { technicians: { some: { technicianId: filter.technicianId } } } : {}),
    },
    select: routeJobSelect,
    orderBy: [{ scheduledStart: 'asc' }, { priority: 'asc' }],
    take: 200,
  })

  const placed: Array<{ row: RouteJobRow; point: RoutePoint }> = []
  const unlocated: RouteStop[] = []

  for (const row of rows) {
    const latitude = row.site.latitude === null ? null : Number(row.site.latitude)
    const longitude = row.site.longitude === null ? null : Number(row.site.longitude)
    if (latitude === null || longitude === null) {
      unlocated.push(toStop(row))
      continue
    }
    placed.push({ row, point: { id: row.id, latitude, longitude } })
  }

  // The first visit of the day keeps its place: the customer was told that time, and a round that
  // reorders it is a reschedule. The rest are ordered from there.
  const plan = planRoute(
    placed.map((entry) => entry.point),
    placed[0]?.row.id,
  )
  const byId = new Map(placed.map((entry) => [entry.row.id, entry.row]))

  return {
    day: isoDay(day),
    timezone,
    dayLabel: formatDate(window.from, timezone),
    stops: plan.ids.map((id, index) => ({
      ...toStop(byId.get(id)!),
      position: index + 1,
      legKm: plan.legs[index]!,
    })),
    unlocated,
    totalKm: plan.totalKm,
    driveMinutes: Math.round((plan.totalKm / AVERAGE_SPEED_KMH) * 60),
    averageSpeedKmh: AVERAGE_SPEED_KMH,
  }
}
