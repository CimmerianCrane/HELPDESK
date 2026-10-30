import type { Metadata } from 'next'
import { cardClass } from '@/components/office/ui'
import { CRANE_TYPE_LABELS } from '@/lib/cranes/labels'
import { CRANE_STATUS_LABELS } from '@/lib/cranes/labels'
import { requirePortalPage } from '../../guard'
import { listCranes } from '@/server/cranes/cranes'
import { requirePortalCustomer } from '@/server/portal/portal'

export const metadata: Metadata = { title: 'Cranes — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The customer's cranes. `listCranes` is the office's register read, narrowed by `craneReadWhere` to
 * this customer — the restricted flag and its reason come along, because a customer needs to know a
 * machine is out of service.
 */
export default async function PortalCranesPage() {
  const context = await requirePortalPage()
  requirePortalCustomer(context)
  const cranes = await listCranes(context)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Cranes</h1>
        <p className="mt-1 text-slate-600">
          {cranes.length} {cranes.length === 1 ? 'crane' : 'cranes'} on your account.
        </p>
      </div>

      {cranes.length === 0 ? (
        <p className={`${cardClass} text-sm text-slate-600`}>No cranes on this account yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {cranes.map((crane) => (
            <li key={crane.id} className={cardClass}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-slate-900">{crane.assetTag}</p>
                <span
                  className={
                    crane.status === 'RESTRICTED'
                      ? 'rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800'
                      : 'text-xs text-slate-500'
                  }
                >
                  {CRANE_STATUS_LABELS[crane.status]}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {CRANE_TYPE_LABELS[crane.type]}
                {crane.brand ? ` · ${crane.brand}` : ''}
                {crane.model ? ` ${crane.model}` : ''}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                SWL {crane.swlKg.toLocaleString('en-GB')} kg
                {crane.serialNumber ? ` · serial ${crane.serialNumber}` : ''}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {crane.site.name}
                {crane.locationOnSite ? ` · ${crane.locationOnSite}` : ''}
              </p>
              {crane.status === 'RESTRICTED' && crane.restrictedReason ? (
                <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {crane.restrictedReason}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
