import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  CloseTicketForm,
  EditTicketForm,
  TriageTicketForm,
} from '@/components/office/ticket-forms'
import { PriorityBadge, TicketStatusBadge } from '@/components/office/ticket-badges'
import { cardClass } from '@/components/office/ui'
import { formatDateTime, formatDuration } from '@/lib/format'
import { requireAuth } from '@/server/auth/context'
import { NotFoundError } from '@/server/auth/errors'
import { can } from '@/server/auth/permissions'
import { getSettings } from '@/server/settings/settings'
import { SLA_STATE_LABELS, TICKET_SOURCE_LABELS, TICKET_STATUS_DESCRIPTIONS } from '@/server/tickets/labels'
import { getTicket } from '@/server/tickets/tickets'
import type { SlaResult } from '@/server/sla/sla'
import { closeTicketAction, reopenTicketAction, triageTicketAction, updateTicketAction } from '../actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const context = await requireAuth()
  try {
    const ticket = await getTicket(context, id)
    return { title: `${ticket.number} — Cimmerian Crane Services` }
  } catch (error) {
    if (error instanceof NotFoundError) return { title: 'Ticket — Cimmerian Crane Services' }
    throw error
  }
}

/**
 * The ticket. Everything the office needs to decide what happens next is on this one screen, and
 * everything it has decided so far is visible without opening the audit log.
 *
 * The SLA panel is the point of the screen: a P1 whose response target passed an hour before anyone
 * looked at it should be impossible to miss, whatever else is on the page.
 */
export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await requireAuth()

  let ticket: Awaited<ReturnType<typeof getTicket>>
  try {
    ticket = await getTicket(context, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    throw error
  }

  const settings = await getSettings()
  const mayTriage = can(context.role, 'ticket.triage')
  const isOpen = ticket.status === 'NEW' || ticket.status === 'TRIAGED'
  const isFinished = ticket.status === 'CLOSED' || ticket.status === 'CANCELLED'

  return (
    <div className="space-y-8">
      <div>
        <Link href="/tickets" className="text-sm text-slate-600 underline hover:text-slate-900">
          ← Tickets
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-900">{ticket.number}</h1>
              <PriorityBadge priority={ticket.priority} />
              <TicketStatusBadge status={ticket.status} />
            </div>
            <p className="mt-1 text-slate-600">
              <Link href={`/customers/${ticket.customer.id}`} className="underline hover:text-slate-900">
                {ticket.customer.legalName}
              </Link>
              {ticket.site ? (
                <>
                  {' · '}
                  <Link href={`/sites/${ticket.site.id}`} className="underline hover:text-slate-900">
                    {ticket.site.name}
                  </Link>
                </>
              ) : null}
              {ticket.crane ? (
                <>
                  {' · '}
                  <Link href={`/cranes/${ticket.crane.id}`} className="underline hover:text-slate-900">
                    {ticket.crane.assetTag}
                  </Link>
                </>
              ) : null}
            </p>
          </div>

          <p className="text-sm text-slate-500">
            Reported {formatDateTime(ticket.reportedAt, settings.timezone)} by{' '}
            {TICKET_SOURCE_LABELS[ticket.source as keyof typeof TICKET_SOURCE_LABELS] ?? ticket.source}
          </p>
        </div>
      </div>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Service level</h2>
        <p className="mt-1 text-sm text-slate-600">
          Both clocks start when the ticket was reported, not when it was triaged. Minutes are
          calendar minutes, so a call at 23:50 has the full target overnight.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <SlaPanel
            label="Response"
            targetMinutes={ticket.sla.targets.responseMinutes}
            sla={ticket.sla.response}
            metAt={ticket.respondedAt}
            timeZone={settings.timezone}
            explanation="Time to the office deciding what to do about it."
          />
          <SlaPanel
            label="Resolution"
            targetMinutes={ticket.sla.targets.resolutionMinutes}
            sla={ticket.sla.resolution}
            metAt={ticket.closedAt}
            timeZone={settings.timezone}
            explanation="Time to the ticket being finished — jobs carry the work after that."
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className={`${cardClass} lg:col-span-2`}>
          <h2 className="font-semibold text-slate-900">What was reported</h2>
          <p className="mt-3 whitespace-pre-wrap text-slate-900">{ticket.description}</p>

          <h3 className="mt-6 text-xs font-medium tracking-wide text-slate-500 uppercase">
            Triage notes
          </h3>
          <p className="mt-1 whitespace-pre-wrap text-slate-700">
            {ticket.triageNotes ?? 'Nothing written yet.'}
          </p>

          <p className="mt-4 text-sm text-slate-500">{TICKET_STATUS_DESCRIPTIONS[ticket.status]}</p>
        </section>

        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">History</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Reported</dt>
              <dd className="text-slate-900">{formatDateTime(ticket.reportedAt, settings.timezone)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Triaged</dt>
              <dd className="text-slate-900">
                {ticket.respondedAt
                  ? formatDateTime(ticket.respondedAt, settings.timezone)
                  : 'Not yet'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Finished</dt>
              <dd className="text-slate-900">
                {ticket.closedAt ? formatDateTime(ticket.closedAt, settings.timezone) : 'Not yet'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Jobs</dt>
              <dd className="text-slate-900">
                {ticket.jobCount === 0
                  ? 'None raised yet'
                  : `${ticket.jobCount} ${ticket.jobCount === 1 ? 'job' : 'jobs'}`}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {mayTriage && isOpen ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className={cardClass}>
            <h2 className="font-semibold text-slate-900">Triage</h2>
            <p className="mt-1 mb-5 text-sm text-slate-600">
              Set the priority and write down what happens next. Saving the first triage stamps the
              response time.
            </p>
            <TriageTicketForm
              action={triageTicketAction.bind(null, ticket.id)}
              priority={ticket.priority}
              status={ticket.status}
              triageNotes={ticket.triageNotes}
            />
          </section>

          <section className={cardClass}>
            <h2 className="font-semibold text-slate-900">Finish it</h2>
            <p className="mt-1 mb-5 text-sm text-slate-600">
              For a call that needs no visit, or one that is not going ahead. Work that needs a
              technician becomes a job instead.
            </p>
            <CloseTicketForm action={closeTicketAction.bind(null, ticket.id)} />
          </section>
        </div>
      ) : null}

      {mayTriage ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Correct the record</h2>
          <p className="mt-1 mb-5 text-sm text-slate-600">
            Fix what was written down. Priority is changed through triage, and every edit is in the
            audit log.
          </p>
          <EditTicketForm
            action={updateTicketAction.bind(null, ticket.id)}
            description={ticket.description}
            triageNotes={ticket.triageNotes}
            siteId={ticket.site?.id ?? null}
            craneId={ticket.crane?.id ?? null}
          />
        </section>
      ) : null}

      {mayTriage && isFinished ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Reopen</h2>
          <p className="mt-1 mb-4 text-sm text-slate-600">
            If the fault turned out to be real after all, reopen this ticket rather than raising a
            duplicate — the history stays in one place.
          </p>
          <form action={reopenTicketAction.bind(null, ticket.id)}>
            <button
              type="submit"
              className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
            >
              Reopen ticket
            </button>
          </form>
        </section>
      ) : null}
    </div>
  )
}

