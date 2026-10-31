import type { Metadata } from 'next'
import Link from 'next/link'
import { PriorityBadge, SlaBadge, TicketStatusBadge } from '@/components/office/ticket-badges'
import { cardClass } from '@/components/office/ui'
import { formatDateTime } from '@/lib/format'
import { PRIORITIES, TICKET_STATUSES } from '@/lib/validation/tickets'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { getSettings } from '@/server/settings/settings'
import { listTickets, openTicketStats } from '@/server/tickets/tickets'
import {
  PRIORITY_SHORT_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_DESCRIPTIONS,
} from '@/server/tickets/labels'

export const metadata: Metadata = { title: 'Tickets — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The intake board: everything that came in by phone, email or WhatsApp, newest problems first.
 *
 * The order is the order a dispatcher works down — unanswered before answered, then most urgent,
 * then oldest. A ticket that has been converted to jobs stays visible as the record of the call, but
 * it does not clutter the top of the list.
 */
export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; priority?: string }>
}) {
  const context = await requireAuth()
  const { q, status, priority } = await searchParams

  const [tickets, stats, settings] = await Promise.all([
    listTickets(context, { q: q ?? '', status: status ?? '', priority: priority ?? '' }),
    openTicketStats(context),
    getSettings(),
  ])

  const mayCreate = can(context.role, 'ticket.create')
  const mayTriage = can(context.role, 'ticket.triage')
  const filtered = Boolean(q || status || priority)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-title font-semibold text-ink">Tickets</h1>
          <p className="mt-1 text-muted">
            {mayTriage
              ? 'What came in, and what the office decided to do about it.'
              : 'Tickets you have raised with the office.'}
          </p>
        </div>

        {mayCreate ? (
          <Link
            href="/tickets/new"
            className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-anchor-soft"
          >
            Record a ticket
          </Link>
        ) : null}
      </div>

      {mayTriage ? (
        <dl className="grid gap-4 sm:grid-cols-3">
          <div className={`${cardClass} py-4`}>
            <dt className="text-xs font-medium text-muted">Open</dt>
            <dd className="mt-1 text-2xl font-semibold text-ink">{stats.open}</dd>
          </div>
          <div className={`${cardClass} py-4`}>
            <dt className="text-xs font-medium text-muted">
              Past response target
            </dt>
            <dd
              className={
                stats.breached > 0
                  ? 'mt-1 text-2xl font-semibold text-neg'
                  : 'mt-1 text-2xl font-semibold text-ink'
              }
            >
              {stats.breached}
            </dd>
          </div>
          <div className={`${cardClass} py-4`}>
            <dt className="text-xs font-medium text-muted">
              P1 open
            </dt>
            <dd
              className={
                stats.p1Open > 0
                  ? 'mt-1 text-2xl font-semibold text-neg'
                  : 'mt-1 text-2xl font-semibold text-ink'
              }
            >
              {stats.p1Open}
            </dd>
          </div>
        </dl>
      ) : null}

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="block text-sm font-medium text-ink">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Ticket number, description, customer or asset tag"
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
            {TICKET_STATUSES.map((value) => (
              <option key={value} value={value}>
                {TICKET_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="priority" className="block text-sm font-medium text-ink">
            Priority
          </label>
          <select
            id="priority"
            name="priority"
            defaultValue={priority ?? ''}
            className="mt-1 block rounded-md border border-line bg-field px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
          >
            <option value="">All</option>
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {PRIORITY_SHORT_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-anchor-soft">
          Filter
        </button>

        {filtered ? (
          <Link href="/tickets" className="px-2 py-2 text-sm text-muted underline">
            Clear
          </Link>
        ) : null}
      </form>

      {tickets.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-ink">
            {filtered ? 'Nothing matches those filters.' : 'No tickets yet.'}
          </p>
          <p className="mt-1 text-sm text-muted">
            {filtered
              ? 'Try a shorter search, or clear the filters.'
              : mayCreate
                ? 'Record the first one with “Record a ticket” — it takes less time than the phone call.'
                : 'When you raise a fault, it appears here so you can see the office has it.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-field">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Tickets</caption>
            <thead className="border-b border-line bg-sheet text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Ticket</th>
                <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                <th scope="col" className="px-4 py-3 font-medium">Crane</th>
                <th scope="col" className="px-4 py-3 font-medium">Priority</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Response</th>
                <th scope="col" className="px-4 py-3 font-medium">Reported</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="align-top hover:bg-sheet">
                  <td className="px-4 py-3">
                    <Link
                      href={`/tickets/${ticket.id}`}
                      className="font-medium text-ink underline decoration-line hover:decoration-ink"
                    >
                      {ticket.number}
                    </Link>
                    <span className="mt-0.5 block max-w-xs truncate text-xs text-muted">
                      {ticket.description}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/customers/${ticket.customer.id}`} className="text-ink underline">
                      {ticket.customer.tradingName ?? ticket.customer.legalName}
                    </Link>
                    {ticket.site ? (
                      <span className="block text-xs text-muted">{ticket.site.name}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {ticket.crane ? (
                      <Link href={`/cranes/${ticket.crane.id}`} className="underline">
                        {ticket.crane.assetTag}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <PriorityBadge priority={ticket.priority} />
                  </td>
                  <td className="px-4 py-3">
                    <TicketStatusBadge status={ticket.status} />
                  </td>
                  <td className="px-4 py-3">
                    <SlaBadge label="Response" sla={ticket.sla.response} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted">
                    {formatDateTime(ticket.reportedAt, settings.timezone)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted">
        {TICKET_STATUS_DESCRIPTIONS.NEW} {TICKET_STATUS_DESCRIPTIONS.TRIAGED}
      </p>
    </div>
  )
}
