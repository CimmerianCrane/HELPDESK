import type { Metadata } from 'next'
import Link from 'next/link'
import { PartForm } from '@/components/office/part-forms'
import { cardClass } from '@/components/office/ui'
import { formatMoney } from '@/lib/format'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { listParts } from '@/server/inventory/parts'
import { getSettings } from '@/server/settings/settings'
import { createPartAction } from './actions'

export const metadata: Metadata = { title: 'Parts — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The parts book (brief §9, slice 22): what the store holds, what it costs, and what is running out.
 *
 * The important column is **on hand**, and it is the ledger's own figure — every issue, receipt,
 * return and write-off that has ever been posted, summed. A negative line is shown in red rather than
 * hidden or clamped: it means an issue was posted for stock nobody counted in, which is exactly what
 * the next stock take needs to see.
 */
export default async function PartsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; brand?: string; level?: string }>
}) {
  const context = await requireAuth()
  const params = await searchParams
  const filters = { q: params.q ?? '', brand: params.brand ?? '', level: params.level ?? '' }

  const [{ parts, belowCount, brands }, settings] = await Promise.all([
    listParts(context, filters),
    getSettings(),
  ])

  const mayWrite = can(context.role, 'part.write')
  const filtered = Boolean(filters.q || filters.brand || filters.level === 'below')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Parts</h1>
        <p className="mt-1 text-slate-600">
          {parts.length} line{parts.length === 1 ? '' : 's'}
          {filtered ? ' matching' : ' in the catalogue'}
          {belowCount > 0 ? (
            <>
              {' · '}
              <Link href="/parts?level=below" className="font-medium text-amber-800 underline">
                {belowCount} below reorder level
              </Link>
            </>
          ) : (
            ' · nothing below reorder level'
          )}
          .
        </p>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          On hand is the sum of every stock movement — parts issued on a job, deliveries received and
          adjustments after a count. It is never typed in directly: a change is a movement, with a
          reason and a person against it.
        </p>
        <p className="mt-2 text-sm">
          <Link href="/parts/locations" className="text-slate-700 underline hover:text-slate-900">
            Stock locations
          </Link>{' '}
          <span className="text-slate-500">
            — the store, bins, vans and parts held on site, and what each one holds.
          </span>
        </p>
        <p className="mt-1 text-sm">
          <Link href="/parts/reorder" className="text-slate-700 underline hover:text-slate-900">
            Reorder
          </Link>{' '}
          <span className="text-slate-500">
            — what is below reorder, grouped by supplier, and the purchase orders on their way.
          </span>
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
            placeholder="Part number, description or crane model"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="brand" className="block text-sm font-medium text-slate-700">
            Brand
          </label>
          <select
            id="brand"
            name="brand"
            defaultValue={filters.brand}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          >
            <option value="">All</option>
            {brands.map((brand) => (
              <option key={brand} value={brand}>
                {brand}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="level"
            value="below"
            defaultChecked={filters.level === 'below'}
            className="size-4 rounded border-slate-300"
          />
          Below reorder only
        </label>

        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800">
          Filter
        </button>

        {filtered ? (
          <Link href="/parts" className="px-2 py-2 text-sm text-slate-600 underline">
            Clear
          </Link>
        ) : null}
      </form>

      {parts.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-slate-900">
            {filtered ? 'Nothing matches those filters.' : 'The catalogue is empty.'}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {filtered
              ? 'Try a shorter search, or clear the filters.'
              : mayWrite
                ? 'Add the first part below.'
                : 'A part is added by the store.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Parts catalogue with on-hand quantities</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Part</th>
                <th scope="col" className="px-4 py-3 font-medium">Brand / fits</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">On hand</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Reorder at</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Sell</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {parts.map((part) => (
                <tr key={part.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/parts/${part.id}`}
                      className="font-mono text-sm font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                    >
                      {part.partNumber}
                    </Link>
                    <span className="block text-slate-700">{part.description}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {part.brand ?? '—'}
                    {part.compatibleModels.length > 0 ? (
                      <span className="block text-xs text-slate-500">
                        Fits {part.compatibleModels.join(', ')}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={
                        part.onHand < 0
                          ? 'font-medium text-red-700'
                          : part.belowReorder
                            ? 'font-medium text-amber-800'
                            : 'text-slate-900'
                      }
                    >
                      {part.onHand} {part.uom}
                    </span>
                    {part.onHand < 0 ? (
                      <span className="block text-xs text-red-700">More issued than received</span>
                    ) : part.belowReorder ? (
                      <span className="block text-xs text-amber-800">Below reorder level</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    {part.reorderLevel === null ? '—' : `${part.reorderLevel} ${part.uom}`}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {formatMoney(part.sellPrice, settings.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mayWrite ? (
        <details className={cardClass}>
          <summary className="cursor-pointer font-semibold text-slate-900">
            Add a part to the catalogue
          </summary>
          <div className="mt-4">
            <PartForm action={createPartAction} values={null} submitLabel="Add part" />
          </div>
        </details>
      ) : (
        <p className="text-sm text-slate-500">The store maintains the catalogue.</p>
      )}
    </div>
  )
}
