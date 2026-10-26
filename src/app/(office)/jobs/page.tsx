import type { Metadata } from 'next'
import Link from 'next/link'
import { JobSlaBadge, JobStatusBadge } from '@/components/office/job-badges'
import { PriorityBadge } from '@/components/office/ticket-badges'
import { cardClass } from '@/components/office/ui'
import { formatDateTime } from '@/lib/format'
import { JOB_STATUSES } from '@/server/jobs/status'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { JOB_STATUS_LABELS } from '@/server/jobs/labels'
import { listJobs, openJobStats } from '@/server/jobs/jobs'
import { getSettings } from '@/server/settings/settings'
import { PRIORITY_SHORT_LABELS } from '@/server/tickets/labels'

export const metadata: Metadata = { title: 'Jobs — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The work board: everything that has been decided, from the moment a ticket becomes a job until it
 * is closed. Ordered the way a dispatcher works down it — live before finished, urgent before routine,
 * oldest first.
 *
 * The three tiles are the questions asked every morning: what is outstanding, what has missed its
 * target, and what is stuck waiting on somebody else.
 */
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; priority?: string }>
}) {
  const context = await requireAuth()
  const { q, status, priority } = await searchParams

  const [jobs, stats, settings] = await Promise.all([
    listJobs(context, { q: q ?? '', status: status ?? '', priority: priority ?? '' }),
    openJobStats(context),
    getSettings(),
  ])

  const mayCreate = can(context.role, 'job.create')
  const filtered = Boolean(q || status || priority)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Jobs</h1>
          <p className="mt-1 text-slate-600">The work, from the decision to the invoice.</p>
        </div>

        {mayCreate ? (
          <Link
            href="/jobs/new"
            className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800"
          >
            Create a job
          </Link>
        ) : null}
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <div className={`${cardClass} py-4`}>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Open</dt>
          <dd className="mt-1 text-2xl font-semibold text-slate-900">{stats.open}</dd>
        </div>
        <div className={`${cardClass} py-4`}>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Past an SLA target
          </dt>
          <dd
            className={
              stats.breached > 0
                ? 'mt-1 text-2xl font-semibold text-red-700'
                : 'mt-1 text-2xl font-semibold text-slate-900'
            }
          >
            {stats.breached}
          </dd>
        </div>
        <div className={`${cardClass} py-4`}>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">On hold</dt>
          <dd
            className={
              stats.onHold > 0
                ? 'mt-1 text-2xl font-semibold text-amber-800'
                : 'mt-1 text-2xl font-semibold text-slate-900'
            }
          >
            {stats.onHold}
          </dd>
        </div>
      </dl>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="block text-sm font-medium text-slate-700">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Job number, customer, asset tag or PO reference"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="status" className="block text-sm font-medium text-slate-700">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ''}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          >
            <option value="">All</option>
            {JOB_STATUSES.map((value) => (
              <option key={value} value={value}>
                {JOB_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="priority" className="block text-sm font-medium text-slate-700">
            Priority
          </label>
          <select
            id="priority"
            name="priority"
            defaultValue={priority ?? ''}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          >
            <option value="">All</option>
            {Object.entries(PRIORITY_SHORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800"
        >
          Filter
        </button>

        {filtered ? (
          <Link href="/jobs" className="px-2 py-2 text-sm text-slate-600 underline">
            Clear
          </Link>
        ) : null}
      </form>

      {jobs.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-slate-900">
            {filtered ? 'Nothing matches those filters.' : 'No jobs yet.'}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {filtered
              ? 'Try a shorter search, or clear the filters.'
              : mayCreate
                ? 'Raise one directly, or turn a triaged ticket into jobs.'
                : 'Jobs appear here once the office has decided what is happening.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Jobs</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Job</th>
                <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                <th scope="col" className="px-4 py-3 font-medium">Cranes</th>
                <th scope="col" className="px-4 py-3 font-medium">Priority</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">SLA</th>
                <th scope="col" className="px-4 py-3 font-medium">Raised</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((job) => (
                <tr key={job.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/jobs/${job.id}`}
                      className="font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                    >
                      {job.number}
                    </Link>
                    <span className="mt-0.5 block text-xs text-slate-500">{job.jobType.name}</span>
                    {job.ticket ? (
                      <Link
                        href={`/tickets/${job.ticket.id}`}
                        className="mt-0.5 block text-xs text-slate-500 underline"
                      >
                        from {job.ticket.number}
                      </Link>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/customers/${job.customer.id}`} className="text-slate-900 underline">
                      {job.customer.tradingName ?? job.customer.legalName}
                    </Link>
                    {job.site ? (
                      <span className="block text-xs text-slate-500">{job.site.name}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {job.cranes.length === 0
                      ? '—'
                      : job.cranes.map((crane) => crane.assetTag).join(', ')}
                  </td>
                  <td className="px-4 py-3">
                    <PriorityBadge priority={job.priority} />
                  </td>
                  <td className="px-4 py-3">
                    <JobStatusBadge status={job.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <JobSlaBadge label="Response" sla={job.sla.response} />
                      <JobSlaBadge label="Resolve" sla={job.sla.resolution} />
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {job.reportedAt ? formatDateTime(job.reportedAt, settings.timezone) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
