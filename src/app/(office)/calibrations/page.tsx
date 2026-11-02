import type { Metadata } from 'next'
import Link from 'next/link'
import { CalibrationForm } from '@/components/office/calibration-forms'
import { cardClass } from '@/components/office/ui'
import { formatDate } from '@/lib/format'
import {
  EQUIPMENT_STATUS_LABELS,
  EQUIPMENT_TYPES,
  EQUIPMENT_TYPE_LABELS,
  type EquipmentStatusName,
  type EquipmentTypeName,
} from '@/lib/validation/calibrations'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import {
  calibrationCounts,
  calibrationDueLabel,
  listCalibrations,
} from '@/server/calibrations/calibrations'
import { DUE_BUCKET_LABELS, type DueBucket } from '@/server/schedules/recurrence'
import { getSettings } from '@/server/settings/settings'
import { createResourceAction, updateResourceAction } from './actions'

export const metadata: Metadata = { title: 'Calibrations — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/** The same palette the certificate queue uses for the same question: how urgent is this date? */
const BUCKET_STYLES: Record<DueBucket, string> = {
  overdue: 'border-neg/40 bg-neg/10 font-medium text-neg',
  '30': 'border-warn/40 bg-warn/10 text-warn',
  '60': 'border-warn/40 bg-warn/10 text-warn',
  '90': 'border-line bg-field text-ink',
  later: 'border-line bg-field text-muted',
  none: 'border-line bg-raised text-muted',
}

/**
 * The calibration register (brief §4.5, slice 34).
 *
 * The equipment is the same `Resource` rows the scheduler books — test weights, load cells, vans and
 * tools — and the one date it tracks is the one the load test already warns against. A register, not
 * a library: the question is "what is about to lapse", so the list sorts by the date that matters
 * and the filters are the windows the certificate queue uses.
 */
export default async function CalibrationsPage({
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

  const [calibrations, counts, settings] = await Promise.all([
    listCalibrations(context, filters),
    calibrationCounts(context),
    getSettings(),
  ])

  const mayWrite = can(context.role, 'resource.write')
  const filtered = Boolean(filters.q || filters.due || filters.type)

  return (
    <div className="space-y-8">
      <div>
        <Link href="/schedule/roster" className="text-sm text-muted underline hover:text-ink">
          ← Roster
        </Link>
        <h1 className="mt-2 text-title font-semibold text-ink">Calibrations</h1>
        <p className="mt-1 text-muted">
          {counts.overdue === 0 ? 'Nothing has lapsed.' : `${counts.overdue} lapsed.`}{' '}
          {counts.dueWithin90} lapsing in the next 90 days.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          The test weights, load cells, vans and tools the schedule books onto jobs, and when each
          was last proved accurate. A lapsed calibration warns when the item is booked and on a load
          test&rsquo;s instruments table — it never blocks a report, because a blocked form on a phone
          with no signal is a lost report.
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
            placeholder="Name or serial number"
            className="mt-1 block w-full rounded-md border border-line bg-field px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
          />
        </div>

        <div>
          <label htmlFor="due" className="block text-sm font-medium text-ink">
            Calibration
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
            {EQUIPMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {EQUIPMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-anchor-soft">
          Filter
        </button>

        {filtered ? (
          <Link href="/calibrations" className="px-2 py-2 text-sm text-muted underline">
            Clear
          </Link>
        ) : null}
      </form>

      {calibrations.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-ink">
            {filtered ? 'Nothing matches those filters.' : 'No equipment on record yet.'}
          </p>
          <p className="mt-1 text-sm text-muted">
            {filtered
              ? 'Try a shorter search, or clear the filters.'
              : 'Add the test weights, load cells and tools that need calibrating — each one is bookable onto a job.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-field">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Equipment and its calibration dates, soonest lapsing first</caption>
            <thead className="border-b border-line bg-sheet text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Equipment</th>
                <th scope="col" className="px-4 py-3 font-medium">State</th>
                <th scope="col" className="px-4 py-3 font-medium">Calibration due</th>
                <th scope="col" className="px-4 py-3 font-medium">Bucket</th>
                <th scope="col" className="px-4 py-3 font-medium">Certificate</th>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {calibrations.map((row) => (
                <tr key={row.id} className="align-top hover:bg-sheet">
                  <td className="px-4 py-3">
                    <span className="font-medium text-ink">{row.name}</span>
                    <span className="block text-xs text-muted">
                      {EQUIPMENT_TYPE_LABELS[row.type as EquipmentTypeName]}
                      {row.serialNumber ? ` · ${row.serialNumber}` : ''}
                      {row.openBookings > 0
                        ? ` · booked on ${row.openBookings} open ${row.openBookings === 1 ? 'job' : 'jobs'}`
                        : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink">
                    {EQUIPMENT_STATUS_LABELS[row.status as EquipmentStatusName]}
                  </td>
                  <td className="px-4 py-3 text-ink">
                    {formatDate(row.calibrationDueDate, settings.timezone)}
                    <span className="block text-xs text-muted">{calibrationDueLabel(row)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded border px-2 py-0.5 text-xs ${BUCKET_STYLES[row.dueBucket]}`}>
                      {DUE_BUCKET_LABELS[row.dueBucket]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {row.file ? (
                      <a href={row.file.downloadUrl} className="text-sm text-ink underline">
                        {row.file.filename}
                      </a>
                    ) : (
                      <span className="text-xs text-muted">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {mayWrite ? (
                      <details>
                        <summary className="cursor-pointer text-sm text-ink underline">
                          Edit
                        </summary>
                        <div className="mt-3 min-w-72">
                          <CalibrationForm
                            action={updateResourceAction.bind(null, row.id)}
                            values={row}
                            submitLabel="Save calibration"
                          />
                        </div>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mayWrite ? (
        <details className={cardClass}>
          <summary className="cursor-pointer font-semibold text-ink">Add equipment</summary>
          <div className="mt-4 max-w-2xl">
            <CalibrationForm action={createResourceAction} values={null} submitLabel="Add equipment" />
          </div>
        </details>
      ) : (
        <p className="text-sm text-muted">The store maintains the calibration register.</p>
      )}
    </div>
  )
}
