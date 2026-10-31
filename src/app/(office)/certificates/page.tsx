import type { Metadata } from 'next'
import Link from 'next/link'
import { cardClass } from '@/components/office/ui'
import { formatDate } from '@/lib/format'
import { CERTIFICATE_TYPE_LABELS, CERTIFICATE_TYPES } from '@/lib/validation/certificates'
import { requireAuth } from '@/server/auth/context'
import {
  certificateCounts,
  certificateDueLabel,
  listCertificates,
} from '@/server/certificates/certificates'
import { DUE_BUCKET_LABELS, type DueBucket } from '@/server/schedules/recurrence'
import { getSettings } from '@/server/settings/settings'

export const metadata: Metadata = { title: 'Certificates — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/** The same palette the schedules list uses for the same question: how urgent is this date? */
const BUCKET_STYLES: Record<DueBucket, string> = {
  overdue: 'border-neg/40 bg-neg/10 font-medium text-neg',
  '30': 'border-warn/40 bg-warn/10 text-warn',
  '60': 'border-warn/40 bg-warn/10 text-warn',
  '90': 'border-line bg-field text-ink',
  later: 'border-line bg-field text-muted',
  none: 'border-line bg-raised text-muted',
}

/**
 * The compliance queue (brief §6.6, slice 13): certificates expiring in 90/60/30 and already lapsed.
 *
 * A register, not a library: the question is "what paper is about to lapse", so the list sorts by the
 * date that matters and the filters are the windows the brief names. The dashboard tile reads the
 * same service, which is why the two cannot disagree.
 */
export default async function CertificatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; due?: string; type?: string }>
}) {
  const context = await requireAuth()
  const params = await searchParams

  const filters = {
    q: params.q ?? '',
    due: params.due ?? '',
    type: params.type ?? '',
  }

  const [certificates, counts, settings] = await Promise.all([
    listCertificates(context, filters),
    certificateCounts(context),
    getSettings(),
  ])

  const filtered = Boolean(filters.q || filters.due || filters.type)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-title font-semibold text-ink">Certificates</h1>
        <p className="mt-1 text-muted">
          {counts.overdue === 0 ? 'Nothing has lapsed.' : `${counts.overdue} lapsed.`}{' '}
          {counts.dueWithin90} expiring in the next 90 days.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          This register holds documents issued by others. Our technicians&rsquo; reports are company
          inspections and appear on the crane&rsquo;s timeline — they are not statutory certificates,
          and only an Authorised Examiner issues a certificate of test and examination.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="block text-sm font-medium text-ink">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={filters.q}
            placeholder="Asset tag, customer, site, number or issuer"
            className="mt-1 block w-full rounded-md border border-line bg-field px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
          />
        </div>

        <div>
          <label htmlFor="due" className="block text-sm font-medium text-ink">
            Expiring
          </label>
          <select
            id="due"
            name="due"
            defaultValue={filters.due}
            className="mt-1 block rounded-md border border-line bg-field px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
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
          <label htmlFor="type" className="block text-sm font-medium text-ink">
            Kind
          </label>
          <select
            id="type"
            name="type"
            defaultValue={filters.type}
            className="mt-1 block rounded-md border border-line bg-field px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
          >
            <option value="">All</option>
            {CERTIFICATE_TYPES.map((type) => (
              <option key={type} value={type}>
                {CERTIFICATE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-anchor-soft">
          Filter
        </button>

        {filtered ? (
          <Link href="/certificates" className="px-2 py-2 text-sm text-muted underline">
            Clear
          </Link>
        ) : null}
      </form>

      {certificates.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-ink">
            {filtered ? 'Nothing matches those filters.' : 'No certificates on file yet.'}
          </p>
          <p className="mt-1 text-sm text-muted">
            {filtered
              ? 'Try a shorter search, or clear the filters.'
              : 'A certificate is recorded against a crane: open the crane and add it under Certificates.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-field">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Crane certificates, soonest expiring first</caption>
            <thead className="border-b border-line bg-sheet text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Crane</th>
                <th scope="col" className="px-4 py-3 font-medium">Certificate</th>
                <th scope="col" className="px-4 py-3 font-medium">Issued by</th>
                <th scope="col" className="px-4 py-3 font-medium">Expires</th>
                <th scope="col" className="px-4 py-3 font-medium">State</th>
                <th scope="col" className="px-4 py-3 font-medium">File</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {certificates.map((certificate) => {
                return (
                  <tr key={certificate.id} className="align-top hover:bg-sheet">
                    <td className="px-4 py-3">
                      <Link
                        href={`/cranes/${certificate.crane.id}`}
                        className="font-medium text-ink underline decoration-line hover:decoration-ink"
                      >
                        {certificate.crane.assetTag}
                      </Link>
                      <span className="block text-xs text-muted">
                        {certificate.crane.customerName} · {certificate.crane.siteName}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-ink">
                        {CERTIFICATE_TYPE_LABELS[certificate.type]}
                      </span>
                      <span
                        className={
                          certificate.statutory
                            ? 'mt-1 block w-fit rounded border border-info/40 bg-info/10 px-1.5 py-0.5 text-xs text-info'
                            : 'mt-1 block w-fit rounded border border-line bg-sheet px-1.5 py-0.5 text-xs text-muted'
                        }
                      >
                        {certificate.statutory ? 'AE statutory certificate' : 'Supporting document'}
                      </span>
                      <span className="mt-1 block text-xs text-muted">
                        {certificate.certificateNumber ?? 'No number'}
                        {certificate.job ? (
                          <>
                            {' · '}
                            <Link href={`/jobs/${certificate.job.id}`} className="underline">
                              {certificate.job.number}
                            </Link>
                          </>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink">{certificate.issuer ?? '—'}</td>
                    <td className="px-4 py-3 text-ink">
                      {formatDate(certificate.dueDate, settings.timezone)}
                      <span className="block text-xs text-muted">
                        {certificateDueLabel(certificate)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded border px-2 py-0.5 text-xs ${BUCKET_STYLES[certificate.dueBucket]}`}
                      >
                        {DUE_BUCKET_LABELS[certificate.dueBucket]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {certificate.file ? (
                        <a
                          href={certificate.file.downloadUrl}
                          className="text-sm text-ink underline"
                        >
                          {certificate.file.filename}
                        </a>
                      ) : (
                        <span className="text-xs text-muted">None</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
