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
  overdue: 'border-red-300 bg-red-50 font-medium text-red-800',
  '30': 'border-amber-300 bg-amber-50 text-amber-900',
  '60': 'border-amber-200 bg-amber-50 text-amber-900',
  '90': 'border-slate-200 bg-white text-slate-700',
  later: 'border-slate-200 bg-white text-slate-600',
  none: 'border-slate-200 bg-slate-100 text-slate-600',
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
        <Link href="/schedule/roster" className="text-sm text-slate-600 underline hover:text-slate-900">
          ← Roster
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Calibrations</h1>
        <p className="mt-1 text-slate-600">
          {counts.overdue === 0 ? 'Nothing has lapsed.' : `${counts.overdue} lapsed.`}{' '}
          {counts.dueWithin90} lapsing in the next 90 days.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          The test weights, load cells, vans and tools the schedule books onto jobs, and when each
          was last proved accurate. A lapsed calibration warns when the item is booked and on a load
          test&rsquo;s instruments table — it never blocks a report, because a blocked form on a phone
          with no signal is a lost report.
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
            placeholder="Name or serial number"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="due" className="block text-sm font-medium text-slate-700">
            Calibration
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
            {EQUIPMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {EQUIPMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800">
          Filter
        </button>

        {filtered ? (
          <Link href="/calibrations" className="px-2 py-2 text-sm text-slate-600 underline">
            Clear
          </Link>
        ) : null}
      </form>

      {calibrations.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-slate-900">
            {filtered ? 'Nothing matches those filters.' : 'No equipment on record yet.'}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {filtered
              ? 'Try a shorter search, or clear the filters.'
              : 'Add the test weights, load cells and tools that need calibrating — each one is bookable onto a job.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Equipment and its calibration dates, soonest lapsing first</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
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
            <tbody className="divide-y divide-slate-100">
              {calibrations.map((row) => (
                <tr key={row.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">{row.name}</span>
                    <span className="block text-xs text-slate-500">
                      {EQUIPMENT_TYPE_LABELS[row.type as EquipmentTypeName]}
                      {row.serialNumber ? ` · ${row.serialNumber}` : ''}
                      {row.openBookings > 0
                        ? ` · booked on ${row.openBookings} open ${row.openBookings === 1 ? 'job' : 'jobs'}`
                        : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {EQUIPMENT_STATUS_LABELS[row.status as EquipmentStatusName]}
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    {formatDate(row.calibrationDueDate, settings.timezone)}
                    <span className="block text-xs text-slate-500">{calibrationDueLabel(row)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded border px-2 py-0.5 text-xs ${BUCKET_STYLES[row.dueBucket]}`}>
                      {DUE_BUCKET_LABELS[row.dueBucket]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {row.file ? (
                      <a href={row.file.downloadUrl} className="text-sm text-slate-700 underline">
                        {row.file.filename}
                      </a>
                    ) : (
                      <span className="text-xs text-slate-500">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {mayWrite ? (
                      <details>
                        <summary className="cursor-pointer text-sm text-slate-700 underline">
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
          <summary className="cursor-pointer font-semibold text-slate-900">Add equipment</summary>
          <div className="mt-4 max-w-2xl">
            <CalibrationForm action={createResourceAction} values={null} submitLabel="Add equipment" />
          </div>
        </details>
      ) : (
        <p className="text-sm text-slate-500">The store maintains the calibration register.</p>
      )}
    </div>
  )
}
