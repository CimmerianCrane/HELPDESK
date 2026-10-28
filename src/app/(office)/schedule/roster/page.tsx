import type { Metadata } from 'next'
import Link from 'next/link'
import { LeaveForm, OnCallForm } from '@/components/office/schedule-forms'
import { cardClass } from '@/components/office/ui'
import { formatDate, formatDateTime } from '@/lib/format'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { addDays, isoDay, parseIsoDay } from '@/server/schedule/board'
import {
  listResources,
  listTechnicians,
  listUnavailability,
  onCallRoster,
} from '@/server/schedule/roster'
import { getSettings } from '@/server/settings/settings'
import {
  createLeaveAction,
  createOnCallAction,
  deleteLeaveAction,
  deleteOnCallAction,
} from '../actions'

export const metadata: Metadata = { title: 'Roster — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The roster: who is unavailable, who is on call, and what kit is where.
 *
 * These are the inputs to scheduling rather than the act of it, which is why they live on their own
 * page: leave is booked weeks ahead in a different conversation from the one that moves Tuesday's
 * visit. Showing both here keeps the board about the decision.
 */
export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const context = await requireAuth()
  const params = await searchParams

  const from = parseIsoDay(params.date, new Date())
  const to = addDays(from, 7)

  const [technicians, leave, roster, resources, settings] = await Promise.all([
    listTechnicians(context),
    listUnavailability(context, { from, to }),
    onCallRoster(context, { from, to }),
    can(context.role, 'resource.read') ? listResources(context) : Promise.resolve([]),
    getSettings(),
  ])

  const active = technicians.filter((technician) => technician.isActive)

  return (
    <div className="space-y-8">
      <div>
        <Link href="/schedule" className="text-sm text-slate-600 underline hover:text-slate-900">
          ← Schedule
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Roster</h1>
        <p className="mt-1 text-slate-600">
          Availability, on-call cover and the kit that gets booked out. Week of{' '}
          {formatDate(from, settings.timezone)}.
        </p>
      </div>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">On-call cover</h2>
        <p className="mt-1 text-sm text-slate-600">
          Shifts may overlap — two people reachable at a handover is safer than a clean cut. What
          matters is the holes.
        </p>

        {roster.gaps.length === 0 ? (
          <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Somebody is on call for every hour of this week.
          </p>
        ) : (
          <ul className="mt-3 space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {roster.gaps.map((gap) => (
              <li key={gap.start.toISOString()}>
                Nobody on call {formatDateTime(gap.start, settings.timezone)} –{' '}
                {formatDateTime(gap.end, settings.timezone)}
              </li>
            ))}
          </ul>
        )}

        {roster.shifts.length > 0 ? (
          <ul className="mt-4 divide-y divide-slate-100">
            {roster.shifts.map((shift) => (
              <li key={shift.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">{shift.technicianName}</p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(shift.startAt, settings.timezone)} –{' '}
                    {formatDateTime(shift.endAt, settings.timezone)}
                    {shift.notes ? ` · ${shift.notes}` : ''}
                  </p>
                </div>
                <form action={async () => deleteOnCallAction(shift.id)}>
                  <button type="submit" className="text-sm text-slate-600 underline hover:text-red-700">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No shifts recorded for this week.</p>
        )}

        <div className="mt-6 max-w-md">
          <OnCallForm action={createOnCallAction} technicians={active} />
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Leave</h2>
        <p className="mt-1 text-sm text-slate-600">
          Leave booked over work already scheduled does not shrink anybody&apos;s diary: it appears on
          the board so the visit can be moved.
        </p>

        {leave.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Nobody is on leave this week.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {leave.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">{entry.technicianName}</p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(entry.startAt, settings.timezone)} –{' '}
                    {formatDateTime(entry.endAt, settings.timezone)}
                    {entry.reason ? ` · ${entry.reason}` : ''}
                  </p>
                </div>
                <form action={async () => deleteLeaveAction(entry.id)}>
                  <button type="submit" className="text-sm text-slate-600 underline hover:text-red-700">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 max-w-md">
          <LeaveForm action={createLeaveAction} technicians={active} />
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Competencies</h2>
        <p className="mt-1 text-sm text-slate-600">
          Whether a gap blocks or merely warns is a setting; an expired ticket is shown either way.
        </p>

        <ul className="mt-4 space-y-3">
          {technicians.map((technician) => (
            <li key={technician.id} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: technician.colour ?? '#94a3b8' }}
                />
                <p className="text-sm font-medium text-slate-900">{technician.name}</p>
                {technician.isActive ? null : (
                  <span className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600">
                    inactive
                  </span>
                )}
              </div>
              {technician.competencies.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">No competencies on record.</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {technician.competencies.map((competency) => (
                    <li
                      key={competency.id}
                      className={
                        competency.expired
                          ? 'rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-800'
                          : 'rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700'
                      }
                    >
                      {competency.name}
                      {competency.expiryDate
                        ? ` · expires ${formatDate(competency.expiryDate, settings.timezone)}`
                        : ''}
                      {competency.expired ? ' — expired' : ''}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      {can(context.role, 'resource.read') ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Resources</h2>
          <p className="mt-1 text-sm text-slate-600">
            Booking is from a job, so the resource is tied to the visit that needs it.
          </p>

          {resources.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No resources are on record yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {resources.map((resource) => (
                <li key={resource.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{resource.name}</p>
                    <p className="text-xs text-slate-500">
                      {resource.type.toLowerCase().replace('_', ' ')}
                      {resource.serialNumber ? ` · ${resource.serialNumber}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {resource.calibrationDueDate ? (
                      <span
                        className={
                          resource.calibrationOverdue
                            ? 'rounded border border-red-200 bg-red-50 px-2 py-0.5 text-red-800'
                            : 'rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600'
                        }
                      >
                        calibration {formatDate(resource.calibrationDueDate, settings.timezone)}
                      </span>
                    ) : null}
                    <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">
                      {resource.status.toLowerCase().replace('_', ' ')}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <p className="text-sm text-slate-500">
        Showing the week starting {isoDay(from)}. Bookings are made from a job&apos;s own page.
      </p>
    </div>
  )
}
