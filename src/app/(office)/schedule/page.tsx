import type { Metadata } from 'next'
import Link from 'next/link'
import { ScheduleBoardView } from '@/components/office/schedule-board'
import { cardClass } from '@/components/office/ui'
import { addDays, isoDay } from '@/server/schedule/board'
import { requireAuth } from '@/server/auth/context'
import { listTechnicians } from '@/server/schedule/roster'
import { scheduleBoard } from '@/server/schedule/scheduling'
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

  const [board, technicians] = await Promise.all([
    scheduleBoard(context, {
      view: params.view ?? '',
      date: params.date ?? '',
      technicianId: params.technicianId ?? '',
    }),
    listTechnicians(context),
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
          <h1 className="text-2xl font-semibold text-slate-900">Schedule</h1>
          <p className="mt-1 text-slate-600">
            Who is going where, and when. Drag a visit to move it.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={href({ date: previous })}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            ← {board.view === 'week' ? 'Previous week' : 'Previous day'}
          </Link>
          <Link
            href={href({ date: today })}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            Today
          </Link>
          <Link
            href={href({ date: next })}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            {board.view === 'week' ? 'Next week' : 'Next day'} →
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
          {(['day', 'week'] as const).map((view) => (
            <Link
              key={view}
              href={href({ view })}
              className={
                board.view === view
                  ? 'bg-slate-900 px-4 py-1.5 text-sm font-medium text-white'
                  : 'bg-white px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100'
              }
            >
              {view === 'day' ? 'Day' : 'Week'}
            </Link>
          ))}
        </div>

        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="view" value={board.view} />
          <div>
            <label htmlFor="schedule-date" className="block text-sm font-medium text-slate-700">
              Show
            </label>
            <input
              id="schedule-date"
              name="date"
              type="date"
              defaultValue={board.day}
              className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="schedule-technician" className="block text-sm font-medium text-slate-700">
              Technician
            </label>
            <select
              id="schedule-technician"
              name="technicianId"
              defaultValue={params.technicianId ?? ''}
              className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
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
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Show
          </button>
        </form>
      </div>

      <ScheduleBoardView board={board} reassign={moveJobCardAction} />

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Resources</h2>
        <p className="mt-1 text-sm text-slate-600">
          Vehicles, test weights and load cells. A resource booked onto two jobs at once is a
          technician standing in a yard waiting for it.
        </p>

        {board.resources.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No resources are on record yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {board.resources.map((resource) => (
              <li key={resource.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">{resource.name}</p>
                  <p className="text-xs text-slate-500">
                    {resource.type.toLowerCase().replace('_', ' ')}
                    {resource.bookedMinutes > 0
                      ? ` · ${Math.round(resource.bookedMinutes / 60)}h booked`
                      : ' · free'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {resource.conflicts > 0 ? (
                    <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">
                      {resource.conflicts} double-booking{resource.conflicts === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  <span
                    className={
                      resource.status === 'RETIRED' || resource.status === 'MAINTENANCE'
                        ? 'rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-900'
                        : 'rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600'
                    }
                  >
                    {resource.status.toLowerCase().replace('_', ' ')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Link href="/schedule/roster" className="mt-4 inline-block text-sm text-slate-700 underline">
          Book a resource, record leave or manage on-call
        </Link>
      </section>
    </div>
  )
}
