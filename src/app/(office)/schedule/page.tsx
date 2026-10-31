import type { Metadata } from 'next'
import Link from 'next/link'
import { ScheduleBoardView } from '@/components/office/schedule-board'
import { cardClass } from '@/components/office/ui'
import { addDays, isoDay } from '@/server/schedule/board'
import { requireAuth } from '@/server/auth/context'
import { listTechnicians } from '@/server/schedule/roster'
import { dayRoute } from '@/server/schedule/routes-service'
import { scheduleBoard } from '@/server/schedule/scheduling'
import { formatDuration, formatDateTime } from '@/lib/format'
import { moveJobCardAction } from './actions'

export const metadata: Metadata = { title: 'Schedule — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The schedule board (brief §4.4).
 *
 * The page owns the window — which day, which way — because that is a URL, and a dispatcher who
 * refreshes or shares a link should land on the same week. Everything inside the window is the
 * service's answer; this file does no scheduling arithmetic of its own.
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; technicianId?: string }>
}) {
  const context = await requireAuth()
  const params = await searchParams

  const [board, technicians, route] = await Promise.all([
    scheduleBoard(context, {
      view: params.view ?? '',
      date: params.date ?? '',
      technicianId: params.technicianId ?? '',
    }),
    listTechnicians(context),
    dayRoute(context, {
      date: params.date ?? '',
      technicianId: params.technicianId ?? '',
    }),
  ])

  const day = new Date(`${board.day}T00:00:00.000Z`)
  const previous = isoDay(addDays(day, board.view === 'week' ? -7 : -1))
  const next = isoDay(addDays(day, board.view === 'week' ? 7 : 1))
  const today = isoDay(new Date())

  const href = (overrides: { view?: string; date?: string; technicianId?: string }) => {
    const query = new URLSearchParams()
    query.set('view', overrides.view ?? board.view)
    query.set('date', overrides.date ?? board.day)
    const technicianId = overrides.technicianId ?? params.technicianId
    if (technicianId) query.set('technicianId', technicianId)
    return `/schedule?${query.toString()}`
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-title font-semibold text-ink">Schedule</h1>
          <p className="mt-1 text-muted">
            Who is going where, and when. Drag a visit to move it.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={href({ date: previous })}
            className="rounded-md border border-line bg-field px-3 py-1.5 text-sm text-ink hover:bg-raised"
          >
            ← {board.view === 'week' ? 'Previous week' : 'Previous day'}
          </Link>
          <Link
            href={href({ date: today })}
            className="rounded-md border border-line bg-field px-3 py-1.5 text-sm text-ink hover:bg-raised"
          >
            Today
          </Link>
          <Link
            href={href({ date: next })}
            className="rounded-md border border-line bg-field px-3 py-1.5 text-sm text-ink hover:bg-raised"
          >
            {board.view === 'week' ? 'Next week' : 'Next day'} →
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex overflow-hidden rounded-md border border-line">
          {(['day', 'week'] as const).map((view) => (
            <Link
              key={view}
              href={href({ view })}
              className={
                board.view === view
                  ? 'bg-accent px-4 py-1.5 text-sm font-medium text-white'
                  : 'bg-field px-4 py-1.5 text-sm text-ink hover:bg-raised'
              }
            >
              {view === 'day' ? 'Day' : 'Week'}
            </Link>
          ))}
        </div>

        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="view" value={board.view} />
          <div>
            <label htmlFor="schedule-date" className="block text-sm font-medium text-ink">
              Show
            </label>
            <input
              id="schedule-date"
              name="date"
              type="date"
              defaultValue={board.day}
              className="mt-1 block rounded-md border border-line bg-field px-3 py-1.5 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
            />
          </div>
          <div>
            <label htmlFor="schedule-technician" className="block text-sm font-medium text-ink">
              Technician
            </label>
            <select
              id="schedule-technician"
              name="technicianId"
              defaultValue={params.technicianId ?? ''}
              className="mt-1 block rounded-md border border-line bg-field px-3 py-1.5 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
            >
              <option value="">Everybody</option>
              {technicians.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-anchor-soft"
          >
            Show
          </button>
        </form>
      </div>

      <ScheduleBoardView board={board} reassign={moveJobCardAction} />

      <section className={cardClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-ink">Round for {route.dayLabel}</h2>
          {route.stops.length > 1 ? (
            <p className="text-sm text-muted">
              {route.totalKm.toFixed(1)} km in a line · about{' '}
              {formatDuration(route.driveMinutes * 60_000)} driving
            </p>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted">
          The order to drive them in, from whichever visit is scheduled first. Distances are
          straight-line and the time assumes {route.averageSpeedKmh} km/h — a guide for the order,
          not a mileage claim.
        </p>

        {route.stops.length === 0 && route.unlocated.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No visits are booked on this day.</p>
        ) : (
          <ol className="mt-4 space-y-2">
            {route.stops.map((stop) => (
              <li key={stop.jobId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1">
                <span className="w-5 text-sm font-semibold text-muted">{stop.position}</span>
                <Link href={`/jobs/${stop.jobId}`} className="text-sm font-medium text-ink underline">
                  {stop.jobNumber}
                </Link>
                <span className="text-sm text-ink">
                  {stop.siteName} · {stop.customerName}
                </span>
                {stop.address ? <span className="text-xs text-muted">{stop.address}</span> : null}
                <span className="text-xs text-muted">
                  {stop.position === 1
                    ? formatDateTime(stop.scheduledStart, route.timezone)
                    : `+${stop.legKm.toFixed(1)} km from the stop before`}
                </span>
              </li>
            ))}
          </ol>
        )}

        {route.unlocated.length > 0 ? (
          <div className="mt-4 rounded border border-warn/40 bg-warn/10 p-3">
            <p className="text-sm font-medium text-warn">
              {route.unlocated.length} visit{route.unlocated.length === 1 ? '' : 's'} cannot be placed
              on the round: the site has no coordinates.
            </p>
            <ul className="mt-1 space-y-0.5 text-sm text-warn">
              {route.unlocated.map((stop) => (
                <li key={stop.jobId}>
                  <Link href={`/jobs/${stop.jobId}`} className="underline">
                    {stop.jobNumber}
                  </Link>{' '}
                  — {stop.siteName}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-warn">
              Add latitude and longitude on the site and the visit joins the round.
            </p>
          </div>
        ) : null}
      </section>

      <section className={cardClass}>
        <h2 className="font-semibold text-ink">Resources</h2>
        <p className="mt-1 text-sm text-muted">
          Vehicles, test weights and load cells. A resource booked onto two jobs at once is a
          technician standing in a yard waiting for it.
        </p>

        {board.resources.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No resources are on record yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-rule">
            {board.resources.map((resource) => (
              <li key={resource.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div>
                  <p className="text-sm font-medium text-ink">{resource.name}</p>
                  <p className="text-xs text-muted">
                    {resource.type.toLowerCase().replace('_', ' ')}
                    {resource.bookedMinutes > 0
                      ? ` · ${Math.round(resource.bookedMinutes / 60)}h booked`
                      : ' · free'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {resource.conflicts > 0 ? (
                    <span className="rounded border border-neg/40 bg-neg/10 px-2 py-0.5 text-xs font-medium text-neg">
                      {resource.conflicts} double-booking{resource.conflicts === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  <span
                    className={
                      resource.status === 'RETIRED' || resource.status === 'MAINTENANCE'
                        ? 'rounded border border-warn/40 bg-warn/10 px-2 py-0.5 text-xs text-warn'
                        : 'rounded border border-line bg-sheet px-2 py-0.5 text-xs text-muted'
                    }
                  >
                    {resource.status.toLowerCase().replace('_', ' ')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Link href="/schedule/roster" className="mt-4 inline-block text-sm text-ink underline">
          Book a resource, record leave or manage on-call
        </Link>
      </section>
    </div>
  )
}
