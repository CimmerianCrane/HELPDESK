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
  overdue: 'border-red-300 bg-red-50 font-medium text-red-800',
  '30': 'border-amber-300 bg-amber-50 text-amber-900',
  '60': 'border-amber-200 bg-amber-50 text-amber-900',
  '90': 'border-slate-200 bg-white text-slate-700',
  later: 'border-slate-200 bg-white text-slate-600',
  none: 'border-slate-200 bg-slate-100 text-slate-600',
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
        <h1 className="text-2xl font-semibold text-slate-900">Certificates</h1>
        <p className="mt-1 text-slate-600">
          {counts.overdue === 0 ? 'Nothing has lapsed.' : `${counts.overdue} lapsed.`}{' '}
          {counts.dueWithin90} expiring in the next 90 days.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          This register holds documents issued by others. Our technicians&rsquo; reports are company
          inspections and appear on the crane&rsquo;s timeline — they are not statutory certificates,
          and only an Authorised Examiner issues a certificate of test and examination.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="block text-sm font-medium text-slate-700">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={filters.q}
            placeholder="Asset tag, customer, site, number or issuer"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="due" className="block text-sm font-medium text-slate-700">
            Expiring
          </label>
          <select
            id="due"
            name="due"
            defaultValue={filters.due}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
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
          <label htmlFor="type" className="block text-sm font-medium text-slate-700">
            Kind
          </label>
          <select
            id="type"
            name="type"
            defaultValue={filters.type}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          >
            <option value="">All</option>
            {CERTIFICATE_TYPES.map((type) => (
              <option key={type} value={type}>
                {CERTIFICATE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800">
          Filter
        </button>

        {filtered ? (
          <Link href="/certificates" className="px-2 py-2 text-sm text-slate-600 underline">
            Clear
          </Link>
        ) : null}
      </form>

      {certificates.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-slate-900">
            {filtered ? 'Nothing matches those filters.' : 'No certificates on file yet.'}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {filtered
              ? 'Try a shorter search, or clear the filters.'
              : 'A certificate is recorded against a crane: open the crane and add it under Certificates.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Crane certificates, soonest expiring first</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Crane</th>
                <th scope="col" className="px-4 py-3 font-medium">Certificate</th>
                <th scope="col" className="px-4 py-3 font-medium">Issued by</th>
                <th scope="col" className="px-4 py-3 font-medium">Expires</th>
                <th scope="col" className="px-4 py-3 font-medium">State</th>
                <th scope="col" className="px-4 py-3 font-medium">File</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {certificates.map((certificate) => {
                return (
                  <tr key={certificate.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/cranes/${certificate.crane.id}`}
                        className="font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                      >
                        {certificate.crane.assetTag}
                      </Link>
                      <span className="block text-xs text-slate-500">
                        {certificate.crane.customerName} · {certificate.crane.siteName}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-slate-900">
                        {CERTIFICATE_TYPE_LABELS[certificate.type]}
                      </span>
                      <span
                        className={
                          certificate.statutory
                            ? 'mt-1 block w-fit rounded border border-indigo-300 bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-800'
                            : 'mt-1 block w-fit rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600'
                        }
                      >
                        {certificate.statutory ? 'AE statutory certificate' : 'Supporting document'}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
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
                    <td className="px-4 py-3 text-slate-700">{certificate.issuer ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {formatDate(certificate.dueDate, settings.timezone)}
                      <span className="block text-xs text-slate-500">
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
                          className="text-sm text-slate-700 underline"
                        >
                          {certificate.file.filename}
                        </a>
                      ) : (
                        <span className="text-xs text-slate-500">None</span>
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
