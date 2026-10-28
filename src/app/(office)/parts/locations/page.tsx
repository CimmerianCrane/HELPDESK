import type { Metadata } from 'next'
import Link from 'next/link'
import { LocationForm } from '@/components/office/part-forms'
import { cardClass } from '@/components/office/ui'
import { LOCATION_TYPE_LABELS, type LocationTypeName } from '@/lib/validation/locations'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { listLocations } from '@/server/inventory/locations'
import { createLocationAction, updateLocationAction } from './actions'

export const metadata: Metadata = { title: 'Stock locations — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * Where stock sits (brief §9, slice 23).
 *
 * A location is never deleted, only retired, because movements name it forever. The screen says what
 * each one holds, which is the number that decides whether retiring it is safe — and the form refuses
 * one that is not.
 */
export default async function LocationsPage() {
  const context = await requireAuth()
  const locations = await listLocations(context)

  const mayWrite = can(context.role, 'part.write')
  const warehouses = locations
    .filter((location) => location.type === 'WAREHOUSE' && location.isActive)
    .map((location) => ({ id: location.id, name: location.name }))

  return (
    <div className="space-y-8">
      <div>
        <Link href="/parts" className="text-sm text-slate-600 underline hover:text-slate-900">
          ← Parts
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Stock locations</h1>
        <p className="mt-1 text-slate-600">
          {locations.length} {locations.length === 1 ? 'location' : 'locations'} — the store, bins in
          it, technicians&rsquo; vans and parts held at a customer&rsquo;s site.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          A location is retired, never deleted: every movement that ever touched it keeps naming it.
          Transfer the stock out first — a location still holding something cannot be retired.
        </p>
      </div>

      {locations.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-slate-900">No locations yet.</p>
          <p className="mt-1 text-sm text-slate-600">
            The first one is the store. Adding it is the first thing below.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Stock locations and what each holds</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Location</th>
                <th scope="col" className="px-4 py-3 font-medium">Kind</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Lines</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Quantity</th>
                <th scope="col" className="px-4 py-3 font-medium">State</th>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {locations.map((location) => (
                <tr key={location.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">{location.name}</span>
                    {location.parentName ? (
                      <span className="block text-xs text-slate-500">Inside {location.parentName}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {LOCATION_TYPE_LABELS[location.type as LocationTypeName]}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">{location.partCount}</td>
                  <td className="px-4 py-3 text-right text-slate-900">{location.quantity}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        location.isActive
                          ? 'rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800'
                          : 'rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-600'
                      }
                    >
                      {location.isActive ? 'Active' : 'Retired'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {mayWrite ? (
                      <details>
                        <summary className="cursor-pointer text-sm text-slate-700 underline">
                          Edit
                        </summary>
                        <div className="mt-3 min-w-72">
                          <LocationForm
                            action={updateLocationAction.bind(null, location.id)}
                            values={location}
                            warehouses={warehouses.filter((row) => row.id !== location.id)}
                            submitLabel="Save location"
                          />
                        </div>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mayWrite ? (
        <details className={cardClass}>
          <summary className="cursor-pointer font-semibold text-slate-900">Add a location</summary>
          <div className="mt-4">
            <LocationForm
              action={createLocationAction}
              values={null}
              warehouses={warehouses}
              submitLabel="Add location"
            />
          </div>
        </details>
      ) : (
        <p className="text-sm text-slate-500">The store maintains stock locations.</p>
      )}
    </div>
  )
}
