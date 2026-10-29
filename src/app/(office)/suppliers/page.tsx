import type { Metadata } from 'next'
import Link from 'next/link'
import { SupplierForm } from '@/components/office/supplier-forms'
import { cardClass } from '@/components/office/ui'
import { formatDate, formatMoney } from '@/lib/format'
import { PURCHASE_ORDER_STATUS_LABELS } from '@/lib/validation/purchase-orders'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { listSuppliers } from '@/server/inventory/suppliers'
import { getSettings } from '@/server/settings/settings'
import { createSupplierAction, updateSupplierAction } from './actions'

export const metadata: Metadata = { title: 'Suppliers — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The supplier book (brief §9, slice 27).
 *
 * Each row is a supplier, the parts that prefer it, and the orders it has taken — the last of those
 * is the price history: what was actually paid, from the purchase orders themselves rather than a
 * second table that could drift from them.
 */
export default async function SuppliersPage() {
  const context = await requireAuth()
  const [suppliers, settings] = await Promise.all([listSuppliers(context), getSettings()])

  const mayWrite = can(context.role, 'supplier.write')
  const active = suppliers.filter((supplier) => supplier.isActive).length

  return (
    <div className="space-y-8">
      <div>
        <Link href="/parts" className="text-sm text-slate-600 underline hover:text-slate-900">
          ← Parts
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Suppliers</h1>
        <p className="mt-1 text-slate-600">
          {suppliers.length} {suppliers.length === 1 ? 'supplier' : 'suppliers'} · {active} active
        </p>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          A supplier is retired, never deleted: the parts that prefer it and every order raised from it
          keep naming it. A supplier still named by a part cannot be retired until those parts are
          pointed elsewhere.
        </p>
      </div>

      {suppliers.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-slate-900">No suppliers yet.</p>
          <p className="mt-1 text-sm text-slate-600">
            Add the trade counters you buy from, then point each part at one so the reorder list can
            group it.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {suppliers.map((supplier) => (
            <section
              key={supplier.id}
              className={cardClass}
              aria-labelledby={`supplier-${supplier.id}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 id={`supplier-${supplier.id}`} className="font-semibold text-slate-900">
                    {supplier.name}
                  </h2>
                  <p className="text-sm text-slate-600">
                    {[supplier.contactName, supplier.phone, supplier.email]
                      .filter(Boolean)
                      .join(' · ') || 'No contact details'}
                    {supplier.leadTimeDays !== null
                      ? ` · usually ${supplier.leadTimeDays} days to deliver`
                      : ''}
                  </p>
                </div>
                <span
                  className={
                    supplier.isActive
                      ? 'rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800'
                      : 'rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-600'
                  }
                >
                  {supplier.isActive ? 'Active' : 'Retired'}
                </span>
              </div>

              {supplier.notes ? (
                <p className="mt-2 text-sm text-slate-600">{supplier.notes}</p>
              ) : null}

              <div className="mt-4 grid gap-6 lg:grid-cols-2">
                <div>
                  <h3 className="text-xs tracking-wide text-slate-500 uppercase">Parts it supplies</h3>
                  {supplier.parts.length === 0 ? (
                    <p className="mt-1 text-sm text-slate-500">
                      No part prefers this supplier yet. Choose it on a part in the{' '}
                      <Link href="/parts" className="underline">
                        catalogue
                      </Link>
                      .
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {supplier.parts.map((part) => (
                        <li key={part.id} className="flex justify-between gap-2">
                          <Link href={`/parts/${part.id}`} className="font-mono underline">
                            {part.partNumber}
                          </Link>
                          <span className="text-slate-600">
                            {formatMoney(part.cost, settings.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="text-xs tracking-wide text-slate-500 uppercase">
                    Orders and price history
                  </h3>
                  {supplier.orders.length === 0 ? (
                    <p className="mt-1 text-sm text-slate-500">No purchase orders raised yet.</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {supplier.orders.map((order) => (
                        <li key={order.id} className="flex justify-between gap-2">
                          <span>
                            <Link href="/parts/reorder" className="font-mono underline">
                              {order.number}
                            </Link>{' '}
                            <span className="text-slate-500">
                              {PURCHASE_ORDER_STATUS_LABELS[order.status]} ·{' '}
                              {formatDate(order.orderedAt, settings.timezone)}
                            </span>
                          </span>
                          <span className="text-slate-900">
                            {formatMoney(order.total, settings.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {mayWrite ? (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-slate-700 underline">Edit</summary>
                  <div className="mt-3 max-w-2xl">
                    <SupplierForm
                      action={updateSupplierAction.bind(null, supplier.id)}
                      values={supplier}
                      submitLabel="Save supplier"
                    />
                  </div>
                </details>
              ) : null}
            </section>
          ))}
        </div>
      )}

      {mayWrite ? (
        <details className={cardClass}>
          <summary className="cursor-pointer font-semibold text-slate-900">Add a supplier</summary>
          <div className="mt-4 max-w-2xl">
            <SupplierForm action={createSupplierAction} values={null} submitLabel="Add supplier" />
          </div>
        </details>
      ) : (
        <p className="text-sm text-slate-500">The store maintains the supplier book.</p>
      )}
    </div>
  )
}
