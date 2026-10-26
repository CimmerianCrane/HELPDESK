import type { Metadata } from 'next'
import Link from 'next/link'
import { cardClass } from '@/components/office/ui'
import { CRANE_STATUSES, CRANE_TYPES } from '@/lib/validation/cranes'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { listCranes } from '@/server/cranes/cranes'
import { CRANE_STATUS_LABELS, CRANE_TYPE_LABELS } from '@/lib/cranes/labels'

export const metadata: Metadata = { title: 'Crane register — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

const STATUS_STYLES: Record<string, string> = {
  IN_SERVICE: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  RESTRICTED: 'border-red-300 bg-red-50 font-medium text-red-800',
  OUT_OF_SERVICE: 'border-amber-200 bg-amber-50 text-amber-800',
  DECOMMISSIONED: 'border-slate-200 bg-slate-100 text-slate-600',
}

export default async function CranesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string }>
}) {
  const context = await requireAuth()
  const { q, status, type } = await searchParams

  const cranes = await listCranes(context, { q: q ?? '', status: status ?? '', type: type ?? '' })
  const mayImport = can(context.role, 'crane.import')
  const filtered = Boolean(q || status || type)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Crane register</h1>
          <p className="mt-1 text-slate-600">
            {cranes.length === 0
              ? filtered
                ? 'No cranes match those filters.'
                : 'No cranes in the register yet.'
              : `${cranes.length}${cranes.length === 500 ? '+' : ''} ${cranes.length === 1 ? 'crane' : 'cranes'}.`}
          </p>
        </div>

        {mayImport ? (
          <Link
            href="/cranes/import"
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Import from CSV
          </Link>
        ) : null}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="block text-sm font-medium text-slate-700">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Asset tag, serial number, customer or site"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="type" className="block text-sm font-medium text-slate-700">
            Type
          </label>
          <select
            id="type"
            name="type"
            defaultValue={type ?? ''}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          >
            <option value="">All</option>
            {CRANE_TYPES.map((value) => (
              <option key={value} value={value}>
                {CRANE_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="status" className="block text-sm font-medium text-slate-700">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ''}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          >
            <option value="">All</option>
            {CRANE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {CRANE_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800">
          Filter
        </button>

        {filtered ? (
          <Link href="/cranes" className="px-2 py-2 text-sm text-slate-600 underline">
            Clear
          </Link>
        ) : null}
      </form>

      {cranes.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-slate-900">
            {filtered ? 'Nothing matches those filters.' : 'The register is empty.'}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {filtered
              ? 'Try a shorter search, or clear the filters.'
              : 'Cranes are added to a site: open a customer, then one of its sites.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Cranes</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Asset tag</th>
                <th scope="col" className="px-4 py-3 font-medium">Type</th>
                <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                <th scope="col" className="px-4 py-3 font-medium">Site</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">SWL</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cranes.map((crane) => (
                <tr key={crane.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/cranes/${crane.id}`}
                      className="font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                    >
                      {crane.assetTag}
                    </Link>
                    {crane.serialNumber ? (
                      <span className="block text-xs text-slate-500">S/N {crane.serialNumber}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{CRANE_TYPE_LABELS[crane.type]}</td>
                  <td className="px-4 py-3">
                    <Link href={`/customers/${crane.site.customerId}`} className="text-slate-900 underline">
                      {crane.site.customerName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/sites/${crane.site.id}`} className="text-slate-600 underline">
                      {crane.site.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">{crane.swlKg.toLocaleString()} kg</td>
                  <td className="px-4 py-3">
                    <span className={`rounded border px-2 py-0.5 text-xs ${STATUS_STYLES[crane.status] ?? ''}`}>
                      {CRANE_STATUS_LABELS[crane.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
