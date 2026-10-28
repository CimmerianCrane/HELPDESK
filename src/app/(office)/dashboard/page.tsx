import type { Metadata } from 'next'
import Link from 'next/link'
import { cardClass } from '@/components/office/ui'
import { formatDate, formatDateTime } from '@/lib/format'
import { errorMessage } from '@/lib/logger'
import { db } from '@/lib/db'
import { requireAuth } from '@/server/auth/context'
import { can, capabilitiesFor } from '@/server/auth/permissions'
import { dashboardSummary } from '@/server/dashboard/dashboard'
import { ON_HOLD_REASON_LABELS } from '@/server/jobs/labels'
import { getSettings } from '@/server/settings/settings'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/server/users/labels'

export const metadata: Metadata = { title: 'Dashboard — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The office dashboard (brief §8): the questions asked every morning, each as a count that links to
 * the list that answers it. `dashboard.office` decides whether there is a board at all — a technician
 * lands on the same page and sees who they are and where the phone screens are, not a company-wide
 * count of work they must not read.
 */
export default async function DashboardPage() {
  const context = await requireAuth()
  const isOffice = can(context.role, 'dashboard.office')

  // Settings, the board and the health check do not depend on each other. Started together they cost
  // one round trip to the database's region instead of two more on top of the count queries.
  const [settings, dashboard, databaseUp] = await Promise.all([
    getSettings(),
    isOffice ? dashboardSummary(context) : null,
    db.$queryRaw`SELECT 1`.then(
      () => ({ up: true as const, detail: '' }),
      (error: unknown) => ({ up: false as const, detail: errorMessage(error) }),
    ),
  ])

  const database: 'up' | 'down' = databaseUp.up ? 'up' : 'down'
  const detail = databaseUp.detail

  const firstName = context.name.split(' ')[0]

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {firstName ? `Hello, ${firstName}` : 'Hello'}
          </h1>
          <p className="mt-1 text-slate-600">
            Signed in as{' '}
            <span className="font-medium text-slate-900">{ROLE_LABELS[context.role]}</span>.{' '}
            {ROLE_DESCRIPTIONS[context.role]}
          </p>
        </div>
        <p className="text-sm text-slate-500">
          {formatDate(new Date(), settings.timezone)} · {settings.timezone}
        </p>
      </div>

      {dashboard ? (
        <>
          <section aria-labelledby="attention-heading">
            <h2 id="attention-heading" className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
              Needs attention now
            </h2>
            <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Tile
                label="Open P1s"
                value={dashboard.p1Open}
                href="/jobs?priority=P1"
                urgent={dashboard.p1Open > 0}
                hint="Crane down or someone at risk."
              />
              <Tile
                label="SLA breaches"
                value={dashboard.slaBreached}
                href="/jobs?sla=breached"
                urgent={dashboard.slaBreached > 0}
                hint="Past a response or resolution target."
              />
              <Tile
                label="Late visits"
                value={dashboard.overdue}
                href="/jobs?sort=scheduled"
                urgent={dashboard.overdue > 0}
                hint="A date has passed and the work has not started."
              />
              <Tile
                label="Awaiting invoicing"
                value={dashboard.awaitingInvoicing}
                href="/jobs?status=REVIEWED"
                hint="Report signed off; the invoice has not gone out."
              />
            </dl>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className={cardClass}>
              <h2 className="font-semibold text-slate-900">On hold</h2>
              <p className="mt-1 text-sm text-slate-600">
                Work stopped, by the reason it was stopped. Every one of these is waiting on somebody.
              </p>
              {dashboard.onHoldTotal === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Nothing is on hold.</p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100 text-sm">
                  {dashboard.onHoldByReason.map((entry) => (
                    <li key={entry.reason} className="flex items-center justify-between py-2">
                      <Link
                        href={`/jobs?status=ON_HOLD`}
                        className="text-slate-800 underline decoration-slate-300"
                      >
                        {ON_HOLD_REASON_LABELS[entry.reason]}
                      </Link>
                      <span className="font-medium text-slate-900">{entry.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={cardClass}>
              <h2 className="font-semibold text-slate-900">The next 30 days</h2>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs tracking-wide text-slate-500 uppercase">Visits booked</dt>
                  <dd className="mt-0.5 text-lg font-semibold text-slate-900">
                    {dashboard.visitsBooked}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs tracking-wide text-slate-500 uppercase">
                    Services / exams due
                  </dt>
                  <dd className="mt-0.5 text-lg font-semibold text-slate-900">
                    <Link href="/schedules?due=30" className="underline decoration-slate-300">
                      {dashboard.dueWithin30Days}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs tracking-wide text-slate-500 uppercase">
                    Schedules overdue
                  </dt>
                  <dd
                    className={
                      dashboard.schedulesOverdue > 0
                        ? 'mt-0.5 text-lg font-semibold text-red-800'
                        : 'mt-0.5 text-lg font-semibold text-slate-900'
                    }
                  >
                    <Link href="/schedules?due=overdue" className="underline decoration-red-200">
                      {dashboard.schedulesOverdue}
                    </Link>
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs tracking-wide text-slate-500 uppercase">
                    Certificates expiring
                  </dt>
                  <dd
                    className={
                      dashboard.certificatesExpiring > 0
                        ? 'mt-0.5 text-lg font-semibold text-amber-800'
                        : 'mt-0.5 text-lg font-semibold text-slate-900'
                    }
                  >
                    <Link href="/certificates?due=30" className="underline decoration-amber-200">
                      {dashboard.certificatesExpiring}
                    </Link>
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <section className={cardClass}>
            <h2 className="font-semibold text-slate-900">Coming up</h2>
            {dashboard.upcoming.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                Nothing scheduled in the next 30 days. The{' '}
                <Link href="/schedule" className="underline">
                  schedule board
                </Link>{' '}
                is where that changes.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {dashboard.upcoming.map((entry) => (
                  <li key={entry.jobId} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span>
                      <Link href={`/jobs/${entry.jobId}`} className="font-medium text-slate-900 underline">
                        {entry.number}
                      </Link>{' '}
                      <span className="text-slate-600">
                        {entry.customerName} · {entry.siteName}
                        {entry.assetTags.length > 0 ? ` · ${entry.assetTags.join(', ')}` : ''}
                      </span>
                    </span>
                    <span className="text-slate-600">
                      {formatDateTime(entry.scheduledStart, settings.timezone)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Your work</h2>
          <p className="mt-1 text-sm text-slate-600">
            The company board is for the office. Your jobs are on the phone app, which works without a
            signal once it has synced.
          </p>
          <Link href="/m/jobs" className="mt-3 inline-block rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800">
            Open my jobs
          </Link>
        </section>
      )}

      <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <summary className="cursor-pointer font-medium text-slate-700">System and permissions</summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs tracking-wide text-slate-500 uppercase">Database</dt>
            <dd className={database === 'up' ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700'}>
              {database}
            </dd>
            {detail ? <p className="mt-1 font-mono text-xs text-red-700">{detail}</p> : null}
          </div>
          <div>
            <dt className="text-xs tracking-wide text-slate-500 uppercase">Timezone</dt>
            <dd className="font-semibold text-slate-900">{settings.timezone}</dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-slate-500 uppercase">Now</dt>
            <dd className="font-semibold text-slate-900">
              {formatDateTime(new Date(), settings.timezone)}
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-xs text-slate-500">
          Straight from the permission map, so this is what the server will actually allow.
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {capabilitiesFor(context.role).map((capability) => (
            <li
              key={capability}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700"
            >
              {capability}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

function Tile({
  label,
  value,
  href,
  hint,
  urgent = false,
}: {
  label: string
  value: number
  href: string
  hint: string
  urgent?: boolean
}) {
  return (
    <div className={`${cardClass} py-4`}>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        <Link href={href} className="hover:text-slate-900 hover:underline">
          {label}
        </Link>
      </dt>
      <dd
        className={
          urgent
            ? 'mt-1 text-2xl font-semibold text-red-700'
            : 'mt-1 text-2xl font-semibold text-slate-900'
        }
      >
        {value}
      </dd>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  )
}
