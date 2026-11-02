import type { Metadata } from 'next'
import Link from 'next/link'
import { PartForm } from '@/components/office/part-forms'
import { cardClass } from '@/components/office/ui'
import { formatMoney } from '@/lib/format'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { listParts } from '@/server/inventory/parts'
import { supplierOptions } from '@/server/inventory/suppliers'
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

  const mayWrite = can(context.role, 'part.write')

  const [{ parts, belowCount, brands }, settings, suppliers] = await Promise.all([
    listParts(context, filters),
    getSettings(),
    mayWrite ? supplierOptions(context) : Promise.resolve([]),
  ])

  const filtered = Boolean(filters.q || filters.brand || filters.level === 'below')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-title font-semibold text-ink">Parts</h1>
        <p className="mt-1 text-muted">
          {parts.length} line{parts.length === 1 ? '' : 's'}
          {filtered ? ' matching' : ' in the catalogue'}
          {belowCount > 0 ? (
            <>
              {' · '}
              <Link href="/parts?level=below" className="font-medium text-warn underline">
                {belowCount} below reorder level
              </Link>
            </>
          ) : (
            ' · nothing below reorder level'
          )}
          .
        </p>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          On hand is the sum of every stock movement — parts issued on a job, deliveries received and
          adjustments after a count. It is never typed in directly: a change is a movement, with a
          reason and a person against it.
        </p>
        {/* The four screens the store also lives in. Laid out as links rather than four prose
            paragraphs, so the store's shape is legible at a glance instead of read as sentences. */}
        <ul className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['/parts/locations', 'Stock locations', 'The store, bins, vans and parts held on site.'],
            ['/parts/reorder', 'Reorder', 'Below reorder, by supplier, plus orders on their way.'],
            ['/suppliers', 'Suppliers', 'Who the store buys from, and the price history.'],
            ['/stock-takes', 'Stock takes', 'Count a shelf blind, review, post the correction.'],
          ].map(([href, title, detail]) => (
            <li key={href}>
              <Link
                href={href}
                className="block rounded-md px-3 py-2 text-ink hover:bg-raised hover:underline hover:underline-offset-2"
              >
                <span className="font-medium">{title}</span>
                <span className="mt-0.5 block text-xs text-muted">{detail}</span>
              </Link>
            </li>
          ))}
        </ul>
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
            placeholder="Part number, description or crane model"
            className="mt-1 block w-full rounded-md border border-line bg-field px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
          />
        </div>

        <div>
          <label htmlFor="brand" className="block text-sm font-medium text-ink">
            Brand
          </label>
          <select
            id="brand"
            name="brand"
            defaultValue={filters.brand}
            className="mt-1 block rounded-md border border-line bg-field px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
          >
            <option value="">All</option>
            {brands.map((brand) => (
              <option key={brand} value={brand}>
                {brand}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 pb-2 text-sm text-ink">
          <input
            type="checkbox"
            name="level"
            value="below"
            defaultChecked={filters.level === 'below'}
            className="size-4 rounded border-line"
          />
          Below reorder only
        </label>

        <button type="submit" className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-anchor-soft">
          Filter
        </button>

        {filtered ? (
          <Link href="/parts" className="px-2 py-2 text-sm text-muted underline">
            Clear
          </Link>
        ) : null}
      </form>

      {parts.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-ink">
            {filtered ? 'Nothing matches those filters.' : 'The catalogue is empty.'}
          </p>
          <p className="mt-1 text-sm text-muted">
            {filtered
              ? 'Try a shorter search, or clear the filters.'
              : mayWrite
                ? 'Add the first part below.'
                : 'A part is added by the store.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-field">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Parts catalogue with on-hand quantities</caption>
            <thead className="border-b border-line bg-sheet text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Part</th>
                <th scope="col" className="px-4 py-3 font-medium">Brand / fits</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">On hand</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Reorder at</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Sell</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {parts.map((part) => (
                <tr key={part.id} className="align-top hover:bg-sheet">
                  <td className="px-4 py-3">
                    <Link
                      href={`/parts/${part.id}`}
                      className="font-mono text-sm font-medium text-ink underline decoration-line hover:decoration-ink"
                    >
                      {part.partNumber}
                    </Link>
                    <span className="block text-ink">{part.description}</span>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {part.brand ?? '—'}
                    {part.compatibleModels.length > 0 ? (
                      <span className="block text-xs text-muted">
                        Fits {part.compatibleModels.join(', ')}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={
                        part.onHand < 0
                          ? 'font-medium text-neg'
                          : part.belowReorder
                            ? 'font-medium text-warn'
                            : 'text-ink'
                      }
                    >
                      {part.onHand} {part.uom}
                    </span>
                    {part.onHand < 0 ? (
                      <span className="block text-xs text-neg">More issued than received</span>
                    ) : part.belowReorder ? (
                      <span className="block text-xs text-warn">Below reorder level</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right text-muted">
                    {part.reorderLevel === null ? '—' : `${part.reorderLevel} ${part.uom}`}
                  </td>
                  <td className="px-4 py-3 text-right text-ink">
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
          <summary className="cursor-pointer font-semibold text-ink">
            Add a part to the catalogue
          </summary>
          <div className="mt-4">
            <PartForm
              action={createPartAction}
              values={null}
              suppliers={suppliers}
              submitLabel="Add part"
            />
          </div>
        </details>
      ) : (
        <p className="text-sm text-muted">The store maintains the catalogue.</p>
      )}
    </div>
  )
}
