import type { Metadata } from 'next'
import { cardClass } from '@/components/office/ui'
import { formatDate } from '@/lib/format'
import { requirePortalPage } from '../../guard'
import { portalReports } from '@/server/portal/portal'
import { issuedPdfUrl } from '@/server/reports/approval'
import { getSettings } from '@/server/settings/settings'

export const metadata: Metadata = { title: 'Reports — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

const CONDITION_LABELS: Record<string, string> = {
  YES: 'Safe to operate',
  NO: 'Not safe to operate',
  WITH_RESTRICTIONS: 'Safe to operate with restrictions',
}

/**
 * The customer's issued reports. Only approved ones appear — `portalReports` filters on status as
 * well as scope, because a report that has not been signed off has no document number and no PDF.
 */
export default async function PortalReportsPage() {
  const context = await requirePortalPage()
  const [reports, settings] = await Promise.all([portalReports(context), getSettings()])

  // The same signed-URL lookup the office report page uses, scoped by `reportReadWhere` — no second
  // PDF path exists for the portal to get wrong.
  const withUrls = await Promise.all(
    reports.map(async (report) => ({ ...report, url: await issuedPdfUrl(context, report.id) })),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <p className="mt-1 text-slate-600">
          {reports.length} issued {reports.length === 1 ? 'report' : 'reports'}. These are company
          inspections by our technicians, not statutory certificates.
        </p>
      </div>

      {withUrls.length === 0 ? (
        <p className={`${cardClass} text-sm text-slate-600`}>No issued reports yet.</p>
      ) : (
        <ul className="space-y-3">
          {withUrls.map((report) => (
            <li key={report.id} className={`${cardClass} flex flex-wrap items-baseline justify-between gap-3 p-4`}>
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{report.documentNumber}</p>
                <p className="text-sm text-slate-600">
                  {report.jobNumber} · {report.craneTag}
                </p>
                <p className="text-xs text-slate-500">
                  Issued {formatDate(report.approvedAt, settings.timezone)}
                </p>
                {report.safeToOperate ? (
                  <p className="mt-1 text-sm text-slate-700">
                    {CONDITION_LABELS[report.safeToOperate] ?? report.safeToOperate}
                  </p>
                ) : null}
              </div>
              {report.url ? (
                <a
                  href={report.url}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Download PDF
                </a>
              ) : (
                <span className="text-sm text-slate-500">PDF not available</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
