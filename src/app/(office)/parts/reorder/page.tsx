import type { Metadata } from 'next'
import Link from 'next/link'
import {
  RaisePurchaseOrderForm,
  ReceivePurchaseOrderForm,
} from '@/components/office/purchase-order-forms'
import { cardClass } from '@/components/office/ui'
import { formatDate, formatMoney } from '@/lib/format'
import { PURCHASE_ORDER_STATUS_LABELS } from '@/lib/validation/purchase-orders'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { locationOptions } from '@/server/inventory/locations'
import { listOpenPurchaseOrders, reorderGroups } from '@/server/inventory/purchase-orders'
import { getSettings } from '@/server/settings/settings'
import { raisePurchaseOrderAction, receivePurchaseOrderAction } from './actions'

export const metadata: Metadata = { title: 'Reorder — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * What to buy, from whom, and what is already on its way (brief §9, slice 25).
 *
 * The list is the catalogue's own below-reorder count, grouped by the supplier each part prefers. The
 * suggested quantity is the store's standing order size where it set one, and otherwise enough to get
 * back to the reorder level. The store can blank a line; it cannot delete a part from the catalogue by
 * ordering nothing.
 */
export default async function ReorderPage() {
  const context = await requireAuth()
  const mayOrder = can(context.role, 'purchaseorder.write')

  const [groups, settings, locations, orders] = await Promise.all([
    reorderGroups(context),
    getSettings(),
    mayOrder ? locationOptions(context) : Promise.resolve([]),
    mayOrder ? listOpenPurchaseOrders(context) : Promise.resolve([]),
  ])

  const shortParts = groups.reduce((sum, group) => sum + group.lines.length, 0)

  return (
    <div className="space-y-8">
      <div>
        <Link href="/parts" className="text-sm text-slate-600 underline hover:text-slate-900">
          ← Parts
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Reorder</h1>
        <p className="mt-1 text-slate-600">
          {shortParts === 0
            ? 'Nothing is below its reorder level.'
            : `${shortParts} part${shortParts === 1 ? '' : 's'} below reorder, grouped by preferred supplier.`}
        </p>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          The suggested quantity is the part&rsquo;s reorder quantity where the catalogue sets one, and
          otherwise enough to bring the shelf back to its reorder level. Raising an order copies the
          catalog&rsquo;s cost onto it; receiving posts a stock movement for every line, so the shelf and
          the order move together.
        </p>
      </div>

      {shortParts === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-slate-900">Everything is above its reorder level.</p>
          <p className="mt-1 text-sm text-slate-600">
            The parts book sets each part&rsquo;s reorder level and quantity.
          </p>
        </div>
      ) : null}

      {groups.map((group) => {
        const heading = group.supplier?.name ?? 'No preferred supplier'

        return (
          <section key={group.supplier?.id ?? 'none'} aria-labelledby={`group-${group.supplier?.id ?? 'none'}`}>
            <h2 id={`group-${group.supplier?.id ?? 'none'}`} className="font-semibold text-slate-900">
              {heading}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {group.lines.length} part{group.lines.length === 1 ? '' : 's'}
              {group.supplier?.leadTimeDays
                ? ` · usually ${group.supplier.leadTimeDays} days to deliver`
                : ''}
              {' · '}
              about {formatMoney(group.estimatedCost, settings.currency)} at catalogue cost
            </p>

            {!mayOrder ? (
              <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
                {group.lines.map((line) => (
                  <li key={line.partId} className="flex items-baseline justify-between gap-4 px-4 py-3">
                    <span>
                      <Link
                        href={`/parts/${line.partId}`}
                        className="font-mono font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                      >
                        {line.partNumber}
                      </Link>
                      <span className="block text-slate-700">{line.description}</span>
                    </span>
                    <span className="text-right text-amber-800">
                      {line.onHand} {line.uom} on hand
                      <span className="block text-xs text-slate-500">
                        Order {line.suggestedQuantity} {line.uom}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : group.supplier === null ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                These parts have no preferred supplier, so no purchase order can be raised for them.
                Choose a supplier on each part in the catalogue.
                <ul className="mt-2 space-y-1">
                  {group.lines.map((line) => (
                    <li key={line.partId}>
                      <Link href={`/parts/${line.partId}`} className="font-mono underline">
                        {line.partNumber}
                      </Link>{' '}
                      — {line.onHand} {line.uom} on hand, order {line.suggestedQuantity} {line.uom}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <RaisePurchaseOrderForm
                action={raisePurchaseOrderAction.bind(null, group.supplier.id)}
                supplierName={group.supplier.name}
                lines={group.lines}
                currency={settings.currency}
              />
            )}
          </section>
        )
      })}

      <section aria-labelledby="on-order-heading">
        <h2 id="on-order-heading" className="font-semibold text-slate-900">
          On order
        </h2>
        {!mayOrder ? (
          <p className="mt-2 text-sm text-slate-500">The store raises and receives purchase orders.</p>
        ) : orders.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No purchase orders are open.</p>
        ) : (
          <div className="mt-3 space-y-6">
            {orders.map((order) => (
              <div key={order.id} className={cardClass}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="font-mono font-semibold text-slate-900">{order.number}</p>
                    <p className="text-sm text-slate-600">
                      {order.supplierName} · {PURCHASE_ORDER_STATUS_LABELS[order.status]}
                    </p>
                  </div>
                  <p className="text-sm text-slate-600">
                    Expected {formatDate(order.expectedAt, settings.timezone)} ·{' '}
                    {formatMoney(order.total, settings.currency)}
                  </p>
                </div>

                <ReceivePurchaseOrderForm
                  action={receivePurchaseOrderAction.bind(null, order.id)}
                  number={order.number}
                  lines={order.lines}
                  locations={locations}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
