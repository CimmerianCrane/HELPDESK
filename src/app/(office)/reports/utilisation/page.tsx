import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cardClass } from '@/components/office/ui'
import { formatDate } from '@/lib/format'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { utilisationReport, type UtilisationRow } from '@/server/reports/utilisation'
import { getSettings } from '@/server/settings/settings'

export const metadata: Metadata = { title: 'Utilisation — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * Technician utilisation (brief §11, slice 33): time on the tools and time on the road against the
 * hours that were actually available, read from the job status history the app already keeps.
 */
export default async function UtilisationPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const context = await requireAuth()
  if (!can(context.role, 'report.financial')) notFound()

  const params = await searchParams
  const filters = { from: params.from ?? '', to: params.to ?? '' }

  const [report, settings] = await Promise.all([utilisationReport(context, filters), getSettings()])
  const filtered = Boolean(filters.from || filters.to)
  const hours = (value: number) => `${value.toFixed(1)} h`

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Utilisation</h1>
        <p className="mt-1 text-slate-600">
          {report.totals.jobs} completed {report.totals.jobs === 1 ? 'job' : 'jobs'} ·{' '}
          {hours(report.totals.onSiteHours)} on the tools · {hours(report.totals.roadHours)} on the
          road · {report.workingDays} working {report.workingDays === 1 ? 'day' : 'days'} from{' '}
          {formatDate(report.window.from, settings.timezone)} to{' '}
          {formatDate(new Date(report.window.to.getTime() - 1), settings.timezone)}.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          Hours come from the job status history: <strong>on the tools</strong> is in-progress until
          the job next moves, summed over however many visits it took, and{' '}
          <strong>on the road</strong> runs from dispatch to completion so it includes the travel
          either side. A job with two technicians splits its hours between them. Available time is
          Monday–Friday, 09:00–17:00, less leave booked in the period — there is no shift pattern or
          public-holiday calendar. A job still in progress is not counted until it completes, so the
          most recent days read low.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="from" className="block text-sm font-medium text-slate-700">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={params.from ?? ''}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="to" className="block text-sm font-medium text-slate-700">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={params.to ?? ''}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800"
        >
          Apply
        </button>
        {filtered ? (
          <Link href="/reports/utilisation" className="px-2 py-2 text-sm text-slate-600 underline">
            Clear
          </Link>
        ) : null}
      </form>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">By technician</h2>

        {report.rows.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No technician has a login in the register yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Hours and utilisation by technician</caption>
              <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th scope="col" className="py-2 font-medium">Technician</th>
                  <th scope="col" className="py-2 text-right font-medium">Jobs</th>
                  <th scope="col" className="py-2 text-right font-medium">On the tools</th>
                  <th scope="col" className="py-2 text-right font-medium">On the road</th>
                  <th scope="col" className="py-2 text-right font-medium">Leave</th>
                  <th scope="col" className="py-2 text-right font-medium">Available</th>
                  <th scope="col" className="py-2 text-right font-medium">Utilisation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.rows.map((row) => (
                  <UtilisationTableRow key={row.technicianId} row={row} hours={hours} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {report.unassignedJobs > 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            {report.unassignedJobs} completed {report.unassignedJobs === 1 ? 'job has' : 'jobs have'}{' '}
            no technician on it, so its hours are in no row above. The job list will show which.
          </p>
        ) : null}
      </section>
    </div>
  )
}

function UtilisationTableRow({
  row,
  hours,
}: {
  row: UtilisationRow
  hours: (value: number) => string
}) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="py-2 text-slate-900">
        {row.name}
        {row.isActive ? null : <span className="ml-2 text-xs text-slate-500">inactive</span>}
      </td>
      <td className="py-2 text-right text-slate-800">{row.jobs}</td>
      <td className="py-2 text-right text-slate-800">{hours(row.onSiteHours)}</td>
      <td className="py-2 text-right text-slate-800">{hours(row.roadHours)}</td>
      <td className="py-2 text-right text-slate-600">{hours(row.leaveHours)}</td>
      <td className="py-2 text-right text-slate-800">{hours(row.availableHours)}</td>
      <td className="py-2 text-right font-medium text-slate-900">
        {row.utilisationRatio === null ? '—' : `${Math.round(row.utilisationRatio * 100)}%`}
      </td>
    </tr>
  )
}
