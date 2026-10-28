import type { Metadata } from 'next'
import Link from 'next/link'
import { QuoteStatusBadge } from '@/components/office/quote-badges'
import { cardClass } from '@/components/office/ui'
import { formatDate, formatMoney } from '@/lib/format'
import { QUOTE_STATUSES, QUOTE_STATUS_LABELS } from '@/lib/validation/quotes'
import { requireAuth } from '@/server/auth/context'
import { listQuotes } from '@/server/quotes/quotes'
import { getSettings } from '@/server/settings/settings'

export const metadata: Metadata = { title: 'Quotes — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The quote book (slice 19): what has been offered, what is still waiting for an answer, and what the
 * customer said. Sorted newest first; the filters are the statuses the flow actually has.
 */
export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  const context = await requireAuth()
  const params = await searchParams
  const filters = { q: params.q ?? '', status: params.status ?? '' }

  const [{ quotes, counts }, settings] = await Promise.all([
    listQuotes(context, filters),
    getSettings(),
  ])

  const filtered = Boolean(filters.q || filters.status)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Quotes</h1>
        <p className="mt-1 text-slate-600">
          {counts.SENT} waiting for an answer · {counts.ACCEPTED} accepted · {counts.DRAFT} in draft
          {counts.EXPIRED > 0 ? ` · ${counts.EXPIRED} expired` : ''}.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          A quote prices a job or the findings a report raised. Accepting one moves its job to
          Approved; the PDF is the document you send the customer.
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
            placeholder="Quote number or customer"
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
            {QUOTE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {QUOTE_STATUS_LABELS[status]}
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
          <Link href="/quotes" className="px-2 py-2 text-sm text-slate-600 underline">
            Clear
          </Link>
        ) : null}
      </form>

      {quotes.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-slate-900">
            {filtered ? 'Nothing matches those filters.' : 'No quotes yet.'}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {filtered
              ? 'Try a shorter search, or clear the filters.'
              : 'A quote is raised from a job — open the job and use its Quotes section.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Quotes, newest first</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Quote</th>
                <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                <th scope="col" className="px-4 py-3 font-medium">Job</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Valid until</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quotes.map((quote) => (
                <tr key={quote.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/quotes/${quote.id}`}
                      className="font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                    >
                      {quote.number}
                    </Link>
                    <span className="block text-xs text-slate-500">
                      {formatDate(quote.createdAt, settings.timezone)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-800">{quote.customer.name}</td>
                  <td className="px-4 py-3">
                    {quote.job ? (
                      <Link href={`/jobs/${quote.job.id}`} className="text-slate-700 underline">
                        {quote.job.number}
                      </Link>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <QuoteStatusBadge status={quote.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {quote.validUntil ? formatDate(quote.validUntil, settings.timezone) : 'No expiry'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">
                    {formatMoney(quote.total, settings.currency)}
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
