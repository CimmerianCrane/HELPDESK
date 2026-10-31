'use client'

import { useActionState, useState } from 'react'
import type { Priority, TicketStatus } from '@prisma/client'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import type { TicketIntakeCustomer } from '@/server/tickets/tickets'
import {
  PRIORITY_DESCRIPTIONS,
  PRIORITY_LABELS,
  TICKET_SOURCE_LABELS,
} from '@/server/tickets/labels'
import { TICKET_SOURCES } from '@/lib/validation/tickets'
import {
  FieldError,
  FormMessage,
  buttonClass,
  inputClass,
  labelClass,
  secondaryButtonClass,
} from './ui'

/**
 * Ticket forms. All of them use `useActionState`, so a server-side rejection comes back as a message
 * in place rather than an error page, and `pending` disables the button so a double-click cannot
 * raise two tickets from one phone call.
 *
 * The intake form is a customer → site → crane cascade. It is client-side because the three lists
 * already arrived together; a round trip per selection would be slower than the paper form and is
 * pointless at the size this business runs at.
 */

type FormAction = (state: FormState, formData: FormData) => Promise<FormState>

export function CreateTicketForm({
  action,
  options,
}: {
  action: FormAction
  options: TicketIntakeCustomer[]
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const [customerId, setCustomerId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [craneId, setCraneId] = useState('')

  const customer = options.find((option) => option.id === customerId)
  const sites = customer?.sites ?? []
  const cranes = (siteId ? sites.filter((site) => site.id === siteId) : sites).flatMap((site) =>
    site.cranes.map((crane) => ({ ...crane, siteName: site.name })),
  )

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ticket-customer" className={labelClass}>
            Customer
          </label>
          <select
            id="ticket-customer"
            name="customerId"
            required
            value={customerId}
            onChange={(event) => {
              setCustomerId(event.target.value)
              setSiteId('')
              setCraneId('')
            }}
            className={inputClass}
          >
            <option value="">Choose a customer…</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.tradingName
                  ? `${option.legalName} (${option.tradingName})`
                  : option.legalName}
              </option>
            ))}
          </select>
          <FieldError state={state} name="customerId" />
        </div>

        <div>
          <label htmlFor="ticket-source" className={labelClass}>
            Reported by
          </label>
          <select id="ticket-source" name="source" defaultValue="PHONE" className={inputClass}>
            {TICKET_SOURCES.map((source) => (
              <option key={source} value={source}>
                {TICKET_SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
          <FieldError state={state} name="source" />
        </div>

        <div>
          <label htmlFor="ticket-site" className={labelClass}>
            Site <span className="font-normal text-muted">(optional)</span>
          </label>
          <select
            id="ticket-site"
            name="siteId"
            value={siteId}
            onChange={(event) => {
              setSiteId(event.target.value)
              setCraneId('')
            }}
            disabled={!customer}
            className={inputClass}
          >
            <option value="">Not known yet</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
          <FieldError state={state} name="siteId" />
        </div>

        <div>
          <label htmlFor="ticket-crane" className={labelClass}>
            Crane <span className="font-normal text-muted">(optional)</span>
          </label>
          <select
            id="ticket-crane"
            name="craneId"
            value={craneId}
            onChange={(event) => setCraneId(event.target.value)}
            disabled={!customer}
            className={inputClass}
          >
            <option value="">Not about one crane</option>
            {cranes.map((crane) => (
              <option key={crane.id} value={crane.id}>
                {crane.assetTag}
                {siteId ? '' : ` — ${crane.siteName}`}
                {crane.status === 'RESTRICTED' ? ' (restricted)' : ''}
              </option>
            ))}
          </select>
          <FieldError state={state} name="craneId" />
        </div>
      </div>

      <div>
        <label htmlFor="ticket-description" className={labelClass}>
          What was reported
        </label>
        <textarea
          id="ticket-description"
          name="description"
          rows={4}
          required
          placeholder="In the customer's words. Who reported it, what the crane is doing, whether anyone is at risk."
          className={inputClass}
        />
        <FieldError state={state} name="description" />
      </div>

      <div>
        <label htmlFor="ticket-priority" className={labelClass}>
          Priority
        </label>
        <select
          id="ticket-priority"
          name="priority"
          defaultValue="P3"
          aria-describedby="ticket-priority-help"
          className={inputClass}
        >
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <p id="ticket-priority-help" className="mt-1 text-xs text-muted">
          {PRIORITY_DESCRIPTIONS.P1} A first guess is fine — triage confirms it. A P1 alerts every
          dispatcher as soon as this is saved.
        </p>
        <FieldError state={state} name="priority" />
      </div>

      <div>
        <label htmlFor="ticket-notes" className={labelClass}>
          Notes <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="ticket-notes"
          name="triageNotes"
          rows={2}
          placeholder="Anything the person taking the call knows that the description does not say."
          className={inputClass}
        />
        <FieldError state={state} name="triageNotes" />
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Recording…' : 'Record ticket'}
      </button>
    </form>
  )
}

export function TriageTicketForm({
  action,
  priority: initialPriority,
  status: initialStatus,
  triageNotes: initialNotes,
}: {
  action: FormAction
  priority: Priority
  status: TicketStatus
  triageNotes: string | null
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const [priority, setPriority] = useState<Priority>(initialPriority)

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="triage-priority" className={labelClass}>
            Priority
          </label>
          <select
            id="triage-priority"
            name="priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value as Priority)}
            className={inputClass}
          >
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">{PRIORITY_DESCRIPTIONS[priority]}</p>
          <FieldError state={state} name="priority" />
        </div>

        <div>
          <label htmlFor="triage-status" className={labelClass}>
            Where it stands
          </label>
          <select
            id="triage-status"
            name="status"
            defaultValue={initialStatus === 'NEW' ? 'NEW' : 'TRIAGED'}
            className={inputClass}
          >
            <option value="TRIAGED">Triaged — decided what happens next</option>
            <option value="NEW">Put back in the queue — not decided yet</option>
          </select>
          <FieldError state={state} name="status" />
        </div>
      </div>

      <div>
        <label htmlFor="triage-notes" className={labelClass}>
          Decision and notes
        </label>
        <textarea
          id="triage-notes"
          name="triageNotes"
          rows={3}
          defaultValue={initialNotes ?? ''}
          placeholder="Who is going, roughly when, and anything dispatch needs to know."
          className={inputClass}
        />
        <FieldError state={state} name="triageNotes" />
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : 'Save triage'}
      </button>
    </form>
  )
}

export function EditTicketForm({
  action,
  description: initialDescription,
  triageNotes: initialNotes,
  siteId,
  craneId,
}: {
  action: FormAction
  description: string
  triageNotes: string | null
  siteId: string | null
  craneId: string | null
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      {/* Carried through unchanged: this form corrects the words, and the service re-validates that
          the location still belongs to the customer. Changing the crane is a dispatch decision, not
          a typo fix, and belongs on the job in slice 5. */}
      <input type="hidden" name="siteId" value={siteId ?? ''} />
      <input type="hidden" name="craneId" value={craneId ?? ''} />

      <div>
        <label htmlFor="edit-description" className={labelClass}>
          What was reported
        </label>
        <textarea
          id="edit-description"
          name="description"
          rows={4}
          required
          defaultValue={initialDescription}
          className={inputClass}
        />
        <FieldError state={state} name="description" />
      </div>

      <div>
        <label htmlFor="edit-notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="edit-notes"
          name="triageNotes"
          rows={3}
          defaultValue={initialNotes ?? ''}
          className={inputClass}
        />
        <FieldError state={state} name="triageNotes" />
      </div>

      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  )
}

/**
 * Closing and cancelling are one form because they differ only in the word recorded: both stop the
 * resolution clock and both require the ticket to still be open. The note is optional but the audit
 * log keeps whatever is written.
 */
export function CloseTicketForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const [outcome, setOutcome] = useState<'CLOSED' | 'CANCELLED'>('CLOSED')

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div>
        <label htmlFor="close-outcome" className={labelClass}>
          Outcome
        </label>
        <select
          id="close-outcome"
          name="outcome"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value as 'CLOSED' | 'CANCELLED')}
          className={inputClass}
        >
          <option value="CLOSED">Closed — the call was dealt with</option>
          <option value="CANCELLED">Cancelled — it is not going ahead</option>
        </select>
        <FieldError state={state} name="outcome" />
      </div>

      <div>
        <label htmlFor="close-note" className={labelClass}>
          Note <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="close-note"
          name="note"
          rows={2}
          placeholder={
            outcome === 'CANCELLED'
              ? 'Why it is not going ahead. The next person to read this ticket will want to know.'
              : 'How it was dealt with, if that is not already in the jobs.'
          }
          className={inputClass}
        />
        <FieldError state={state} name="note" />
      </div>

      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        {pending ? 'Saving…' : outcome === 'CANCELLED' ? 'Cancel ticket' : 'Close ticket'}
      </button>
    </form>
  )
}
