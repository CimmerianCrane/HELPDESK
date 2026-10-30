import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cardClass } from '@/components/office/ui'
import { formatDate, formatMoney } from '@/lib/format'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { profitabilityReport, type MarginRow } from '@/server/reports/profitability'
import { getSettings } from '@/server/settings/settings'

export const metadata: Metadata = { title: 'Profitability — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * Profitability (brief §11, slice 32): what was billed, what the parts cost, and the difference —
 * by customer, by contract and by kind of work.
 *
 * The cost column is material only. Labour is sold on the invoice but never costed, so the screen
 * says so rather than showing a margin a manager would read as gross profit.
 */
export default async function ProfitabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const context = await requireAuth()
  if (!can(context.role, 'report.financial')) notFound()

  const params = await searchParams
  const filters = { from: params.from ?? '', to: params.to ?? '' }

  const [report, settings] = await Promise.all([profitabilityReport(context, filters), getSettings()])
  const filtered = Boolean(filters.from || filters.to)
  const money = (value: number) => formatMoney(value, settings.currency)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Profitability</h1>
        <p className="mt-1 text-slate-600">
          {report.invoiceCount} billed {report.invoiceCount === 1 ? 'invoice' : 'invoices'} ·{' '}
          {money(report.totals.revenue)} revenue · {money(report.totals.margin)} margin
          {filtered && report.window.from ? (
            <>
              {' '}
              from {formatDate(report.window.from, settings.timezone)}
              {report.window.to ? ` to ${formatDate(report.window.to, settings.timezone)}` : ''}
            </>
          ) : null}
          .
        </p>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          Revenue is the invoice subtotal excluding GST, on issued, partly paid and paid invoices,
          dated by when the invoice was issued. <strong>Cost is the parts issued on the job</strong> at
          what they cost us — labour is billed but not costed, because no hourly rate is recorded
          against a technician. Rows are sorted by revenue, so the biggest customers and jobs come
          first.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="from" className="block text-sm font-medium text-slate-700">
            Issued from
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={filters.from}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="to" className="block text-sm font-medium text-slate-700">
            Issued to
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={filters.to}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800"
        >
          Apply
        </button>
        {filtered ? (
          <Link href="/reports/profitability" className="px-2 py-2 text-sm text-slate-600 underline">
            Clear
          </Link>
        ) : null}
      </form>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Totals</h2>
        <table className="mt-3 w-full text-left text-sm">
          <caption className="sr-only">Totals for the period</caption>
          <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th scope="col" className="py-2 font-medium">Revenue</th>
              <th scope="col" className="py-2 text-right font-medium">Parts cost</th>
              <th scope="col" className="py-2 text-right font-medium">Margin</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-2 text-slate-900">{money(report.totals.revenue)}</td>
              <td className="py-2 text-right text-slate-800">{money(report.totals.partsCost)}</td>
              <td
                className={`py-2 text-right font-medium ${
                  report.totals.margin < 0 ? 'text-red-700' : 'text-slate-900'
                }`}
              >
                {money(report.totals.margin)}
              </td>
            </tr>
          </tbody>
        </table>
        {report.unattributedRevenue > 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            {money(report.unattributedRevenue)} of that revenue is on invoice lines with no job behind
            them — labour typed straight onto an invoice, or parts re-raised after the link was lost.
            It counts in the totals and against its customer, but in no contract or job type, because
            there is nothing to attribute it to.
          </p>
        ) : null}
      </section>

      <MarginTable
        title="By customer"
        empty="No invoice has been issued yet."
        rows={report.byCustomer}
        money={money}
      />
      <MarginTable
        title="By contract"
        empty="No billed job belongs to a contract yet."
        rows={report.byContract}
        money={money}
      />
      <MarginTable
        title="By job type"
        empty="No billed job has a kind of work yet."
        rows={report.byJobType}
        money={money}
      />
    </div>
  )
}

function MarginTable({
  title,
  empty,
  rows,
  money,
}: {
  title: string
  empty: string
  rows: MarginRow[]
  money: (value: number) => string
}) {
  return (
    <section className={cardClass}>
      <h2 className="font-semibold text-slate-900">{title}</h2>

      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">{empty}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title}, by revenue</caption>
            <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="py-2 font-medium">Name</th>
                <th scope="col" className="py-2 text-right font-medium">Revenue</th>
                <th scope="col" className="py-2 text-right font-medium">Parts cost</th>
                <th scope="col" className="py-2 text-right font-medium">Margin</th>
                <th scope="col" className="py-2 text-right font-medium">Margin %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.key} className="hover:bg-slate-50">
                  <td className="py-2 text-slate-900">{row.label}</td>
                  <td className="py-2 text-right text-slate-800">{money(row.revenue)}</td>
                  <td className="py-2 text-right text-slate-800">{money(row.partsCost)}</td>
                  <td
                    className={`py-2 text-right font-medium ${
                      row.margin < 0 ? 'text-red-700' : 'text-slate-900'
                    }`}
                  >
                    {money(row.margin)}
                  </td>
                  <td className="py-2 text-right text-slate-600">
                    {row.marginRatio === null ? '—' : `${Math.round(row.marginRatio * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
