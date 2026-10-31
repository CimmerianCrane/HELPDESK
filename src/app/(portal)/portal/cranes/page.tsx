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
        <h1 className="text-title font-semibold text-ink">Cranes</h1>
        <p className="mt-1 text-muted">
          {cranes.length} {cranes.length === 1 ? 'crane' : 'cranes'} on your account.
        </p>
      </div>

      {cranes.length === 0 ? (
        <p className={`${cardClass} text-sm text-muted`}>No cranes on this account yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {cranes.map((crane) => (
            <li key={crane.id} className={cardClass}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-ink">{crane.assetTag}</p>
                <span
                  className={
                    crane.status === 'RESTRICTED'
                      ? 'rounded border border-neg/40 bg-neg/10 px-2 py-0.5 text-xs font-medium text-neg'
                      : 'text-xs text-muted'
                  }
                >
                  {CRANE_STATUS_LABELS[crane.status]}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">
                {CRANE_TYPE_LABELS[crane.type]}
                {crane.brand ? ` · ${crane.brand}` : ''}
                {crane.model ? ` ${crane.model}` : ''}
              </p>
              <p className="mt-1 text-sm text-muted">
                SWL {crane.swlKg.toLocaleString('en-GB')} kg
                {crane.serialNumber ? ` · serial ${crane.serialNumber}` : ''}
              </p>
              <p className="mt-1 text-sm text-muted">
                {crane.site.name}
                {crane.locationOnSite ? ` · ${crane.locationOnSite}` : ''}
              </p>
              {crane.status === 'RESTRICTED' && crane.restrictedReason ? (
                <p className="mt-2 rounded border border-neg/40 bg-neg/10 px-3 py-2 text-sm text-neg">
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
