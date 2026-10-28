import type { Metadata } from 'next'
import Link from 'next/link'
import { InvoiceStatusBadge, OverdueBadge } from '@/components/office/invoice-badges'
import { cardClass } from '@/components/office/ui'
import { formatDate, formatMoney } from '@/lib/format'
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS } from '@/lib/validation/invoices'
import { requireAuth } from '@/server/auth/context'
import { listInvoices } from '@/server/invoices/invoices'
import { getSettings } from '@/server/settings/settings'

export const metadata: Metadata = { title: 'Invoices — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The invoice book (slice 20): what has gone out, what has been paid and what is still owed.
 *
 * This is the screen the dashboard's "Awaiting invoicing" tile links through to, so the two read the
 * same rows and cannot disagree. An invoice is raised from a reviewed job, not from here.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  const context = await requireAuth()
  const params = await searchParams
  const filters = { q: params.q ?? '', status: params.status ?? '' }

  const [{ invoices, counts, outstanding }, settings] = await Promise.all([
    listInvoices(context, filters),
    getSettings(),
  ])

  const filtered = Boolean(filters.q || filters.status)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Invoices</h1>
        <p className="mt-1 text-slate-600">
          {counts.ISSUED + counts.PART_PAID} open · {formatMoney(outstanding, settings.currency)}{' '}
          outstanding
          {counts.PAID > 0 ? ` · ${counts.PAID} paid` : ''}
          {counts.VOID > 0 ? ` · ${counts.VOID} void` : ''}.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          An invoice is raised from a job that has been reviewed. Issuing it snapshots the GST rate,
          gives it a due date from the customer&rsquo;s payment terms and moves the job to Invoiced.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="block text-sm font-medium text-slate-700">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={filters.q}
            placeholder="Invoice number or customer"
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
            defaultValue={filters.status}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          >
            <option value="">Everything</option>
            {INVOICE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {INVOICE_STATUS_LABELS[status]}
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

        {filtered ? (
          <Link href="/invoices" className="px-2 py-2 text-sm text-slate-600 underline">
            Clear
          </Link>
        ) : null}
      </form>

      {invoices.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-slate-900">
            {filtered ? 'Nothing matches those filters.' : 'No invoices yet.'}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {filtered
              ? 'Try a shorter search, or clear the filters.'
              : 'An invoice is raised from a reviewed job — open the job and use its Invoices section.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Invoices, newest first</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Invoice</th>
                <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Due</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                    >
                      {invoice.number}
                    </Link>
                    <span className="block text-xs text-slate-500">
                      {invoice.job ? invoice.job.number : formatDate(invoice.createdAt, settings.timezone)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-800">{invoice.customer.name}</td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap items-center gap-1">
                      <InvoiceStatusBadge status={invoice.status} />
                      {invoice.overdue ? <OverdueBadge /> : null}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {invoice.dueDate ? formatDate(invoice.dueDate, settings.timezone) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-800">
                    {formatMoney(invoice.total, settings.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">
                    {invoice.balance > 0 ? formatMoney(invoice.balance, settings.currency) : '—'}
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
