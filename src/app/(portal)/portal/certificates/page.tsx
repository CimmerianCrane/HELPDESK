import type { Metadata } from 'next'
import { cardClass } from '@/components/office/ui'
import { formatDate } from '@/lib/format'
import { CERTIFICATE_TYPE_LABELS } from '@/lib/validation/certificates'
import { requirePortalPage } from '../../guard'
import { listCertificates } from '@/server/certificates/certificates'
import { requirePortalCustomer } from '@/server/portal/portal'
import { DUE_BUCKET_LABELS, type DueBucket } from '@/server/schedules/recurrence'
import { getSettings } from '@/server/settings/settings'

export const metadata: Metadata = { title: 'Certificates — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/** The same palette the office queue uses for the same question: how urgent is this date? */
const BUCKET_STYLES: Record<DueBucket, string> = {
  overdue: 'border-red-300 bg-red-50 font-medium text-red-800',
  '30': 'border-amber-300 bg-amber-50 text-amber-900',
  '60': 'border-amber-200 bg-amber-50 text-amber-900',
  '90': 'border-slate-200 bg-white text-slate-700',
  later: 'border-slate-200 bg-white text-slate-600',
  none: 'border-slate-200 bg-slate-100 text-slate-600',
}

/**
 * The customer's certificates, soonest due first — the office's compliance queue, narrowed by
 * `certificateReadWhere` to this customer's cranes.
 *
 * The download link is the signed URL the register already holds. A certificate is a document
 * somebody else issued to the customer, so there is no reason to withhold their own copy.
 */
export default async function PortalCertificatesPage() {
  const context = await requirePortalPage()
  requirePortalCustomer(context)
  const [certificates, settings] = await Promise.all([listCertificates(context), getSettings()])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Certificates</h1>
        <p className="mt-1 text-slate-600">
          {certificates.length} {certificates.length === 1 ? 'document' : 'documents'} on your
          account, soonest due first. Our own reports are company inspections, not statutory
          certificates — they are under{' '}
          <a href="/portal/reports" className="underline">
            Reports
          </a>
          .
        </p>
      </div>

      {certificates.length === 0 ? (
        <p className={`${cardClass} text-sm text-slate-600`}>
          No certificates on this account yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {certificates.map((certificate) => (
            <li key={certificate.id} className={`${cardClass} p-4`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{certificate.crane.assetTag}</p>
                  <p className="text-sm text-slate-600">
                    {CERTIFICATE_TYPE_LABELS[certificate.type]}
                    {certificate.statutory ? ' · Authorised Examiner' : ''}
                  </p>
                  {certificate.certificateNumber ? (
                    <p className="text-xs text-slate-500">No. {certificate.certificateNumber}</p>
                  ) : null}
                  {certificate.issuer ? (
                    <p className="text-xs text-slate-500">Issued by {certificate.issuer}</p>
                  ) : null}
                </div>
                <div className="text-right">
                  <span
                    className={`inline-block rounded border px-2 py-0.5 text-xs ${BUCKET_STYLES[certificate.dueBucket]}`}
                  >
                    {certificate.dueDate
                      ? `${DUE_BUCKET_LABELS[certificate.dueBucket]} · ${formatDate(certificate.dueDate, settings.timezone)}`
                      : DUE_BUCKET_LABELS.none}
                  </span>
                  {certificate.file ? (
                    <a
                      href={certificate.file.downloadUrl}
                      className="mt-2 block text-sm text-slate-700 underline hover:text-slate-900"
                    >
                      Download
                    </a>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
