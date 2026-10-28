import type { Metadata } from 'next'
import Link from 'next/link'
import { JobSlaBadge, JobStatusBadge } from '@/components/office/job-badges'
import { SavedFilters } from '@/components/office/saved-filters'
import { PriorityBadge } from '@/components/office/ticket-badges'
import { cardClass } from '@/components/office/ui'
import { formatDateTime } from '@/lib/format'
import { pageNumber } from '@/lib/validation/jobs'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { calendarDays, calendarMonth, calendarRange, shiftMonth } from '@/server/jobs/calendar'
import { JOB_STATUS_LABELS } from '@/server/jobs/labels'
import { JOB_STATUSES } from '@/server/jobs/status'
import { listJobs, listJobTypes, openJobStats } from '@/server/jobs/jobs'
import { listSavedJobFilters } from '@/server/jobs/saved-filters'
import { listTechnicians } from '@/server/schedule/roster'
import { getSettings } from '@/server/settings/settings'
import { PRIORITY_SHORT_LABELS } from '@/server/tickets/labels'
import { deleteJobFilterAction, saveJobFilterAction } from './filter-actions'

export const metadata: Metadata = { title: 'Jobs — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/** How many rows a page shows. At the scale in ASSUMPTIONS 5 this is most of an ordinary month. */
const PAGE_SIZE = 50

/**
 * The company-wide job list (brief §8): every filter the brief names, as a link or a form nobody has
 * to guess at.
 *
 * Everything here is a URL. The filters, the sort, the page, the view and the month all live in the
 * query string, so a link to "P1s this week, breached" is a link somebody can send — and that is the
 * same property that makes a saved filter one row instead of a model.
 *
 * The three tiles are the questions asked every morning: what is outstanding, what has missed its
 * target, and what is stuck waiting on somebody else. They are the *whole* board's numbers, not the
 * filtered page's, because a dispatcher filtering by customer still wants to know the company total.
 */
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams

  // One string per key; a repeated key keeps its first value rather than becoming an array Zod
  // would flatten differently in two places.
  const single = (key: string): string => {
    const value = params[key]
    return (Array.isArray(value) ? value[0] : value) ?? ''
  }

  const view = single('view') === 'calendar' ? 'calendar' : 'list'
  // Identity and settings are independent, so they share a round trip. Everything after this needs
  // the timezone — the calendar window is two wall dates — so this is the last hop that can be saved.
  const [context, settings] = await Promise.all([requireAuth(), getSettings()])

  const filters = {
    q: single('q'),
    status: single('status'),
    priority: single('priority'),
    customerId: single('customerId'),
    jobTypeId: single('jobTypeId'),
    technicianId: single('technicianId'),
    from: single('from'),
    to: single('to'),
    sla: single('sla'),
    sort: single('sort'),
  }

  // The query this page is showing, so "save this filter" stores exactly what is on screen.
  const currentQuery = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value !== ''),
  ).toString()

  const month = calendarMonth(single('month'), new Date())
  const range = view === 'calendar' ? calendarRange(month, settings.timezone) : null

  const [allJobs, stats, saved, technicians, jobTypes] = await Promise.all([
    listJobs(
      context,
      range
        ? { ...filters, from: '', to: '' }
        : filters,
      undefined,
      new Date(),
      settings.timezone,
    ),
    openJobStats(context),
    listSavedJobFilters(context),
    can(context.role, 'job.schedule')
      ? listTechnicians(context)
      : Promise.resolve([]),
    listJobTypes(context),
  ])

  const jobs = range
    ? allJobs.filter(
        (job) =>
          job.scheduledStart &&
          job.scheduledStart.getTime() >= range.from.getTime() &&
          job.scheduledStart.getTime() < range.to.getTime(),
      )
    : allJobs

  const page = Math.min(pageNumber(single('page'), 1), Math.max(1, Math.ceil(jobs.length / PAGE_SIZE)))
  const pageJobs = view === 'calendar' ? jobs : jobs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const pages = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE))

  const mayCreate = can(context.role, 'job.create')
  const filtered = currentQuery !== ''

  /** The current filters plus an override, as a link. Used by paging and the calendar month arrows. */
  const href = (overrides: Record<string, string>): string => {
    const query = new URLSearchParams(
      Object.entries({ ...filters, view: view === 'calendar' ? 'calendar' : '', month: view === 'calendar' ? month : '', page: page > 1 ? String(page) : '', ...overrides }).filter(
        ([, value]) => value !== '',
      ),
    )
    const text = query.toString()
    return text ? `/jobs?${text}` : '/jobs'
  }

  const exportHref = `/jobs/export?${new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value !== ''),
  ).toString()}`

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

      <form method="get" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        {view === 'calendar' ? <input type="hidden" name="view" value="calendar" /> : null}
        {view === 'calendar' ? <input type="hidden" name="month" value={month} /> : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label htmlFor="q" className="block text-sm font-medium text-slate-700">
              Search
            </label>
            <input
              id="q"
              name="q"
              defaultValue={filters.q}
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
              defaultValue={filters.status}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
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
              defaultValue={filters.priority}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="">All</option>
              {Object.entries(PRIORITY_SHORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sla" className="block text-sm font-medium text-slate-700">
              SLA state
            </label>
            <select
              id="sla"
              name="sla"
              defaultValue={filters.sla}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="">Any</option>
              <option value="breached">Breached</option>
              <option value="at-risk">At risk</option>
              <option value="on-time">On time</option>
            </select>
          </div>

          <div>
            <label htmlFor="technicianId" className="block text-sm font-medium text-slate-700">
              Technician
            </label>
            <select
              id="technicianId"
              name="technicianId"
              defaultValue={filters.technicianId}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="">Anybody</option>
              {technicians.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="jobTypeId" className="block text-sm font-medium text-slate-700">
              Kind of work
            </label>
            <select
              id="jobTypeId"
              name="jobTypeId"
              defaultValue={filters.jobTypeId}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="">All</option>
              {jobTypes.map((jobType) => (
                <option key={jobType.id} value={jobType.id}>
                  {jobType.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="from" className="block text-sm font-medium text-slate-700">
              Visit from
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={filters.from}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="to" className="block text-sm font-medium text-slate-700">
              to
            </label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={filters.to}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="sort" className="block text-sm font-medium text-slate-700">
              Sort
            </label>
            <select
              id="sort"
              name="sort"
              defaultValue={filters.sort}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="">Working order</option>
              <option value="newest">Newest first</option>
              <option value="scheduled">By visit date</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800"
          >
            Filter
          </button>

          {filtered ? (
            <Link href={view === 'calendar' ? `/jobs?view=calendar` : '/jobs'} className="text-sm text-slate-600 underline">
              Clear
            </Link>
          ) : null}

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
              <Link
                href={href({ view: '', month: '', page: '' })}
                className={
                  view === 'list'
                    ? 'bg-slate-900 px-3 py-1.5 text-sm font-medium text-white'
                    : 'bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100'
                }
              >
                List
              </Link>
              <Link
                href={href({ view: 'calendar', page: '' })}
                className={
                  view === 'calendar'
                    ? 'bg-slate-900 px-3 py-1.5 text-sm font-medium text-white'
                    : 'bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100'
                }
              >
                Calendar
              </Link>
            </div>

            <a
              href={exportHref}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              Export CSV
            </a>
          </div>
        </div>
      </form>

      <SavedFilters
        filters={saved}
        currentQuery={currentQuery}
        saveAction={saveJobFilterAction}
        deleteAction={deleteJobFilterAction}
      />

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
      ) : view === 'calendar' ? (
        <CalendarView
          month={month}
          jobs={jobs}
          timezone={settings.timezone}
          href={href}
        />
      ) : (
        <>
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
                  <th scope="col" className="px-4 py-3 font-medium">Scheduled</th>
                  <th scope="col" className="px-4 py-3 font-medium">Raised</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageJobs.map((job) => (
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
                      {job.scheduledStart
                        ? formatDateTime(job.scheduledStart, settings.timezone)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      {job.reportedAt ? formatDateTime(job.reportedAt, settings.timezone) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 ? (
            <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="text-slate-600">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, jobs.length)} of{' '}
                {jobs.length}.
              </p>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link
                    href={href({ page: String(page - 1) })}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100"
                  >
                    ← Previous
                  </Link>
                ) : null}
                {page < pages ? (
                  <Link
                    href={href({ page: String(page + 1) })}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100"
                  >
                    Next →
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * The month grid. Six weeks, Monday first, matching the schedule board's own week so the two agree
 * about what a week looks like.
 */
function CalendarView({
  month,
  jobs,
  timezone,
  href,
}: {
  month: string
  jobs: Awaited<ReturnType<typeof listJobs>>
  timezone: string
  href: (overrides: Record<string, string>) => string
}) {
  const days = calendarDays(month, jobs, timezone, new Date())
  const label = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
    new Date(`${month}-01T00:00:00.000Z`),
  )

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-900">{label}</h2>
        <div className="flex gap-2">
          <Link
            href={href({ month: shiftMonth(month, -1) })}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            ← Previous month
          </Link>
          <Link
            href={href({ month: shiftMonth(month, 1) })}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            Next month →
          </Link>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[42rem]">
          <div className="grid grid-cols-7 border-b border-slate-200 pb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <div key={day} className="px-1">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {days.map((day) => (
              <div
                key={day.date}
                className={`min-h-24 border-r border-b border-slate-100 p-1.5 text-xs last:border-r-0 ${
                  day.outside ? 'bg-slate-50 text-slate-400' : 'text-slate-700'
                }`}
              >
                <p className={day.isToday ? 'font-semibold text-slate-900' : undefined}>
                  {Number(day.date.slice(8))}
                  {day.isToday ? <span className="ml-1 text-slate-500">today</span> : null}
                </p>
                <ul className="mt-1 space-y-1">
                  {day.jobs.map((job) => (
                    <li key={job.id}>
                      <Link
                        href={`/jobs/${job.id}`}
                        title={`${job.number} — ${job.customer.tradingName ?? job.customer.legalName}`}
                        className={`block truncate rounded border px-1 py-0.5 ${
                          job.priority === 'P1'
                            ? 'border-red-200 bg-red-50 text-red-800'
                            : 'border-slate-200 bg-white text-slate-700'
                        }`}
                      >
                        {job.number}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
