import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ApproveStockTakeForm,
  CountForm,
} from '@/components/office/stock-take-forms'
import { cardClass } from '@/components/office/ui'
import { formatDateTime } from '@/lib/format'
import { STOCK_TAKE_STATUS_LABELS } from '@/lib/validation/stock-takes'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { isAppError } from '@/server/auth/errors'
import { getStockTake } from '@/server/inventory/stock-takes'
import { getSettings } from '@/server/settings/settings'
import { approveStockTakeAction, cancelStockTakeAction, recordCountsAction } from '../actions'

export const metadata: Metadata = { title: 'Stock take — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * One count: what the books said, what was counted, and the difference (brief §9, slice 26).
 *
 * Once approved the screen is a record — the counts and the corrections they posted, read only. That
 * is deliberate: an approved count is what the ledger was reconciled against, and editing it would
 * make the two disagree with no movement to explain it.
 */
export default async function StockTakePage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireAuth()
  const { id } = await params

  const [take, settings] = await Promise.all([
    getStockTake(context, id).catch((error: unknown) => {
      if (isAppError(error) && error.status === 404) notFound()
      throw error
    }),
    getSettings(),
  ])

  const mayCount = can(context.role, 'stock.move')
  const mayApprove = can(context.role, 'stocktake.approve')
  const closed = take.status === 'APPROVED' || take.status === 'CANCELLED'
  const uncounted = take.lineCount - take.countedCount

  return (
    <div className="space-y-8">
      <div>
        <Link href="/stock-takes" className="text-sm text-muted underline hover:text-ink">
          ← Stock takes
        </Link>
        <h1 className="mt-2 font-mono text-title font-semibold text-ink">{take.reference}</h1>
        <p className="mt-1 text-muted">
          {take.locationName ?? 'Unknown location'}
          {take.scopeCategory ? ` · part numbers starting ${take.scopeCategory}` : ''} ·{' '}
          {STOCK_TAKE_STATUS_LABELS[take.status]}
          {take.blindCount ? ' · blind count' : ''}
        </p>
        <p className="mt-1 text-sm text-muted">
          Opened {formatDateTime(take.createdAt, settings.timezone)}
          {take.approvedAt ? ` · approved ${formatDateTime(take.approvedAt, settings.timezone)}` : ''}
        </p>
      </div>

      <section className={`${cardClass} grid gap-6 sm:grid-cols-3`} aria-label="Count summary">
        <div>
          <p className="text-xs text-muted">Lines</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{take.lineCount}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Counted</p>
          <p className="mt-1 text-2xl font-semibold text-ink">
            {take.countedCount}
            {uncounted > 0 ? (
              <span className="ml-2 text-sm font-normal text-warn">{uncounted} still to count</span>
            ) : null}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Differences</p>
          <p
            className={
              take.varianceLines > 0
                ? 'mt-1 text-2xl font-semibold text-warn'
                : 'mt-1 text-2xl font-semibold text-ink'
            }
          >
            {take.varianceLines}
          </p>
        </div>
      </section>

      {take.lineCount === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-ink">Nothing in scope.</p>
          <p className="mt-1 text-sm text-muted">
            The books show no stock at that location under those part numbers. That is a result worth
            approving.
          </p>
        </div>
      ) : closed ? (
        <section aria-labelledby="record-heading">
          <h2 id="record-heading" className="font-semibold text-ink">
            What was counted
          </h2>
          <div className="mt-3 overflow-x-auto rounded-lg bg-field">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Counted lines and their differences</caption>
              <thead className="border-b border-line bg-sheet text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Part</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">System</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Counted</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Variance</th>
                  <th scope="col" className="px-4 py-3 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {take.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/parts/${line.partId}`}
                        className="font-mono text-sm font-medium text-ink underline decoration-line hover:decoration-ink"
                      >
                        {line.partNumber}
                      </Link>
                      <span className="block text-ink">{line.description}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-muted">
                      {line.systemQty} {line.uom}
                    </td>
                    <td className="px-4 py-3 text-right text-ink">
                      {line.countedQty === null ? '—' : `${line.countedQty} ${line.uom}`}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={
                          line.variance === null || line.variance === 0
                            ? 'text-muted'
                            : 'font-medium text-warn'
                        }
                      >
                        {line.variance === null
                          ? '—'
                          : line.variance > 0
                            ? `+${line.variance}`
                            : line.variance}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{line.reasonCode ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : mayCount ? (
        <section aria-labelledby="count-heading">
          <h2 id="count-heading" className="font-semibold text-ink">
            Count the lines
          </h2>
          <p className="mt-1 text-sm text-muted">
            Type what is on the shelf. A blank is left uncounted; saving again is the recount.
          </p>
          <div className="mt-4">
            <CountForm
              action={recordCountsAction.bind(null, take.id)}
              lines={take.lines}
              blind={take.blindCount}
            />
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted">The store counts the shelves.</p>
      )}

      {!closed && mayApprove ? (
        <section className={cardClass} aria-labelledby="approve-heading">
          <h2 id="approve-heading" className="font-semibold text-ink">
            Approve the count
          </h2>
          <div className="mt-3">
            <ApproveStockTakeForm
              approveAction={approveStockTakeAction.bind(null, take.id)}
              cancelAction={cancelStockTakeAction.bind(null, take.id)}
              reference={take.reference}
              varianceLines={take.varianceLines}
            />
          </div>
        </section>
      ) : !closed && mayCount ? (
        <p className="text-sm text-muted">
          A count is approved by the storekeeper or an administrator.
        </p>
      ) : null}
    </div>
  )
}
