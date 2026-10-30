import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cardClass } from '@/components/office/ui'
import { formatDate } from '@/lib/format'
import { requirePortalPage } from '../../../guard'
import { portalJob, portalReports, requirePortalCustomer } from '@/server/portal/portal'
import { issuedPdfUrl } from '@/server/reports/approval'
import { getSettings } from '@/server/settings/settings'

export const metadata: Metadata = { title: 'Job — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * One job as the customer sees it: what work, where, when, and any report issued for it.
 *
 * "Not yours" and "no such job" are the same answer — `portalJob` returns null for both, and the
 * page 404s. Distinguishing them would let a customer probe which job numbers exist.
 */
export default async function PortalJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await requirePortalPage()
  requirePortalCustomer(context)

  const [job, settings] = await Promise.all([portalJob(context, id), getSettings()])
  if (!job) notFound()

  const reports = await portalReports(context, { jobId: job.id })
  const withUrls = await Promise.all(
    reports.map(async (report) => ({ ...report, url: await issuedPdfUrl(context, report.id) })),
  )

  return (
    <div className="space-y-8">
      <div>
        <Link href="/portal/jobs" className="text-sm text-slate-600 underline hover:text-slate-900">
          ← Jobs
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{job.number}</h1>
        <p className="mt-1 text-slate-600">
          {job.jobTypeName} · {job.status.replace(/_/g, ' ').toLowerCase()}
        </p>
      </div>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Visit</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <Row label="Raised" value={formatDate(job.raisedAt, settings.timezone)} />
          <Row label="Visit" value={formatDate(job.visitAt, settings.timezone)} />
          <Row label="Completed" value={formatDate(job.completedAt, settings.timezone)} />
          <Row label="Site" value={job.siteName ?? '—'} />
        </dl>
        {job.cranes.length > 0 ? (
          <p className="mt-3 text-sm text-slate-600">Cranes: {job.cranes.join(', ')}</p>
        ) : null}
      </section>

      <section>
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Issued reports
        </h2>
        {withUrls.length === 0 ? (
          <p className={`${cardClass} mt-3 text-sm text-slate-600`}>
            No report has been issued for this job yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {withUrls.map((report) => (
              <li
                key={report.id}
                className={`${cardClass} flex flex-wrap items-baseline justify-between gap-3 p-4`}
              >
                <div>
                  <p className="font-medium text-slate-900">{report.documentNumber}</p>
                  <p className="text-sm text-slate-600">{report.craneTag}</p>
                  <p className="text-xs text-slate-500">
                    Issued {formatDate(report.approvedAt, settings.timezone)}
                  </p>
                </div>
                {report.url ? (
                  <a
                    href={report.url}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Download PDF
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{value}</dd>
    </div>
  )
}
