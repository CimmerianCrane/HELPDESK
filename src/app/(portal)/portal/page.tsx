import type { Metadata } from 'next'
import Link from 'next/link'
import { cardClass } from '@/components/office/ui'
import { formatDate } from '@/lib/format'
import { requirePortalPage } from '../guard'
import { portalSummary } from '@/server/portal/portal'
import { getSettings } from '@/server/settings/settings'

export const metadata: Metadata = { title: 'Overview — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The portal's front page: what is outstanding on the account, and the most recent work. Every
 * number comes from `portalSummary`, which counts through the same scoped reads the lists use.
 */
export default async function PortalHomePage() {
  const context = await requirePortalPage()
  const [summary, settings] = await Promise.all([portalSummary(context), getSettings()])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{summary.customerName}</h1>
        <p className="mt-1 text-slate-600">
          Your jobs, cranes and compliance documents. This view is read-only — to change a booking or
          raise a fault, contact the office.
        </p>
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <Stat label="Open jobs" value={summary.openJobs} href="/portal/jobs" hint="Work in progress or booked." />
        <Stat label="Cranes" value={summary.cranes} href="/portal/cranes" hint="In the register at your sites." />
        <Stat
          label="Certificates due"
          value={summary.certificatesDueSoon}
          href="/portal/certificates"
          hint="Lapsed or lapsing within 90 days."
        />
      </dl>

      <section>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Recent work
          </h2>
          <Link href="/portal/jobs" className="text-sm text-slate-700 underline hover:text-slate-900">
            All jobs
          </Link>
        </div>

        {summary.recent.length === 0 ? (
          <p className={`${cardClass} mt-3 text-sm text-slate-600`}>No jobs on this account yet.</p>
        ) : (
          <ul className={`${cardClass} mt-3 divide-y divide-slate-100 p-0`}>
            {summary.recent.map((job) => (
              <li key={job.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/portal/jobs/${job.id}`}
                    className="font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                  >
                    {job.number}
                  </Link>
                  <span className="ml-2 text-sm text-slate-600">{job.jobTypeName}</span>
                  {job.cranes.length > 0 ? (
                    <span className="block text-xs text-slate-500">{job.cranes.join(', ')}</span>
                  ) : null}
                </div>
                <div className="text-right text-sm text-slate-600">
                  <span className="block">{job.status.replace(/_/g, ' ').toLowerCase()}</span>
                  <span className="block text-xs text-slate-500">
                    {formatDate(job.visitAt ?? job.raisedAt, settings.timezone)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  href,
  hint,
}: {
  label: string
  value: number
  href: string
  hint: string
}) {
  return (
    <div className={cardClass}>
      <dt className="text-sm font-medium text-slate-600">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-slate-900">
        <Link href={href} className="hover:underline">
          {value}
        </Link>
      </dd>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  )
}
