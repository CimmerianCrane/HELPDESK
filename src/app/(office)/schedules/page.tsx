import type { Metadata } from 'next'
import Link from 'next/link'
import { cardClass } from '@/components/office/ui'
import { formatDate } from '@/lib/format'
import { SCHEDULE_TYPES, SCHEDULE_TYPE_LABELS } from '@/lib/validation/schedules'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { DUE_BUCKET_LABELS, daysUntil, type DueBucket } from '@/server/schedules/recurrence'
import { listSchedules, scheduleCounts } from '@/server/schedules/schedules'
import { getSettings } from '@/server/settings/settings'
import { CreateScheduleForm } from './new/form'

export const metadata: Metadata = { title: 'Schedules — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/** Least urgent first in the eye, most urgent in the markup: overdue is the one people act on. */
const BUCKET_STYLES: Record<DueBucket, string> = {
  overdue: 'border-red-300 bg-red-50 font-medium text-red-800',
  '30': 'border-amber-300 bg-amber-50 text-amber-900',
  '60': 'border-amber-200 bg-amber-50 text-amber-900',
  '90': 'border-slate-200 bg-white text-slate-700',
  later: 'border-slate-200 bg-white text-slate-600',
  none: 'border-slate-200 bg-slate-100 text-slate-600',
}

/**
 * Recurring obligations across every crane the caller may read (slice 12, brief §8).
 *
 * The page is a list, not a calendar: the question it answers is "what is falling due and what have we
 * already missed", which is a queue rather than a grid. The dashboard tile links here, and the counts
 * at the top come from the same service the list does, so the two cannot disagree.
 */
export default async function SchedulesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; due?: string; scheduleType?: string }>
}) {
  const context = await requireAuth()
  const params = await searchParams

  const filters = {
    q: params.q ?? '',
    due: params.due ?? '',
    scheduleType: params.scheduleType ?? '',
  }

  const [schedules, counts, settings] = await Promise.all([
    listSchedules(context, filters),
    scheduleCounts(context),
    getSettings(),
  ])

  const mayManage = can(context.role, 'schedule.manage')
  const filtered = Boolean(filters.q || filters.due || filters.scheduleType)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Schedules</h1>
        <p className="mt-1 text-slate-600">
          {counts.overdue === 0
            ? 'Nothing is overdue.'
            : `${counts.overdue} overdue.`}{' '}
          {counts.dueWithin30Days} due in the next 30 days.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="block text-sm font-medium text-slate-700">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={filters.q}
            placeholder="Asset tag, customer or site"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="due" className="block text-sm font-medium text-slate-700">
            Due
          </label>
          <select
            id="due"
            name="due"
            defaultValue={filters.due}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          >
            <option value="">Everything</option>
            <option value="overdue">{DUE_BUCKET_LABELS.overdue}</option>
            <option value="30">{DUE_BUCKET_LABELS['30']}</option>
            <option value="60">{DUE_BUCKET_LABELS['60']}</option>
            <option value="90">{DUE_BUCKET_LABELS['90']}</option>
            <option value="none">{DUE_BUCKET_LABELS.none}</option>
          </select>
        </div>

        <div>
          <label htmlFor="scheduleType" className="block text-sm font-medium text-slate-700">
            Kind
          </label>
          <select
            id="scheduleType"
            name="scheduleType"
            defaultValue={filters.scheduleType}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          >
            <option value="">All</option>
            {SCHEDULE_TYPES.map((type) => (
              <option key={type} value={type}>
                {SCHEDULE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800">
          Filter
        </button>

        {filtered ? (
          <Link href="/schedules" className="px-2 py-2 text-sm text-slate-600 underline">
            Clear
          </Link>
        ) : null}
      </form>

      {schedules.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-slate-900">
            {filtered ? 'Nothing matches those filters.' : 'No schedules yet.'}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {filtered
              ? 'Try a shorter search, or clear the filters.'
              : 'A schedule is raised against a crane: open the crane and add one under Schedules.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Recurring crane schedules, soonest due first</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Crane</th>
                <th scope="col" className="px-4 py-3 font-medium">Kind</th>
                <th scope="col" className="px-4 py-3 font-medium">Every</th>
                <th scope="col" className="px-4 py-3 font-medium">Last done</th>
                <th scope="col" className="px-4 py-3 font-medium">Next due</th>
                <th scope="col" className="px-4 py-3 font-medium">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schedules.map((schedule) => {
                const days = daysUntil(schedule.nextDueDate)
                return (
                  <tr key={schedule.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/cranes/${schedule.crane.id}`}
                        className="font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                      >
                        {schedule.crane.assetTag}
                      </Link>
                      <span className="block text-xs text-slate-500">
                        {schedule.crane.customerName} · {schedule.crane.siteName}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {SCHEDULE_TYPE_LABELS[schedule.scheduleType]}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {schedule.intervalMonths ? `${schedule.intervalMonths} mo` : 'One-off'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(schedule.lastDoneDate, settings.timezone)}
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      {formatDate(schedule.nextDueDate, settings.timezone)}
                      {days !== null ? (
                        <span className="block text-xs text-slate-500">
                          {days < 0
                            ? `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} overdue`
                            : days === 0
                              ? 'Today'
                              : `in ${days} ${days === 1 ? 'day' : 'days'}`}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded border px-2 py-0.5 text-xs ${BUCKET_STYLES[schedule.dueBucket]}`}
                      >
                        {DUE_BUCKET_LABELS[schedule.dueBucket]}
                      </span>
                      {schedule.source === 'RULE' ? (
                        <span className="mt-1 block text-xs text-slate-500">From a rule</span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {mayManage ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Add a schedule</h2>
          <p className="mt-1 mb-5 text-sm text-slate-600">
            Intervals are yours to set here. Nothing in the app decides one for you — that is what the
            compliance rules in slice 14 will be for, with a source reference beside each.
          </p>
          <CreateScheduleForm />
        </section>
      ) : null}
    </div>
  )
}
