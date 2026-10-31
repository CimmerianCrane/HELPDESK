'use client'

import { useActionState, useState } from 'react'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import {
  FieldError,
  FormMessage,
  buttonClass,
  inputClass,
  labelClass,
  secondaryButtonClass,
} from './ui'

/**
 * Schedule forms. Every one of them is reachable without a drag, because the board is the fast path
 * and these are the reliable one — a keyboard, a phone, a stylus, or a dispatcher who wants to see
 * the exact times before committing.
 *
 * The override checkbox is not a "force" button: the service refuses the assignment unless the
 * caller also writes down why, and that pair is what the audit trail keeps. The form asks for the
 * reason in the same breath so nobody has to discover that rule by failing.
 */

type FormAction = (state: FormState, formData: FormData) => Promise<FormState>

/** What a select needs from a technician. Competencies are optional so leave forms can omit them. */
export interface TechnicianOption {
  id: string
  name: string
  isActive: boolean
  competencies?: Array<{ name: string; expired: boolean }>
}

/** Technician options with their current competencies, so the dispatcher can see who is qualified. */
export function TechnicianSelect({
  id,
  name,
  technicians,
  defaultValue,
  required = true,
  label = 'Technician',
}: {
  id: string
  name: string
  technicians: TechnicianOption[]
  defaultValue?: string
  required?: boolean
  label?: string
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select
        id={id}
        name={name}
        required={required}
        defaultValue={defaultValue ?? ''}
        className={inputClass}
      >
        {required ? <option value="">Choose…</option> : <option value="">Nobody</option>}
        {technicians.map((technician) => (
          <option key={technician.id} value={technician.id} disabled={!technician.isActive}>
            {technician.name}
            {technician.isActive ? '' : ' (inactive)'}
            {technician.competencies && technician.competencies.length > 0
              ? ` — ${technician.competencies
                  .map((entry) => (entry.expired ? `${entry.name} (expired)` : entry.name))
                  .join(', ')}`
              : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

export function AssignTechnicianForm({
  action,
  technicians,
}: {
  action: FormAction
  technicians: TechnicianOption[]
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const [overriding, setOverriding] = useState(false)

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <TechnicianSelect id="assign-technician" name="technicianId" technicians={technicians} />
      <FieldError state={state} name="technicianId" />

      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="isLead" className="h-4 w-4 rounded border-line" />
        <span>
          Lead — the person the dispatch is addressed to
          <span className="block text-xs text-muted">
            The first person assigned becomes lead automatically.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="override"
          checked={overriding}
          onChange={(event) => setOverriding(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-line"
        />
        <span>
          Go ahead despite a clash
          <span className="block text-xs text-muted">
            Leave counts, and being on another job at the same time. A missing or expired competency
            is never overridable here.
          </span>
        </span>
      </label>

      {overriding ? (
        <div>
          <label htmlFor="assign-reason" className={labelClass}>
            Why
          </label>
          <input
            id="assign-reason"
            name="overrideReason"
            required
            maxLength={500}
            className={inputClass}
            placeholder="Kept on the audit trail with your name against it."
          />
          <FieldError state={state} name="overrideReason" />
        </div>
      ) : null}

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Assigning…' : 'Assign'}
      </button>
    </form>
  )
}

export function UnassignTechnicianForm({
  action,
  technicians,
}: {
  action: FormAction
  technicians: Array<{ technicianId: string; name: string; isLead: boolean }>
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  if (technicians.length === 0) {
    return <p className="text-sm text-muted">Nobody is assigned to this job.</p>
  }

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />
      <div>
        <label htmlFor="unassign-technician" className={labelClass}>
          Take somebody off
        </label>
        <select id="unassign-technician" name="technicianId" required className={inputClass}>
          <option value="">Choose…</option>
          {technicians.map((entry) => (
            <option key={entry.technicianId} value={entry.technicianId}>
              {entry.name}
              {entry.isLead ? ' (lead)' : ''}
            </option>
          ))}
        </select>
        <FieldError state={state} name="technicianId" />
      </div>
      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        {pending ? 'Saving…' : 'Take off the job'}
      </button>
    </form>
  )
}

/**
 * Moving a visit. The two fields are wall clock in the operating timezone — the same thing the
 * dispatcher would say out loud — and the service converts them. The form says which zone that is,
 * because a `datetime-local` input cannot.
 */
export function RescheduleJobForm({
  action,
  timezone,
  defaultStart,
  defaultEnd,
}: {
  action: FormAction
  timezone: string
  defaultStart: string
  defaultEnd: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const [confirming, setConfirming] = useState(false)

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="reschedule-start" className={labelClass}>
            Starts
          </label>
          <input
            id="reschedule-start"
            name="scheduledStart"
            type="datetime-local"
            required
            defaultValue={defaultStart}
            className={inputClass}
          />
          <FieldError state={state} name="scheduledStart" />
        </div>
        <div>
          <label htmlFor="reschedule-end" className={labelClass}>
            Ends
          </label>
          <input
            id="reschedule-end"
            name="scheduledEnd"
            type="datetime-local"
            required
            defaultValue={defaultEnd}
            className={inputClass}
          />
          <FieldError state={state} name="scheduledEnd" />
        </div>
      </div>
      <p className="text-xs text-muted">Times are in {timezone}.</p>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="confirm"
          checked={confirming}
          onChange={(event) => setConfirming(event.target.checked)}
          className="h-4 w-4 rounded border-line"
        />
        Move it even if somebody is already booked then
      </label>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Moving…' : 'Move the visit'}
      </button>
    </form>
  )
}

/**
 * A priority bump. The list is the undated or unplaced work — the point of a bump is to make room
 * for something that has nowhere to go. The reason is required, by the schema and by the database.
 */
export function BumpJobForm({
  action,
  candidates,
}: {
  action: FormAction
  candidates: Array<{ id: string; number: string; priority: string; customerName: string }>
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div>
        <label htmlFor="bump-incoming" className={labelClass}>
          Make room for
        </label>
        <select id="bump-incoming" name="incomingJobId" required className={inputClass}>
          <option value="">Choose…</option>
          {candidates.map((job) => (
            <option key={job.id} value={job.id}>
              {job.number} — {job.customerName} ({job.priority})
            </option>
          ))}
        </select>
        <FieldError state={state} name="incomingJobId" />
      </div>

      <div>
        <label htmlFor="bump-reason" className={labelClass}>
          Why this visit gives way
        </label>
        <textarea
          id="bump-reason"
          name="reason"
          rows={2}
          required
          maxLength={500}
          className={inputClass}
          placeholder="The customer was already told this date. Say what changed."
        />
        <FieldError state={state} name="reason" />
      </div>

      <p className="text-xs text-muted">
        The displaced job goes back to Approved with its dates cleared. This does not place the other
        job — free the slot, then schedule into it.
      </p>

      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        {pending ? 'Displacing…' : 'Displace this visit'}
      </button>
    </form>
  )
}

export function LeaveForm({
  action,
  technicians,
}: {
  action: FormAction
  technicians: TechnicianOption[]
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <TechnicianSelect id="leave-technician" name="technicianId" technicians={technicians} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="leave-start" className={labelClass}>
            From
          </label>
          <input
            id="leave-start"
            name="startAt"
            type="datetime-local"
            required
            className={inputClass}
          />
          <FieldError state={state} name="startAt" />
        </div>
        <div>
          <label htmlFor="leave-end" className={labelClass}>
            Until
          </label>
          <input id="leave-end" name="endAt" type="datetime-local" required className={inputClass} />
          <FieldError state={state} name="endAt" />
        </div>
      </div>

      <div>
        <label htmlFor="leave-reason" className={labelClass}>
          Reason <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="leave-reason"
          name="reason"
          maxLength={200}
          className={inputClass}
          placeholder="Annual leave, course, medical…"
        />
        <FieldError state={state} name="reason" />
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Recording…' : 'Record leave'}
      </button>
    </form>
  )
}

export function OnCallForm({
  action,
  technicians,
}: {
  action: FormAction
  technicians: TechnicianOption[]
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <TechnicianSelect id="oncall-technician" name="technicianId" technicians={technicians} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="oncall-start" className={labelClass}>
            From
          </label>
          <input
            id="oncall-start"
            name="startAt"
            type="datetime-local"
            required
            className={inputClass}
          />
          <FieldError state={state} name="startAt" />
        </div>
        <div>
          <label htmlFor="oncall-end" className={labelClass}>
            Until
          </label>
          <input
            id="oncall-end"
            name="endAt"
            type="datetime-local"
            required
            className={inputClass}
          />
          <FieldError state={state} name="endAt" />
        </div>
      </div>

      <div>
        <label htmlFor="oncall-notes" className={labelClass}>
          Notes <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="oncall-notes"
          name="notes"
          maxLength={500}
          className={inputClass}
          placeholder="Mobile number, handover instructions…"
        />
        <FieldError state={state} name="notes" />
      </div>

      <p className="text-xs text-muted">
        Overlapping shifts are allowed on purpose — two people reachable is safer than none.
      </p>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Adding…' : 'Add the shift'}
      </button>
    </form>
  )
}

export function BookResourceForm({
  action,
  resources,
}: {
  action: FormAction
  resources: Array<{ id: string; name: string; type: string; status: string; calibrationOverdue: boolean }>
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const [ownSpan, setOwnSpan] = useState(false)
  const [confirming, setConfirming] = useState(false)

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div>
        <label htmlFor="book-resource" className={labelClass}>
          Resource
        </label>
        <select id="book-resource" name="resourceId" required className={inputClass}>
          <option value="">Choose…</option>
          {resources.map((resource) => (
            <option key={resource.id} value={resource.id} disabled={resource.status === 'RETIRED'}>
              {resource.name} — {resource.type.toLowerCase().replace('_', ' ')}
              {resource.status === 'RETIRED'
                ? ' (retired)'
                : resource.status === 'MAINTENANCE'
                  ? ' (maintenance)'
                  : ''}
              {resource.calibrationOverdue ? ' — calibration overdue' : ''}
            </option>
          ))}
        </select>
        <FieldError state={state} name="resourceId" />
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={ownSpan}
          onChange={(event) => setOwnSpan(event.target.checked)}
          className="h-4 w-4 rounded border-line"
        />
        Book it for a different span than the visit
      </label>

      {ownSpan ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="book-start" className={labelClass}>
              From
            </label>
            <input id="book-start" name="startAt" type="datetime-local" className={inputClass} />
            <FieldError state={state} name="startAt" />
          </div>
          <div>
            <label htmlFor="book-end" className={labelClass}>
              Until
            </label>
            <input id="book-end" name="endAt" type="datetime-local" className={inputClass} />
            <FieldError state={state} name="endAt" />
          </div>
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={confirming}
          onChange={(event) => setConfirming(event.target.checked)}
          className="h-4 w-4 rounded border-line"
        />
        Book it even if it is overdue for calibration or already out
      </label>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Booking…' : 'Book'}
      </button>
    </form>
  )
}

/** A single-button action: delete a leave entry, release a resource, dispatch a job. */
export function ActionButton({
  action,
  children,
  pendingLabel,
  variant = 'secondary',
}: {
  action: () => Promise<void>
  children: React.ReactNode
  pendingLabel?: string
  variant?: 'primary' | 'secondary'
}) {
  return (
    <form action={action}>
      <button
        type="submit"
        className={variant === 'primary' ? buttonClass : secondaryButtonClass}
      >
        {pendingLabel ?? children}
      </button>
    </form>
  )
}
