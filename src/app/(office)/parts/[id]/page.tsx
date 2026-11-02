import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PartForm, StockEntryForm, TransferForm } from '@/components/office/part-forms'
import { cardClass } from '@/components/office/ui'
import { formatDate, formatDateTime, formatMoney } from '@/lib/format'
import { MOVEMENT_TYPE_LABELS } from '@/lib/validation/parts'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { locationOptions } from '@/server/inventory/locations'
import { getPart, heldJobsForPart, tracePartSerials } from '@/server/inventory/parts'
import { supplierOptions } from '@/server/inventory/suppliers'
import { getSettings } from '@/server/settings/settings'
import { isAppError } from '@/server/auth/errors'
import type { MovementType } from '@prisma/client'
import { postStockAction, transferStockAction, updatePartAction } from '../actions'

export const metadata: Metadata = { title: 'Part — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * One part: where the stock is, where it went, and the two forms that change either (slice 22).
 *
 * The movement list is the part's own history — the thing a storekeeper reads when the shelf and the
 * figure disagree — so it shows the job that took it and the serial when there is one.
 */
export default async function PartPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireAuth()
  const { id } = await params

  const mayWrite = can(context.role, 'part.write')

  const [part, settings, locations, traces, suppliers, heldJobs] = await Promise.all([
    getPart(context, id).catch((error: unknown) => {
      if (isAppError(error) && error.status === 404) notFound()
      throw error
    }),
    getSettings(),
    // Every active location, not only the ones the part already sits in: receiving into a new bin is
    // the common case, and the old list could only offer places the part had already been.
    locationOptions(context),
    // Every serial and batch the ledger has seen for this part (slice 24). Empty for a part nobody
    // has ever typed a serial against, which is most of the catalogue.
    tracePartSerials(context, id),
    mayWrite ? supplierOptions(context) : Promise.resolve([]),
    // Who is standing still while this is out of stock (slice 28).
    heldJobsForPart(context, id),
  ])

  const mayMove = can(context.role, 'stock.move')

  return (
    <div className="space-y-8">
      <div>
        <Link href="/parts" className="text-sm text-muted underline hover:text-ink">
          ← Parts
        </Link>
        <h1 className="mt-2 font-mono text-title font-semibold text-ink">{part.partNumber}</h1>
        <p className="mt-1 text-muted">{part.description}</p>
        <p className="mt-1 text-sm text-muted">
          {part.brand ?? 'No brand'}
          {part.compatibleModels.length > 0
            ? ` · fits ${part.compatibleModels.join(', ')}`
            : ''}
          {part.trackSerialOrBatch ? ' · traced by serial or batch' : ''}
        </p>
      </div>

      <section className={`${cardClass} grid gap-6 sm:grid-cols-4`} aria-label="Stock summary">
        <div>
          <p className="text-xs text-muted">On hand</p>
          <p
            className={
              part.onHand < 0
                ? 'mt-1 text-2xl font-semibold text-neg'
                : part.belowReorder
                  ? 'mt-1 text-2xl font-semibold text-warn'
                  : 'mt-1 text-2xl font-semibold text-ink'
            }
          >
            {part.onHand}{' '}
            <span className="text-base font-normal text-muted">{part.uom}</span>
          </p>
          {part.belowReorder ? (
            <p className="mt-1 text-xs text-warn">
              {part.reorderLevel === null
                ? 'Below reorder level'
                : `Below the reorder level of ${part.reorderLevel} ${part.uom}`}
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-xs text-muted">Reorder at</p>
          <p className="mt-1 text-lg text-ink">
            {part.reorderLevel === null ? '—' : `${part.reorderLevel} ${part.uom}`}
          </p>
          {part.reorderQty !== null ? (
            <p className="mt-1 text-xs text-muted">
              Order {part.reorderQty} {part.uom} at a time
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-xs text-muted">Cost</p>
          <p className="mt-1 text-lg text-ink">{formatMoney(part.cost, settings.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Sell</p>
          <p className="mt-1 text-lg text-ink">{formatMoney(part.sellPrice, settings.currency)}</p>
        </div>
      </section>

      {heldJobs.length > 0 ? (
        <section
          className="rounded-lg border border-warn/40 bg-warn/10 p-4"
          aria-labelledby="held-jobs-heading"
        >
          <h2 id="held-jobs-heading" className="font-semibold text-warn">
            Jobs waiting for this part
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-warn">
            {heldJobs.map((job) => (
              <li key={job.id}>
                <Link href={`/jobs/${job.id}`} className="font-medium underline hover:text-ink">
                  {job.number}
                </Link>{' '}
                — {job.customerName}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="levels-heading">
        <h2 id="levels-heading" className="font-semibold text-ink">
          Where it is
        </h2>
        {part.levels.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            No stock has been received at any location yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-rule rounded-lg border border-line bg-field text-sm">
            {part.levels.map((level) => (
              <li key={level.locationId} className="flex items-baseline justify-between px-4 py-3">
                <span className="text-ink">
                  {level.locationName}
                  <span className="ml-2 text-xs text-muted">
                    {level.locationType === 'WAREHOUSE'
                      ? 'Warehouse'
                      : level.locationType === 'VAN'
                        ? 'Van'
                        : level.locationType === 'CUSTOMER_SITE'
                          ? 'Customer site'
                          : 'Bin'}
                  </span>
                </span>
                <span className={level.quantity < 0 ? 'font-medium text-neg' : 'text-ink'}>
                  {level.quantity} {part.uom}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {mayMove ? (
        <section className={`${cardClass}`} aria-labelledby="stock-form-heading">
          <h2 id="stock-form-heading" className="font-semibold text-ink">
            Post a stock movement
          </h2>
          <p className="mt-1 text-sm text-muted">
            Receiving and returning add stock. An adjustment is a count: type what is on the shelf and
            the difference is written as a movement with your name on it.
          </p>
          <div className="mt-4">
            <StockEntryForm action={postStockAction.bind(null, part.id)} locations={locations} />
          </div>
        </section>
      ) : null}

      {mayMove ? (
        <section className={cardClass} aria-labelledby="transfer-heading">
          <h2 id="transfer-heading" className="font-semibold text-ink">
            Transfer to another location
          </h2>
          <p className="mt-1 text-sm text-muted">
            Takes stock out of one location and puts it in another — the store to a van, a van back to
            a bin. The source must hold what you transfer; post a count first if it does not.
            Locations are maintained under{' '}
            <Link href="/parts/locations" className="underline">
              stock locations
            </Link>
            .
          </p>
          <div className="mt-4">
            <TransferForm action={transferStockAction.bind(null, part.id)} locations={locations} />
          </div>
        </section>
      ) : null}

      {traces.length > 0 ? (
        <section aria-labelledby="trace-heading">
          <h2 id="trace-heading" className="font-semibold text-ink">
            Serial and batch trace
          </h2>
          <p className="mt-1 text-sm text-muted">
            Which serial went on which crane, and where the rest of the batch is now.
          </p>
          <ul className="mt-3 space-y-3">
            {traces.map((trace) => (
              <li
                key={trace.serial}
                className="rounded-lg bg-panel p-4 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-mono font-medium text-ink">{trace.serial}</p>
                  <p
                    className={
                      trace.held === 0
                        ? 'text-muted'
                        : trace.held < 0
                          ? 'font-medium text-neg'
                          : 'text-ink'
                    }
                  >
                    {trace.held === 0
                      ? 'None left in stock'
                      : trace.held < 0
                        ? `${Math.abs(trace.held)} ${part.uom} more issued than received`
                        : `${trace.held} ${part.uom} still held`}
                  </p>
                </div>

                {trace.held < 0 ? (
                  <p className="mt-1 text-sm text-neg">
                    This serial went out on more than the record shows coming in — the stock was
                    probably received without it. Count the shelf and post an adjustment naming this
                    serial.
                  </p>
                ) : null}

                {trace.whereabouts.length > 0 ? (
                  <p className="mt-1 text-muted">
                    At{' '}
                    {trace.whereabouts
                      .map((where) => `${where.locationName} (${where.quantity})`)
                      .join(', ')}
                  </p>
                ) : null}

                {trace.issuedTo.length === 0 ? (
                  <p className="mt-1 text-muted">Not fitted to a job yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-ink">
                    {trace.issuedTo.map((issue, position) => (
                      <li key={`${issue.jobId}-${position}`}>
                        {issue.quantity} {part.uom} on{' '}
                        <Link href={`/jobs/${issue.jobId}`} className="underline">
                          {issue.jobNumber}
                        </Link>
                        {issue.craneTags.length > 0
                          ? ` · crane${issue.craneTags.length === 1 ? '' : 's'} ${issue.craneTags.join(', ')}`
                          : ''}
                        {' · '}
                        {formatDate(issue.issuedAt, settings.timezone)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="movements-heading">
        <h2 id="movements-heading" className="font-semibold text-ink">
          Last 20 movements
        </h2>
        {part.movements.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing has moved yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg bg-field">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Stock movements for this part, newest first</caption>
              <thead className="border-b border-line bg-sheet text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">When</th>
                  <th scope="col" className="px-4 py-3 font-medium">Movement</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Qty</th>
                  <th scope="col" className="px-4 py-3 font-medium">From → to</th>
                  <th scope="col" className="px-4 py-3 font-medium">Against</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {part.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {formatDateTime(movement.movedAt, settings.timezone)}
                    </td>
                    <td className="px-4 py-3 text-ink">
                      {MOVEMENT_TYPE_LABELS[movement.type as MovementType]}
                      {movement.serialOrBatch ? (
                        <span className="block font-mono text-xs text-muted">
                          {movement.serialOrBatch}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right text-ink">
                      {movement.quantity} {part.uom}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {movement.fromLocation ?? '—'} → {movement.toLocation ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {movement.job ? (
                        <Link href={`/jobs/${movement.job.id}`} className="underline">
                          {movement.job.number}
                        </Link>
                      ) : (
                        (movement.reasonCode ?? '—')
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {mayWrite ? (
        <details className={cardClass}>
          <summary className="cursor-pointer font-semibold text-ink">Edit this part</summary>
          <div className="mt-4">
            <PartForm
              action={updatePartAction.bind(null, part.id)}
              values={part}
              suppliers={suppliers}
              submitLabel="Save changes"
            />
          </div>
        </details>
      ) : null}
    </div>
  )
}
