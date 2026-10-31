import type { Metadata } from 'next'
import Link from 'next/link'
import { CreateTicketForm } from '@/components/office/ticket-forms'
import { cardClass } from '@/components/office/ui'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { listTicketIntakeOptions } from '@/server/tickets/tickets'
import { createTicketAction } from '../actions'

export const metadata: Metadata = { title: 'Record a ticket — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * Intake. Designed for the moment someone is on the phone: the customer, the crane if it is known,
 * and what was said. Priority is a first guess; treating it as a decision is what triage is for.
 */
export default async function NewTicketPage() {
  const context = await requireAuth()

  if (!can(context.role, 'ticket.create')) {
    return (
      <div className={`${cardClass} max-w-xl`}>
        <h1 className="font-semibold text-ink">Not available for your role</h1>
        <p className="mt-1 text-sm text-muted">
          A {context.role.toLowerCase()} cannot record tickets. Ask a dispatcher to take the call.
        </p>
        <Link href="/tickets" className="mt-4 inline-block text-sm text-ink underline">
          Back to tickets
        </Link>
      </div>
    )
  }

  // A role that may raise a ticket but may not read the customer list gets nothing here rather than
  // a form with no choices. The scope filter is the single answer to who sees which customers.
  const options = await listTicketIntakeOptions(context)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/tickets" className="text-sm text-muted underline hover:text-ink">
          ← Tickets
        </Link>
        <h1 className="mt-2 text-title font-semibold text-ink">Record a ticket</h1>
        <p className="mt-1 text-muted">
          Write down what the customer says while they are still on the line. The ticket number is
          allocated when it is saved, and the response clock starts from that moment.
        </p>
      </div>

      {options.length === 0 ? (
        <div className={cardClass}>
          <p className="font-medium text-ink">No customers are available to choose from.</p>
          <p className="mt-1 text-sm text-muted">
            {context.role === 'TECHNICIAN'
              ? 'Ask the office to take the details — your role can raise a ticket but not browse the customer list yet. Raising one from a crane you are working on arrives with the technician app.'
              : 'Add a customer first, then a site and crane if the call is about a specific machine.'}
          </p>
          {can(context.role, 'customer.write') ? (
            <Link href="/customers" className="mt-4 inline-block text-sm text-ink underline">
              Go to customers
            </Link>
          ) : null}
        </div>
      ) : (
        <section className={cardClass}>
          <CreateTicketForm action={createTicketAction} options={options} />
        </section>
      )}
    </div>
  )
}
