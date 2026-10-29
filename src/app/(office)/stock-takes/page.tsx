import type { Metadata } from 'next'
import Link from 'next/link'
import { StockTakeForm } from '@/components/office/stock-take-forms'
import { cardClass } from '@/components/office/ui'
import { formatDate } from '@/lib/format'
import { STOCK_TAKE_STATUS_LABELS } from '@/lib/validation/stock-takes'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { locationOptions } from '@/server/inventory/locations'
import { listStockTakes } from '@/server/inventory/stock-takes'
import { getSettings } from '@/server/settings/settings'
import { createStockTakeAction } from './actions'

export const metadata: Metadata = { title: 'Stock takes — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * Counting the shelf (brief §9, slice 26).
 *
 * One session over one location, counted blind, reviewed for variance, and approved by someone with
 * `stocktake.approve` — the same person who may write stock off. The parts book's negative lines are
 * what these sessions exist to correct, so the list shows the variance count rather than the line
 * count alone.
 */
export default async function StockTakesPage() {
  const context = await requireAuth()
  const mayCount = can(context.role, 'stock.move')

  const [takes, settings, locations] = await Promise.all([
    listStockTakes(context),
    getSettings(),
    mayCount ? locationOptions(context) : Promise.resolve([]),
  ])

  const open = takes.filter(
    (take) => take.status === 'DRAFT' || take.status === 'COUNTING' || take.status === 'REVIEW',
  )

  return (
    <div className="space-y-8">
      <div>
        <Link href="/parts" className="text-sm text-slate-600 underline hover:text-slate-900">
          ← Parts
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Stock takes</h1>
        <p className="mt-1 text-slate-600">
          {open.length === 0
            ? 'Nothing is being counted.'
            : `${open.length} session${open.length === 1 ? '' : 's'} open.`}
        </p>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          A count is opened over one location and snapshots what the books say. Counting blind — without
          seeing that figure — is what makes the variance worth reading. Approving posts one correction
          per line that disagrees, through the stock ledger, with the count&rsquo;s reference on it.
        </p>
      </div>

      {takes.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-slate-900">No counts yet.</p>
          <p className="mt-1 text-sm text-slate-600">
            The first one starts with the store&rsquo;s shelf.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Stock take sessions</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Reference</th>
                <th scope="col" className="px-4 py-3 font-medium">Location</th>
                <th scope="col" className="px-4 py-3 font-medium">State</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Counted</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Differences</th>
                <th scope="col" className="px-4 py-3 font-medium">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {takes.map((take) => (
                <tr key={take.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/stock-takes/${take.id}`}
                      className="font-mono font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                    >
                      {take.reference}
                    </Link>
                    {take.blindCount ? (
                      <span className="ml-2 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        Blind
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {take.locationName ?? '—'}
                    {take.scopeCategory ? (
                      <span className="block text-xs text-slate-500">
                        Part numbers starting {take.scopeCategory}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        take.status === 'APPROVED'
                          ? 'rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800'
                          : take.status === 'CANCELLED'
                            ? 'rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-600'
                            : 'rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900'
                      }
                    >
                      {STOCK_TAKE_STATUS_LABELS[take.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {take.countedCount} of {take.lineCount}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={take.varianceLines > 0 ? 'font-medium text-amber-800' : 'text-slate-500'}>
                      {take.varianceLines}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {formatDate(take.createdAt, settings.timezone)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mayCount ? (
        <details className={cardClass}>
          <summary className="cursor-pointer font-semibold text-slate-900">Open a count</summary>
          <div className="mt-4">
            <StockTakeForm action={createStockTakeAction} locations={locations} />
          </div>
        </details>
      ) : (
        <p className="text-sm text-slate-500">The store counts the shelves.</p>
      )}
    </div>
  )
}
