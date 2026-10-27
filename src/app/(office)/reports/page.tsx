import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cardClass } from '@/components/office/ui'
import { formatDateTime } from '@/lib/format'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { REPORT_STATUS_LABELS, SAFE_TO_OPERATE_LABELS } from '@/server/reports/labels'
import { reportsQueue } from '@/server/reports/approval'
import { getSettings } from '@/server/settings/settings'

export const metadata: Metadata = { title: 'Reports — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The report queue: what the field has signed and the office has not yet answered (brief §5).
 *
 * A dispatcher holds `report.approve`, and a submission is a commitment to a customer, so this page is
 * one of the few places a role string check is a 404 rather than a form with a disabled button — the
 * service refuses regardless, this only avoids rendering a screen that could not work.
 */
export default async function ReportsPage() {
  const context = await requireAuth()
  if (!can(context.role, 'report.approve')) notFound()

  const [rows, settings] = await Promise.all([reportsQueue(context), getSettings()])
  const waiting = rows.filter((row) => row.status === 'SUBMITTED')
  const returned = rows.filter((row) => row.status === 'RETURNED')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <p className="mt-1 text-slate-600">
          Signed in the field, waiting for a decision. Approving issues a numbered PDF and tells the
          customer; sending one back tells the technician what to fix.
        </p>
      </div>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">
          Waiting for approval {waiting.length > 0 ? `(${waiting.length})` : ''}
        </h2>

        {waiting.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            Nothing submitted. Reports appear here as technicians finish them.
          </p>
        ) : (
          <ReportTable rows={waiting} timeZone={settings.timezone} />
        )}
      </section>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">
          Sent back {returned.length > 0 ? `(${returned.length})` : ''}
        </h2>

        {returned.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">Nothing outstanding.</p>
        ) : (
          <ReportTable rows={returned} timeZone={settings.timezone} />
        )}
      </section>
    </div>
  )
}

function ReportTable({
  rows,
  timeZone,
}: {
  rows: Awaited<ReturnType<typeof reportsQueue>>
  timeZone: string
}) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
          <tr>
            <th className="py-2 pr-4 font-medium">Job</th>
            <th className="py-2 pr-4 font-medium">Customer</th>
            <th className="py-2 pr-4 font-medium">Crane</th>
            <th className="py-2 pr-4 font-medium">Signed</th>
            <th className="py-2 pr-4 font-medium">Safe to operate</th>
            <th className="py-2 pr-4 font-medium">Submitted</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100 last:border-0">
              <td className="py-2 pr-4">
                <Link href={`/reports/${row.id}`} className="font-medium text-slate-900 underline">
                  {row.jobNumber}
                </Link>
                <span className="block text-xs text-slate-500">{row.jobTypeName}</span>
              </td>
              <td className="py-2 pr-4 text-slate-700">{row.customerName}</td>
              <td className="py-2 pr-4 text-slate-700">{row.craneTag}</td>
              <td className="py-2 pr-4 text-slate-700">{row.technicianName ?? '—'}</td>
              <td className="py-2 pr-4 text-slate-700">
                {row.safeToOperate
                  ? SAFE_TO_OPERATE_LABELS[row.safeToOperate as keyof typeof SAFE_TO_OPERATE_LABELS]
                  : '—'}
              </td>
              <td className="py-2 pr-4 text-slate-700">
                {formatDateTime(row.submittedAt, timeZone)}
              </td>
              <td className="py-2 text-slate-700">{REPORT_STATUS_LABELS[row.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
