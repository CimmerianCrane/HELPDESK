import type { Metadata } from 'next'
import Link from 'next/link'
import { InvoiceStatusBadge, OverdueBadge } from '@/components/office/invoice-badges'
import { PushInvoicesForm } from '@/components/office/invoice-forms'
import { cardClass } from '@/components/office/ui'
import { formatDate, formatMoney } from '@/lib/format'
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS } from '@/lib/validation/invoices'
import { accountingPushEnabled } from '@/server/accounting/push'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { listInvoices } from '@/server/invoices/invoices'
import { getSettings } from '@/server/settings/settings'
import { pushInvoicesAction } from './actions'

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

  const [{ invoices, counts, outstanding, unpushed }, settings] = await Promise.all([
    listInvoices(context, filters),
    getSettings(),
  ])
  const mayWrite = can(context.role, 'invoice.write')
  const pushEnabled = accountingPushEnabled()

  const filtered = Boolean(filters.q || filters.status)
  // The same filters, as the export route reads them (it ignores `what` for the invoices file).
  const exportQuery = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => Boolean(value)) as [string, string][],
  ).toString()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-title font-semibold text-ink">Invoices</h1>
        <p className="mt-1 text-muted">
          {counts.ISSUED + counts.PART_PAID} open · {formatMoney(outstanding, settings.currency)}{' '}
          outstanding
          {counts.PAID > 0 ? ` · ${counts.PAID} paid` : ''}
          {counts.VOID > 0 ? ` · ${counts.VOID} void` : ''}.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          An invoice is raised from a job that has been reviewed. Issuing it snapshots the GST rate,
          gives it a due date from the customer&rsquo;s payment terms and moves the job to Invoiced.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="block text-sm font-medium text-ink">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={filters.q}
            placeholder="Invoice number or customer"
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
            defaultValue={filters.status}
            className="mt-1 block rounded-md border border-line bg-field px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
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
          className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-anchor-soft"
        >
          Filter
        </button>

        {filtered ? (
          <Link href="/invoices" className="px-2 py-2 text-sm text-muted underline">
            Clear
          </Link>
        ) : null}
      </form>

      {/* The export runs the invoice book's own filters, so a filtered screen and its file agree. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-panel p-4 text-sm">
        <div className="flex-1">
          <p className="font-medium text-ink">Accounting export</p>
          <p className="mt-1 text-muted">
            Issued, partly paid and paid invoices only — a draft is still being edited and a void
            invoice is not a bill. Amounts and the GST rate are the ones stored on the invoice.
          </p>
        </div>
        <a
          href={`/invoices/export?${exportQuery}`}
          className="rounded-md border border-line bg-field px-3 py-2 text-ink hover:bg-raised"
        >
          Export invoices CSV
        </a>
        <a
          href={`/invoices/export?${exportQuery}&what=payments`}
          className="rounded-md border border-line bg-field px-3 py-2 text-ink hover:bg-raised"
        >
          Export payments CSV
        </a>
      </div>

      {/* A push is a write against someone else's books, so it is offered only where it can work. */}
      {mayWrite && pushEnabled ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-panel p-4 text-sm">
          <div className="flex-1">
            <p className="font-medium text-ink">Accounting system</p>
            <p className="mt-1 text-muted">
              {unpushed === 0
                ? 'Every billed invoice is already there.'
                : `${unpushed} billed invoice${unpushed === 1 ? '' : 's'} not yet in the accounting system.`}{' '}
              Only issued, partly paid and paid invoices are sent; a bill is marked sent only once the
              system accepts it, so pressing again sends nothing twice.
            </p>
          </div>
          <PushInvoicesForm action={pushInvoicesAction} />
        </div>
      ) : null}

      {invoices.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-ink">
            {filtered ? 'Nothing matches those filters.' : 'No invoices yet.'}
          </p>
          <p className="mt-1 text-sm text-muted">
            {filtered
              ? 'Try a shorter search, or clear the filters.'
              : 'An invoice is raised from a reviewed job — open the job and use its Invoices section.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-field">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Invoices, newest first</caption>
            <thead className="border-b border-line bg-sheet text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Invoice</th>
                <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Due</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="align-top hover:bg-sheet">
                  <td className="px-4 py-3">
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="font-medium text-ink underline decoration-line hover:decoration-ink"
                    >
                      {invoice.number}
                    </Link>
                    <span className="block text-xs text-muted">
                      {invoice.job ? invoice.job.number : formatDate(invoice.createdAt, settings.timezone)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink">{invoice.customer.name}</td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap items-center gap-1">
                      <InvoiceStatusBadge status={invoice.status} />
                      {invoice.overdue ? <OverdueBadge /> : null}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink">
                    {invoice.dueDate ? formatDate(invoice.dueDate, settings.timezone) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-ink">
                    {formatMoney(invoice.total, settings.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-ink">
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
