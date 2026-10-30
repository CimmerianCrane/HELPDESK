import type { Metadata } from 'next'
import Link from 'next/link'
import { cardClass } from '@/components/office/ui'
import { CreateCustomerForm } from '@/components/office/customer-forms'
import { CUSTOMER_STATUSES } from '@/lib/validation/customers'
import { CONTRACT_TYPE_LABELS } from '@/lib/validation/contracts'
import { formatDate } from '@/lib/format'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { listUpcomingRenewals } from '@/server/contracts/contracts'
import { listCustomers } from '@/server/customers/customers'
import { CUSTOMER_STATUS_LABELS } from '@/server/customers/labels'
import { getSettings } from '@/server/settings/settings'
import { createCustomerAction } from './actions'

export const metadata: Metadata = { title: 'Customers — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  PROSPECT: 'bg-sky-50 text-sky-800 border-sky-200',
  DORMANT: 'bg-slate-100 text-slate-600 border-slate-200',
}

/** Reads a count out of the URL, or null if it is absent or not a number. */
function countParam(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; imported?: string; skipped?: string }>
}) {
  const context = await requireAuth()
  const { q, status, imported, skipped } = await searchParams

  // The service validates these again; parsing here only decides what the form shows back.
  const customers = await listCustomers(context, { q: q ?? '', status: status ?? '' })
  // Deliberately ignores the customer filters below: a renewal is a deadline, and hiding an overdue
  // one because the list is filtered to "prospect" would be the one thing this board must not do.
  const renewals = await listUpcomingRenewals(context)
  const settings = await getSettings()
  const mayWrite = can(context.role, 'customer.write')
  const mayImport = can(context.role, 'customer.import')

  // Arrives from the import redirect. Left in the URL so a refresh still tells the truth about what
  // that import did, rather than showing the news once and then pretending it never happened.
  const importedCount = countParam(imported)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Customers</h1>
          <p className="mt-1 text-slate-600">
            {customers.length === 0
              ? 'No customers match that search.'
              : `${customers.length} ${customers.length === 1 ? 'customer' : 'customers'}.`}
          </p>
        </div>

        {mayImport ? (
          <Link
            href="/customers/import"
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Import from CSV
          </Link>
        ) : null}
      </div>

      {importedCount !== null ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          <p>
            Import finished: {importedCount}{' '}
            {importedCount === 1 ? 'customer added' : 'customers added'}
            {countParam(skipped) ? `, ${countParam(skipped)} skipped as already present` : ''}.
          </p>
          <Link href="/customers" className="font-medium underline">
            Dismiss
          </Link>
        </div>
      ) : null}

      {/* The renewal board (slice 30). Above the filters and the list on purpose: what is about to
          lapse is the thing an office reads this page for, and it is the one block unaffected by
          what the customer list is filtered to. */}
      {renewals.length > 0 ? (
        <section className={cardClass} aria-labelledby="renewals-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="renewals-heading" className="font-semibold text-slate-900">
              Contracts renewing
            </h2>
            <p className="text-sm text-slate-500">
              {renewals.filter((row) => row.state === 'overdue').length} overdue,{' '}
              {renewals.filter((row) => row.state === 'due').length} within 90 days.
            </p>
          </div>

          <ul className="mt-4 divide-y divide-slate-100">
            {renewals.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm"
              >
                <span>
                  <Link
                    href={`/customers/${row.customer.id}#contracts`}
                    className="font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                  >
                    {row.customer.legalName}
                  </Link>
                  <span className="text-slate-600">
                    {' · '}
                    {CONTRACT_TYPE_LABELS[row.type]}
                    {row.reference ? ` · ${row.reference}` : ''}
                  </span>
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="text-slate-600">
                    {formatDate(row.renewalDate, settings.timezone)}
                  </span>
                  <span
                    className={
                      row.state === 'overdue'
                        ? 'rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800'
                        : 'rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900'
                    }
                  >
                    {row.state === 'overdue'
                      ? `${Math.abs(row.daysUntil)} ${Math.abs(row.daysUntil) === 1 ? 'day' : 'days'} overdue`
                      : `in ${row.daysUntil} ${row.daysUntil === 1 ? 'day' : 'days'}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* A GET form: filtering is a page state, so the result is a URL that can be bookmarked and
          shared, and it still works with JavaScript not yet loaded. */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="block text-sm font-medium text-slate-700">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Name, trading name or UEN"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          />
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
            {CUSTOMER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {CUSTOMER_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800"
        >
          Filter
        </button>

        {q || status ? (
          <Link href="/customers" className="px-2 py-2 text-sm text-slate-600 underline">
            Clear
          </Link>
        ) : null}
      </form>

      {customers.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-slate-900">
            {q || status ? 'Nothing matches those filters.' : 'No customers yet.'}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {q || status
              ? 'Try a shorter search, or clear the status filter.'
              : mayWrite
                ? 'Add the first one below, or bring in a whole list with “Import from CSV”.'
                : 'A dispatcher or administrator can add them.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Customers</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                <th scope="col" className="px-4 py-3 font-medium">UEN</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Sites</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Contacts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((customer) => (
                <tr key={customer.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                    >
                      {customer.legalName}
                    </Link>
                    {customer.tradingName ? (
                      <span className="block text-xs text-slate-500">{customer.tradingName}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{customer.uen ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[customer.status] ?? ''}`}
                    >
                      {CUSTOMER_STATUS_LABELS[customer.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">{customer.siteCount}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{customer.contactCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mayWrite ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Add a customer</h2>
          <p className="mt-1 mb-5 text-sm text-slate-600">
            Sites, cranes and jobs are added to the customer afterwards.
          </p>
          <CreateCustomerForm action={createCustomerAction} />
        </section>
      ) : (
        <p className="text-sm text-slate-500">
          Your role can view customers but not add or change them.
        </p>
      )}
    </div>
  )
}
