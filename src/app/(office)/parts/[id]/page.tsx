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
        <Link href="/parts" className="text-sm text-slate-600 underline hover:text-slate-900">
          ← Parts
        </Link>
        <h1 className="mt-2 font-mono text-2xl font-semibold text-slate-900">{part.partNumber}</h1>
        <p className="mt-1 text-slate-600">{part.description}</p>
        <p className="mt-1 text-sm text-slate-500">
          {part.brand ?? 'No brand'}
          {part.compatibleModels.length > 0
            ? ` · fits ${part.compatibleModels.join(', ')}`
            : ''}
          {part.trackSerialOrBatch ? ' · traced by serial or batch' : ''}
        </p>
      </div>

      <section className={`${cardClass} grid gap-6 sm:grid-cols-4`} aria-label="Stock summary">
        <div>
          <p className="text-xs tracking-wide text-slate-500 uppercase">On hand</p>
          <p
            className={
              part.onHand < 0
                ? 'mt-1 text-2xl font-semibold text-red-700'
                : part.belowReorder
                  ? 'mt-1 text-2xl font-semibold text-amber-800'
                  : 'mt-1 text-2xl font-semibold text-slate-900'
            }
          >
            {part.onHand}{' '}
            <span className="text-base font-normal text-slate-500">{part.uom}</span>
          </p>
          {part.belowReorder ? (
            <p className="mt-1 text-xs text-amber-800">
              {part.reorderLevel === null
                ? 'Below reorder level'
                : `Below the reorder level of ${part.reorderLevel} ${part.uom}`}
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-xs tracking-wide text-slate-500 uppercase">Reorder at</p>
          <p className="mt-1 text-lg text-slate-900">
            {part.reorderLevel === null ? '—' : `${part.reorderLevel} ${part.uom}`}
          </p>
          {part.reorderQty !== null ? (
            <p className="mt-1 text-xs text-slate-500">
              Order {part.reorderQty} {part.uom} at a time
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-xs tracking-wide text-slate-500 uppercase">Cost</p>
          <p className="mt-1 text-lg text-slate-900">{formatMoney(part.cost, settings.currency)}</p>
        </div>
        <div>
          <p className="text-xs tracking-wide text-slate-500 uppercase">Sell</p>
          <p className="mt-1 text-lg text-slate-900">{formatMoney(part.sellPrice, settings.currency)}</p>
        </div>
      </section>

      {heldJobs.length > 0 ? (
        <section
          className="rounded-lg border border-amber-300 bg-amber-50 p-4"
          aria-labelledby="held-jobs-heading"
        >
          <h2 id="held-jobs-heading" className="font-semibold text-amber-900">
            Jobs waiting for this part
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {heldJobs.map((job) => (
              <li key={job.id}>
                <Link href={`/jobs/${job.id}`} className="font-medium underline hover:text-amber-950">
                  {job.number}
                </Link>{' '}
                — {job.customerName}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="levels-heading">
        <h2 id="levels-heading" className="font-semibold text-slate-900">
          Where it is
        </h2>
        {part.levels.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            No stock has been received at any location yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
            {part.levels.map((level) => (
              <li key={level.locationId} className="flex items-baseline justify-between px-4 py-3">
                <span className="text-slate-900">
                  {level.locationName}
                  <span className="ml-2 text-xs text-slate-500">
                    {level.locationType === 'WAREHOUSE'
                      ? 'Warehouse'
                      : level.locationType === 'VAN'
                        ? 'Van'
                        : level.locationType === 'CUSTOMER_SITE'
                          ? 'Customer site'
                          : 'Bin'}
                  </span>
                </span>
                <span className={level.quantity < 0 ? 'font-medium text-red-700' : 'text-slate-900'}>
                  {level.quantity} {part.uom}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {mayMove ? (
        <section className={`${cardClass}`} aria-labelledby="stock-form-heading">
          <h2 id="stock-form-heading" className="font-semibold text-slate-900">
            Post a stock movement
          </h2>
          <p className="mt-1 text-sm text-slate-600">
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
          <h2 id="transfer-heading" className="font-semibold text-slate-900">
            Transfer to another location
          </h2>
          <p className="mt-1 text-sm text-slate-600">
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
          <h2 id="trace-heading" className="font-semibold text-slate-900">
            Serial and batch trace
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Which serial went on which crane, and where the rest of the batch is now.
          </p>
          <ul className="mt-3 space-y-3">
            {traces.map((trace) => (
              <li
                key={trace.serial}
                className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-mono font-medium text-slate-900">{trace.serial}</p>
                  <p
                    className={
                      trace.held === 0
                        ? 'text-slate-500'
                        : trace.held < 0
                          ? 'font-medium text-red-700'
                          : 'text-slate-900'
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
                  <p className="mt-1 text-sm text-red-700">
                    This serial went out on more than the record shows coming in — the stock was
                    probably received without it. Count the shelf and post an adjustment naming this
                    serial.
                  </p>
                ) : null}

                {trace.whereabouts.length > 0 ? (
                  <p className="mt-1 text-slate-600">
                    At{' '}
                    {trace.whereabouts
                      .map((where) => `${where.locationName} (${where.quantity})`)
                      .join(', ')}
                  </p>
                ) : null}

                {trace.issuedTo.length === 0 ? (
                  <p className="mt-1 text-slate-500">Not fitted to a job yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-slate-700">
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
        <h2 id="movements-heading" className="font-semibold text-slate-900">
          Last 20 movements
        </h2>
        {part.movements.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nothing has moved yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Stock movements for this part, newest first</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">When</th>
                  <th scope="col" className="px-4 py-3 font-medium">Movement</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Qty</th>
                  <th scope="col" className="px-4 py-3 font-medium">From → to</th>
                  <th scope="col" className="px-4 py-3 font-medium">Against</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {part.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      {formatDateTime(movement.movedAt, settings.timezone)}
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      {MOVEMENT_TYPE_LABELS[movement.type as MovementType]}
                      {movement.serialOrBatch ? (
                        <span className="block font-mono text-xs text-slate-500">
                          {movement.serialOrBatch}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900">
                      {movement.quantity} {part.uom}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {movement.fromLocation ?? '—'} → {movement.toLocation ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
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
          <summary className="cursor-pointer font-semibold text-slate-900">Edit this part</summary>
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
