import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArchiveCraneButton,
  CraneForm,
  RestrictCraneButton,
  UnrestrictCraneButton,
} from '@/components/office/crane-forms'
import { cardClass } from '@/components/office/ui'
import { formatDate } from '@/lib/format'
import { requireAuth } from '@/server/auth/context'
import { NotFoundError } from '@/server/auth/errors'
import { can } from '@/server/auth/permissions'
import { getCrane } from '@/server/cranes/cranes'
import {
  CRANE_STATUS_DESCRIPTIONS,
  CRANE_STATUS_LABELS,
  CRANE_TYPE_LABELS,
} from '@/lib/cranes/labels'
import { getSettings } from '@/server/settings/settings'
import { listSites } from '@/server/sites/sites'
import {
  archiveCraneAction,
  restrictCraneAction,
  unrestrictCraneAction,
  updateCraneAction,
} from '../actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  try {
    const crane = await getCrane(await requireAuth(), id)
    return { title: `${crane.assetTag} — Cimmerian Crane Services` }
  } catch (error) {
    if (error instanceof NotFoundError) return { title: 'Crane — Cimmerian Crane Services' }
    throw error
  }
}

export default async function CranePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await requireAuth()

  let crane
  try {
    crane = await getCrane(context, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    throw error
  }

  const [sites, settings] = await Promise.all([
    listSites(context, { customerId: crane.site.customerId }),
    getSettings(),
  ])

  const mayWrite = can(context.role, 'crane.write')
  const mayRestrict = can(context.role, 'crane.restrict')
  const siteOptions = sites.map((row) => ({ id: row.id, name: row.name }))
  const restricted = crane.status === 'RESTRICTED'

  return (
    <div className="space-y-8">
      <div>
        <Link href="/cranes" className="text-sm text-slate-600 underline hover:text-slate-900">
          ← Crane register
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{crane.assetTag}</h1>
            <p className="mt-1 text-slate-600">
              {CRANE_TYPE_LABELS[crane.type]}
              {crane.brand ? ` · ${crane.brand}` : ''}
              {crane.model ? ` ${crane.model}` : ''}
              {' · '}
              <Link href={`/sites/${crane.site.id}`} className="underline">
                {crane.site.name}
              </Link>
              {' · '}
              <Link href={`/customers/${crane.site.customerId}`} className="underline">
                {crane.site.customerName}
              </Link>
            </p>
          </div>

          <div className="text-right">
            <span
              className={
                restricted
                  ? 'rounded border border-red-300 bg-red-50 px-2 py-1 text-sm font-medium text-red-800'
                  : 'rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700'
              }
            >
              {CRANE_STATUS_LABELS[crane.status]}
            </span>
            <p className="mt-1 max-w-xs text-xs text-slate-500">
              {CRANE_STATUS_DESCRIPTIONS[crane.status]}
            </p>
          </div>
        </div>
      </div>

      {restricted ? (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4">
          <h2 className="font-semibold text-red-900">Do not operate</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-red-900">{crane.restrictedReason}</p>
          <p className="mt-2 text-xs text-red-800">
            Restricted {formatDate(crane.restrictedAt, settings.timezone)}.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className={`${cardClass} lg:col-span-2`}>
          <h2 className="font-semibold text-slate-900">The crane</h2>

          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Safe working load</dt>
              <dd className="mt-1 text-slate-900">{crane.swlKg.toLocaleString()} kg</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Serial number</dt>
              <dd className="mt-1 text-slate-900">{crane.serialNumber ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Year of manufacture</dt>
              <dd className="mt-1 text-slate-900">{crane.yearOfManufacture ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Hour meter</dt>
              <dd className="mt-1 text-slate-900">
                {crane.hourMeter === null ? '—' : crane.hourMeter.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Statutory registration</dt>
              <dd className="mt-1 text-slate-900">
                {crane.statutoryRegistrationNo ?? '—'}
                {crane.registrationDate
                  ? ` · ${formatDate(crane.registrationDate, settings.timezone)}`
                  : ''}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Owner of record</dt>
              <dd className="mt-1 text-slate-900">{crane.ownerEntity ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Location on site</dt>
              <dd className="mt-1 text-slate-900">{crane.locationOnSite ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Added to register</dt>
              <dd className="mt-1 text-slate-900">{formatDate(crane.createdAt, settings.timezone)}</dd>
            </div>
            {crane.notes ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Notes</dt>
                <dd className="mt-1 whitespace-pre-wrap text-slate-900">{crane.notes}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Label</h2>
          <p className="mt-1 text-sm text-slate-600">
            Every crane has a QR sticker. It points at this record, so a technician can scan the
            machine instead of searching the register.
          </p>
          <p className="mt-3 font-mono text-xs text-slate-500">{crane.qrValue}</p>
          <p className="mt-4">
            <Link href={`/cranes/${crane.id}/label`} className="text-sm font-medium text-slate-900 underline">
              Print the label
            </Link>
          </p>
        </section>
      </div>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Timeline</h2>
        <p className="mt-2 text-sm text-slate-600">
          Reports, certificates and job history for this crane appear here once the report and
          certificate screens are built. Until then the audit log is the record of every change.
        </p>
      </section>

      {mayRestrict ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Restriction</h2>
          {restricted ? (
            <div className="mt-3">
              <p className="mb-3 text-sm text-slate-600">
                Clearing the restriction puts the crane back in service. The reason stays in the audit
                log.
              </p>
              <UnrestrictCraneButton action={unrestrictCraneAction.bind(null, crane.id)} />
            </div>
          ) : (
            <div className="mt-3">
              <RestrictCraneButton action={restrictCraneAction.bind(null, crane.id)} />
            </div>
          )}
        </section>
      ) : null}

      {mayWrite ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Edit this crane</h2>
          <p className="mt-1 mb-5 text-sm text-slate-600">
            The QR value never changes — the sticker is already on the machine. The asset tag can be
            corrected.
          </p>
          <CraneForm
            action={updateCraneAction.bind(null, crane.id)}
            value={{ ...crane, registrationDate: crane.registrationDate }}
            sites={siteOptions}
            customerId={crane.site.customerId}
            submitLabel="Save crane"
            idPrefix="edit-crane"
          />
        </section>
      ) : null}

      {mayWrite ? (
        <section className="rounded-lg border border-red-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Archive</h2>
          <div className="mt-3">
            <ArchiveCraneButton
              action={archiveCraneAction.bind(null, crane.id)}
              assetTag={crane.assetTag}
              hasHistory={crane.historyCount > 0}
            />
          </div>
        </section>
      ) : null}
    </div>
  )
}