function SlaPanel({
  label,
  targetMinutes,
  sla,
  metAt,
  timeZone,
  explanation,
}: {
  label: string
  targetMinutes: number
  sla: SlaResult
  metAt: Date | null
  timeZone: string
  explanation: string
}) {
  const overdueMs =
    sla.state === 'breached' && sla.elapsedMs !== null && sla.elapsedMs < 0 ? -sla.elapsedMs : 0

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p
        className={
          sla.state === 'breached'
            ? 'mt-1 text-lg font-semibold text-red-700'
            : sla.state === 'at-risk'
              ? 'mt-1 text-lg font-semibold text-amber-800'
              : 'mt-1 text-lg font-semibold text-slate-900'
        }
      >
        {SLA_STATE_LABELS[sla.state]}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        Target {formatDuration(targetMinutes * 60_000)}
        {sla.dueAt ? <> · due {formatDateTime(sla.dueAt, timeZone)}</> : null}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        {sla.state === 'met' && metAt ? (
          <>Answered {formatDateTime(metAt, timeZone)}</>
        ) : sla.state === 'breached' ? (
          overdueMs > 0 ? (
            <>Overdue by {formatDuration(overdueMs)}</>
          ) : (
            <>The target has passed and nothing has been recorded.</>
          )
        ) : sla.remainingMs !== null ? (
          <>{formatDuration(sla.remainingMs)} left</>
        ) : (
          'No clock running.'
        )}
      </p>
      <p className="mt-2 text-xs text-slate-500">{explanation}</p>
    </div>
  )
}
