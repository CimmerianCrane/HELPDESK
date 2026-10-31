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
  IN_SERVICE: 'border-pos/40 bg-pos/10 text-pos',
  RESTRICTED: 'border-neg/40 bg-neg/10 font-medium text-neg',
  OUT_OF_SERVICE: 'border-warn/40 bg-warn/10 text-warn',
  DECOMMISSIONED: 'border-line bg-raised text-muted',
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
          <h1 className="text-title font-semibold text-ink">Crane register</h1>
          <p className="mt-1 text-muted">
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
            className="rounded-md border border-line bg-field px-4 py-2 text-sm font-medium text-ink hover:bg-raised"
          >
            Import from CSV
          </Link>
        ) : null}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="block text-sm font-medium text-ink">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Asset tag, serial number, customer or site"
            className="mt-1 block w-full rounded-md border border-line bg-field px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
          />
        </div>

        <div>
          <label htmlFor="type" className="block text-sm font-medium text-ink">
            Type
          </label>
          <select
            id="type"
            name="type"
            defaultValue={type ?? ''}
            className="mt-1 block rounded-md border border-line bg-field px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
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
          <label htmlFor="status" className="block text-sm font-medium text-ink">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ''}
            className="mt-1 block rounded-md border border-line bg-field px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
          >
            <option value="">All</option>
            {CRANE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {CRANE_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-anchor-soft">
          Filter
        </button>

        {filtered ? (
          <Link href="/cranes" className="px-2 py-2 text-sm text-muted underline">
            Clear
          </Link>
        ) : null}
      </form>

      {cranes.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-ink">
            {filtered ? 'Nothing matches those filters.' : 'The register is empty.'}
          </p>
          <p className="mt-1 text-sm text-muted">
            {filtered
              ? 'Try a shorter search, or clear the filters.'
              : 'Cranes are added to a site: open a customer, then one of its sites.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-field">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Cranes</caption>
            <thead className="border-b border-line bg-sheet text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Asset tag</th>
                <th scope="col" className="px-4 py-3 font-medium">Type</th>
                <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                <th scope="col" className="px-4 py-3 font-medium">Site</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">SWL</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {cranes.map((crane) => (
                <tr key={crane.id} className="hover:bg-sheet">
                  <td className="px-4 py-3">
                    <Link
                      href={`/cranes/${crane.id}`}
                      className="font-medium text-ink underline decoration-line hover:decoration-ink"
                    >
                      {crane.assetTag}
                    </Link>
                    {crane.serialNumber ? (
                      <span className="block text-xs text-muted">S/N {crane.serialNumber}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted">{CRANE_TYPE_LABELS[crane.type]}</td>
                  <td className="px-4 py-3">
                    <Link href={`/customers/${crane.site.customerId}`} className="text-ink underline">
                      {crane.site.customerName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/sites/${crane.site.id}`} className="text-muted underline">
                      {crane.site.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-muted">{crane.swlKg.toLocaleString()} kg</td>
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
