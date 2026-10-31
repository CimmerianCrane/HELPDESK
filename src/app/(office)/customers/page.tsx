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
  ACTIVE: 'bg-pos/10 text-pos border-pos/40',
  PROSPECT: 'bg-info/10 text-info border-info/40',
  DORMANT: 'bg-raised text-muted border-line',
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
          <h1 className="text-title font-semibold text-ink">Customers</h1>
          <p className="mt-1 text-muted">
            {customers.length === 0
              ? 'No customers match that search.'
              : `${customers.length} ${customers.length === 1 ? 'customer' : 'customers'}.`}
          </p>
        </div>

        {mayImport ? (
          <Link
            href="/customers/import"
            className="rounded-md border border-line bg-field px-4 py-2 text-sm font-medium text-ink hover:bg-raised"
          >
            Import from CSV
          </Link>
        ) : null}
      </div>

      {importedCount !== null ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-pos/40 bg-pos/10 px-4 py-3 text-sm text-pos"
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
            <h2 id="renewals-heading" className="font-semibold text-ink">
              Contracts renewing
            </h2>
            <p className="text-sm text-muted">
              {renewals.filter((row) => row.state === 'overdue').length} overdue,{' '}
              {renewals.filter((row) => row.state === 'due').length} within 90 days.
            </p>
          </div>

          <ul className="mt-4 divide-y divide-rule">
            {renewals.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm"
              >
                <span>
                  <Link
                    href={`/customers/${row.customer.id}#contracts`}
                    className="font-medium text-ink underline decoration-line hover:decoration-ink"
                  >
                    {row.customer.legalName}
                  </Link>
                  <span className="text-muted">
                    {' · '}
                    {CONTRACT_TYPE_LABELS[row.type]}
                    {row.reference ? ` · ${row.reference}` : ''}
                  </span>
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="text-muted">
                    {formatDate(row.renewalDate, settings.timezone)}
                  </span>
                  <span
                    className={
                      row.state === 'overdue'
                        ? 'rounded border border-neg/40 bg-neg/10 px-2 py-0.5 text-xs font-medium text-neg'
                        : 'rounded border border-warn/40 bg-warn/10 px-2 py-0.5 text-xs font-medium text-warn'
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
          <label htmlFor="q" className="block text-sm font-medium text-ink">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Name, trading name or UEN"
            className="mt-1 block w-full rounded-md border border-line bg-field px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
          />
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
            {CUSTOMER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {CUSTOMER_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-anchor-soft"
        >
          Filter
        </button>

        {q || status ? (
          <Link href="/customers" className="px-2 py-2 text-sm text-muted underline">
            Clear
          </Link>
        ) : null}
      </form>

      {customers.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-ink">
            {q || status ? 'Nothing matches those filters.' : 'No customers yet.'}
          </p>
          <p className="mt-1 text-sm text-muted">
            {q || status
              ? 'Try a shorter search, or clear the status filter.'
              : mayWrite
                ? 'Add the first one below, or bring in a whole list with “Import from CSV”.'
                : 'A dispatcher or administrator can add them.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-field">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Customers</caption>
            <thead className="border-b border-line bg-sheet text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                <th scope="col" className="px-4 py-3 font-medium">UEN</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Sites</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Contacts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {customers.map((customer) => (
                <tr key={customer.id} className="hover:bg-sheet">
                  <td className="px-4 py-3">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="font-medium text-ink underline decoration-line hover:decoration-ink"
                    >
                      {customer.legalName}
                    </Link>
                    {customer.tradingName ? (
                      <span className="block text-xs text-muted">{customer.tradingName}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted">{customer.uen ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[customer.status] ?? ''}`}
                    >
                      {CUSTOMER_STATUS_LABELS[customer.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-muted">{customer.siteCount}</td>
                  <td className="px-4 py-3 text-right text-muted">{customer.contactCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mayWrite ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-ink">Add a customer</h2>
          <p className="mt-1 mb-5 text-sm text-muted">
            Sites, cranes and jobs are added to the customer afterwards.
          </p>
          <CreateCustomerForm action={createCustomerAction} />
        </section>
      ) : (
        <p className="text-sm text-muted">
          Your role can view customers but not add or change them.
        </p>
      )}
    </div>
  )
}
