import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { QuoteStatusBadge } from '@/components/office/quote-badges'
import { QuoteDecisionForm, QuoteForm } from '@/components/office/quote-forms'
import { cardClass } from '@/components/office/ui'
import { formatDate, formatMoney } from '@/lib/format'
import { requireAuth } from '@/server/auth/context'
import { NotFoundError } from '@/server/auth/errors'
import { can } from '@/server/auth/permissions'
import { getQuote } from '@/server/quotes/quotes'
import { getSettings } from '@/server/settings/settings'
import { transitionQuoteAction, updateQuoteAction } from '../actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const context = await requireAuth()
  try {
    const quote = await getQuote(context, id)
    return { title: `${quote.number} — Cimmerian Crane Services` }
  } catch (error) {
    if (error instanceof NotFoundError) return { title: 'Quote — Cimmerian Crane Services' }
    throw error
  }
}

/**
 * One quote (slice 19): what was offered, what it comes to, and the decision.
 *
 * A draft can be edited; sending it is a deliberate step because it fixes the numbers. After that the
 * only moves are the customer's answer (accepted / declined) or the passage of the validity date,
 * which the page reads as Expired without anything running.
 */
export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await requireAuth()
  const settings = await getSettings()

  const quote = await getQuote(context, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()
    throw error
  })

  const mayWrite = can(context.role, 'quote.write')
  const canEdit = mayWrite && quote.status === 'DRAFT'
  const canDecide = mayWrite && quote.status === 'SENT'

  return (
    <div className="space-y-6">
      <div>
        <Link href="/quotes" className="text-sm text-slate-600 underline">
          All quotes
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">{quote.number}</h1>
          <QuoteStatusBadge status={quote.status} />
          <a
            href={`/api/quotes/${quote.id}/pdf`}
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            Download the PDF
          </a>
        </div>
        <p className="mt-1 text-slate-600">
          {quote.customer.name}
          {' · '}
          {quote.job ? (
            <Link href={`/jobs/${quote.job.id}`} className="underline">
              {quote.job.number}
            </Link>
          ) : (
            'No job'
          )}
          {' · '}quoted {formatDate(quote.createdAt, settings.timezone)}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {quote.validUntil
            ? `Valid until ${formatDate(quote.validUntil, settings.timezone)}`
            : 'No expiry date'}
          {quote.expired ? ' — expired, so it can no longer be accepted.' : ''}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className={`${cardClass} lg:col-span-2`}>
          <h2 className="font-semibold text-slate-900">Lines</h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-1 font-medium">Description</th>
                <th className="py-1 font-medium">Qty</th>
                <th className="py-1 font-medium">Unit price</th>
                <th className="py-1 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((line) => (
                <tr key={line.id} className="border-t border-slate-100">
                  <td className="py-1 text-slate-800">
                    {line.description}
                    {line.isVariation ? (
                      <span className="ml-2 rounded border border-indigo-300 bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-800">
                        Variation
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 text-slate-800">{line.quantity}</td>
                  <td className="py-1 text-slate-800">
                    {formatMoney(line.unitPrice, settings.currency)}
                  </td>
                  <td className="py-1 text-slate-800">
                    {formatMoney(line.lineTotal, settings.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-600">Subtotal</dt>
              <dd className="text-slate-900">{formatMoney(quote.subtotal, settings.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">
                GST ({Math.round(quote.gstRate * 10000) / 100}%)
              </dt>
              <dd className="text-slate-900">{formatMoney(quote.gstAmount, settings.currency)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
              <dt>Total</dt>
              <dd>{formatMoney(quote.total, settings.currency)}</dd>
            </div>
          </dl>

          {quote.notes ? (
            <div className="mt-4 border-t border-slate-200 pt-3">
              <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">Notes</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{quote.notes}</p>
            </div>
          ) : null}
        </section>

        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">What happens next</h2>

          {quote.status === 'DRAFT' ? (
            <>
              <p className="mt-2 text-sm text-slate-600">
                Check the lines, then send it. Sending fixes the numbers and puts the job into Quoted.
              </p>
              {mayWrite ? (
                <div className="mt-3">
                  <QuoteDecisionForm
                    action={transitionQuoteAction.bind(null, quote.id)}
                    status="SENT"
                    label="Send to the customer"
                    primary
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {quote.status === 'SENT' ? (
            <>
              <p className="mt-2 text-sm text-slate-600">
                Record the customer&rsquo;s answer. Accepting moves the job to Approved.
              </p>
              {canDecide ? (
                <div className="mt-3 space-y-3">
                  <QuoteDecisionForm
                    action={transitionQuoteAction.bind(null, quote.id)}
                    status="ACCEPTED"
                    label="Accepted"
                    withNote
                    primary
                  />
                  <QuoteDecisionForm
                    action={transitionQuoteAction.bind(null, quote.id)}
                    status="DECLINED"
                    label="Declined"
                    withNote
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {quote.status === 'ACCEPTED' ? (
            <p className="mt-2 text-sm text-slate-600">
              Accepted. The job is approved; raise the work when it suits the schedule.
            </p>
          ) : null}

          {quote.status === 'DECLINED' ? (
            <p className="mt-2 text-sm text-slate-600">
              Declined by the customer. Raise a new quote if the scope changes.
            </p>
          ) : null}

          {quote.status === 'EXPIRED' ? (
            <p className="mt-2 text-sm text-slate-600">
              This quote lapsed on {formatDate(quote.validUntil, settings.timezone)}. Raise a new one
              if the customer still wants the work.
            </p>
          ) : null}
        </section>
      </div>

      {canEdit ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Edit the draft</h2>
          <p className="mt-1 text-sm text-slate-600">
            Replaces the lines and reprices at the current GST rate. The quote number stays the same.
          </p>
          <div className="mt-4">
            <QuoteForm
              action={updateQuoteAction.bind(null, quote.id)}
              initialLines={quote.lines}
              validUntil={quote.validUntil?.toISOString().slice(0, 10) ?? ''}
              notes={quote.notes ?? ''}
              submitLabel="Save the draft"
            />
          </div>
        </section>
      ) : null}
    </div>
  )
}
