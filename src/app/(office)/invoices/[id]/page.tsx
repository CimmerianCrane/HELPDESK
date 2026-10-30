import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { InvoiceStatusBadge, OverdueBadge } from '@/components/office/invoice-badges'
import { InvoiceDecisionForm, InvoiceForm, RecordPaymentForm } from '@/components/office/invoice-forms'
import { cardClass } from '@/components/office/ui'
import { formatDate, formatMoney } from '@/lib/format'
import { PAYMENT_METHOD_LABELS, type InvoiceStatusName } from '@/lib/validation/invoices'
import { dayKey } from '@/lib/time'
import { requireAuth } from '@/server/auth/context'
import { NotFoundError } from '@/server/auth/errors'
import { can } from '@/server/auth/permissions'
import { getInvoice, dueLabel } from '@/server/invoices/invoices'
import { getSettings } from '@/server/settings/settings'
import {
  recordPaymentAction,
  transitionInvoiceAction,
  updateInvoiceAction,
} from '../actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const context = await requireAuth()
  try {
    const invoice = await getInvoice(context, id)
    return { title: `${invoice.number} — Cimmerian Crane Services` }
  } catch (error) {
    if (error instanceof NotFoundError) return { title: 'Invoice — Cimmerian Crane Services' }
    throw error
  }
}

/**
 * One invoice (slice 20): the charges, what has been paid, and what is still owed.
 *
 * A draft can be edited and issued; after that the only moves are recording money and, if nothing has
 * been paid, voiding it with a reason. The paid status is never set here — it follows the payments.
 */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await requireAuth()
  const settings = await getSettings()

  const invoice = await getInvoice(context, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()
    throw error
  })

  const mayWrite = can(context.role, 'invoice.write')
  const status: InvoiceStatusName = invoice.status
  const today = dayKey(new Date(), settings.timezone)

  return (
    <div className="space-y-6">
      <div>
        <Link href="/invoices" className="text-sm text-slate-600 underline">
          All invoices
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">{invoice.number}</h1>
          <InvoiceStatusBadge status={invoice.status} />
          {invoice.overdue ? <OverdueBadge /> : null}
          <a
            href={`/api/invoices/${invoice.id}/pdf`}
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            Download the PDF
          </a>
        </div>
        <p className="mt-1 text-slate-600">
          {invoice.customer.name}
          {' · '}
          {invoice.job ? (
            <Link href={`/jobs/${invoice.job.id}`} className="underline">
              {invoice.job.number}
            </Link>
          ) : (
            'No job'
          )}
          {' · '}
          {invoice.issueDate
            ? `issued ${formatDate(invoice.issueDate, settings.timezone)}`
            : `raised ${formatDate(invoice.createdAt, settings.timezone)}`}
        </p>
        <p className="mt-1 text-sm text-slate-600">{dueLabel(invoice, settings.timezone)}</p>
        {invoice.externalRef ? (
          <p className="mt-1 text-sm text-slate-600">
            In the accounting system as {invoice.externalRef}
            {invoice.externalPushedAt
              ? `, pushed ${formatDate(invoice.externalPushedAt, settings.timezone)}`
              : ''}
            .
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className={`${cardClass} lg:col-span-2`}>
          <h2 className="font-semibold text-slate-900">Charges</h2>
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
              {invoice.lines.map((line) => (
                <tr key={line.id} className="border-t border-slate-100">
                  <td className="py-1 text-slate-800">{line.description}</td>
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
              <dd className="text-slate-900">{formatMoney(invoice.subtotal, settings.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">
                GST ({Math.round(invoice.gstRate * 10000) / 100}%)
              </dt>
              <dd className="text-slate-900">{formatMoney(invoice.gstAmount, settings.currency)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
              <dt>Total</dt>
              <dd>{formatMoney(invoice.total, settings.currency)}</dd>
            </div>
            {invoice.amountPaid > 0 ? (
              <>
                <div className="flex justify-between">
                  <dt className="text-slate-600">Paid</dt>
                  <dd className="text-slate-900">
                    {formatMoney(invoice.amountPaid, settings.currency)}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
                  <dt>Balance due</dt>
                  <dd>{formatMoney(invoice.balance, settings.currency)}</dd>
                </div>
              </>
            ) : null}
          </dl>
        </section>

        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">What happens next</h2>

          {status === 'DRAFT' ? (
            <>
              <p className="mt-2 text-sm text-slate-600">
                Check the charges, then issue it. Issuing snapshots the GST rate, sets the due date
                from the customer&rsquo;s terms and moves the job to Invoiced.
              </p>
              {mayWrite ? (
                <div className="mt-3 space-y-3">
                  <InvoiceDecisionForm
                    action={transitionInvoiceAction.bind(null, invoice.id)}
                    status="ISSUED"
                    label="Issue the invoice"
                    primary
                  />
                  <InvoiceDecisionForm
                    action={transitionInvoiceAction.bind(null, invoice.id)}
                    status="VOID"
                    label="Void it"
                    withReason
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {invoice.payable ? (
            <>
              <p className="mt-2 text-sm text-slate-600">
                {formatMoney(invoice.balance, settings.currency)} is still owed. Recording what the
                customer paid updates the status — a part payment reads as partly paid.
              </p>
              {mayWrite ? (
                <div className="mt-3">
                  <RecordPaymentForm
                    action={recordPaymentAction.bind(null, invoice.id)}
                    remaining={invoice.balance}
                    currency={settings.currency}
                    today={today}
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {status === 'PAID' ? (
            <p className="mt-2 text-sm text-slate-600">
              Paid in full. Nothing further is owed on this invoice.
            </p>
          ) : null}

          {status === 'VOID' ? (
            <p className="mt-2 text-sm text-slate-600">
              Voided. The reason is in the audit log; the record stays because a bill is never
              deleted.
            </p>
          ) : null}
        </section>
      </div>

      {invoice.payments.length > 0 ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Payments</h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-1 font-medium">Received</th>
                <th className="py-1 font-medium">Method</th>
                <th className="py-1 font-medium">Reference</th>
                <th className="py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.payments.map((payment) => (
                <tr key={payment.id} className="border-t border-slate-100">
                  <td className="py-1 text-slate-800">
                    {formatDate(payment.paidAt, settings.timezone)}
                  </td>
                  <td className="py-1 text-slate-800">
                    {PAYMENT_METHOD_LABELS[payment.method as keyof typeof PAYMENT_METHOD_LABELS] ??
                      payment.method}
                  </td>
                  <td className="py-1 text-slate-700">{payment.reference ?? '—'}</td>
                  <td className="py-1 text-right text-slate-800">
                    {formatMoney(payment.amount, settings.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {invoice.editable && mayWrite ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Edit the draft</h2>
          <p className="mt-1 text-sm text-slate-600">
            Replaces the charges and reprices at the current GST rate. The invoice number stays the
            same.
          </p>
          <div className="mt-4">
            <InvoiceForm
              action={updateInvoiceAction.bind(null, invoice.id)}
              initialLines={invoice.lines}
              submitLabel="Save the draft"
            />
          </div>
        </section>
      ) : null}
    </div>
  )
}
