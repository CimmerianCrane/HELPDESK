'use client'

import { useActionState, useState } from 'react'
import type { JobStatus, OnHoldReason, Priority } from '@prisma/client'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import type { JobFormOptions } from '@/server/jobs/jobs'
import { JOB_STATUS_DESCRIPTIONS, JOB_STATUS_LABELS, ON_HOLD_REASON_LABELS } from '@/server/jobs/labels'
import { ON_HOLD_REASONS } from '@/server/jobs/status'
import { PRIORITY_DESCRIPTIONS, PRIORITY_LABELS } from '@/server/tickets/labels'
import { FieldError, FormMessage, buttonClass, inputClass, labelClass, secondaryButtonClass } from './ui'

/**
 * Job forms. The create form is the ticket intake cascade plus the three decisions that make
 * something a job: what kind of work, how urgent, and which cranes.
 *
 * The transition form only offers legal moves, but the rule is enforced in the service — this is a
 * convenience, not the control.
 */

type FormAction = (state: FormState, formData: FormData) => Promise<FormState>

const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABELS) as Array<[Priority, string]>

export function CreateJobForm({
  action,
  options,
}: {
  action: FormAction
  options: JobFormOptions
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const [customerId, setCustomerId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [priority, setPriority] = useState<Priority>('P3')
  const [checkedCranes, setCheckedCranes] = useState<string[]>([])

  const customer = options.customers.find((option) => option.id === customerId)
  const sites = customer?.sites ?? []
  const sitesInScope = siteId ? sites.filter((site) => site.id === siteId) : sites
  const cranes = sitesInScope.flatMap((site) =>
    site.cranes.map((crane) => ({ ...crane, siteName: site.name })),
  )

  const toggleCrane = (id: string) =>
    setCheckedCranes((current) =>
      current.includes(id) ? current.filter((craneId) => craneId !== id) : [...current, id],
    )

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="job-customer" className={labelClass}>
            Customer
          </label>
          <select
            id="job-customer"
            name="customerId"
            required
            value={customerId}
            onChange={(event) => {
              setCustomerId(event.target.value)
              setSiteId('')
              setCheckedCranes([])
            }}
            className={inputClass}
          >
            <option value="">Choose a customer…</option>
            {options.customers.map((option) => (
              <option key={option.id} value={option.id}>
                {option.tradingName ? `${option.legalName} (${option.tradingName})` : option.legalName}
              </option>
            ))}
          </select>
          <FieldError state={state} name="customerId" />
        </div>

        <div>
          <label htmlFor="job-site" className={labelClass}>
            Site
          </label>
          <select
            id="job-site"
            name="siteId"
            value={siteId}
            onChange={(event) => {
              setSiteId(event.target.value)
              setCheckedCranes([])
            }}
            disabled={!customer}
            className={inputClass}
          >
            <option value="">Take it from the cranes</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            A job happens somewhere. Leave this blank and it comes from the first crane chosen.
          </p>
          <FieldError state={state} name="siteId" />
        </div>

        <div>
          <label htmlFor="job-type" className={labelClass}>
            Kind of work
          </label>
          <select id="job-type" name="jobTypeId" required className={inputClass}>
            <option value="">Choose…</option>
            {options.jobTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
          <FieldError state={state} name="jobTypeId" />
        </div>

        <div>
          <label htmlFor="job-priority" className={labelClass}>
            Priority
          </label>
          <select
            id="job-priority"
            name="priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value as Priority)}
            className={inputClass}
          >
            {PRIORITY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">{PRIORITY_DESCRIPTIONS[priority]}</p>
          <FieldError state={state} name="priority" />
        </div>
      </div>

      <fieldset>
        <legend className={labelClass}>Cranes</legend>
        {!customer ? (
          <p className="mt-1 text-sm text-slate-500">Choose a customer first.</p>
        ) : cranes.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">This customer has no cranes on record here.</p>
        ) : (
          <div className="mt-2 grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-2">
            {cranes.map((crane) => (
              <label key={crane.id} className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  name="craneIds"
                  value={crane.id}
                  checked={checkedCranes.includes(crane.id)}
                  onChange={() => toggleCrane(crane.id)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span>
                  {crane.assetTag}
                  {siteId ? '' : <span className="text-slate-500"> — {crane.siteName}</span>}
                  {crane.status === 'RESTRICTED' ? (
                    <span className="text-red-700"> (restricted)</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        )}
        <p className="mt-1 text-xs text-slate-500">
          A job covers cranes at one site. Leave all unticked for work that is not about a particular
          machine — a delivery, say.
        </p>
        <FieldError state={state} name="craneIds" />
      </fieldset>

      <div>
        <label htmlFor="job-description" className={labelClass}>
          What needs doing
        </label>
        <textarea
          id="job-description"
          name="description"
          rows={3}
          placeholder="In enough detail that the technician knows what they are going to."
          className={inputClass}
        />
        <FieldError state={state} name="description" />
      </div>

      <div>
        <label htmlFor="job-notes" className={labelClass}>
          Internal notes <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <textarea
          id="job-notes"
          name="internalNotes"
          rows={2}
          placeholder="Not shown to the customer."
          className={inputClass}
        />
        <FieldError state={state} name="internalNotes" />
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Creating…' : 'Create job'}
      </button>
    </form>
  )
}

/**
 * The transition form. On Hold needs a reason, which is why the reason list only appears when it is
 * chosen — and why the database refuses the row without one even if this form were bypassed.
 */
export function TransitionJobForm({
  action,
  status,
  nextStatuses,
  completionSchedules = [],
  parts = [],
}: {
  action: FormAction
  status: JobStatus
  nextStatuses: readonly JobStatus[]
  /**
   * Schedules on this job's cranes, offered only when moving to Completed (slice 12). Completion is
   * explicit: nothing maps a job type to an obligation — that is the compliance rules' job (slice 14).
   */
  completionSchedules?: Array<{ id: string; label: string; dueLabel: string; overdue: boolean }>
  /** The catalogue, offered only when the hold is "awaiting parts" (slice 28). */
  parts?: Array<{ id: string; partNumber: string; description: string }>
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  // `status` is only the fallback: the caller does not render this form when there is nowhere to go.
  const [target, setTarget] = useState<JobStatus>(nextStatuses[0] ?? status)
  const [holdReason, setHoldReason] = useState<OnHoldReason>('AWAITING_PARTS')

  const goingOnHold = target === 'ON_HOLD'
  const awaitingParts = goingOnHold && holdReason === 'AWAITING_PARTS'
  const completing = target === 'COMPLETED' && completionSchedules.length > 0

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div>
        <label htmlFor="transition-status" className={labelClass}>
          Move to
        </label>
        <select
          id="transition-status"
          name="status"
          value={target}
          onChange={(event) => setTarget(event.target.value as JobStatus)}
          className={inputClass}
        >
          {nextStatuses.map((value) => (
            <option key={value} value={value}>
              {JOB_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">{JOB_STATUS_DESCRIPTIONS[target]}</p>
        <FieldError state={state} name="status" />
      </div>

      {goingOnHold ? (
        <div>
          <label htmlFor="transition-reason" className={labelClass}>
            Why it is on hold
          </label>
          <select
            id="transition-reason"
            name="onHoldReason"
            required
            value={holdReason}
            onChange={(event) => setHoldReason(event.target.value as OnHoldReason)}
            className={inputClass}
          >
            {ON_HOLD_REASONS.map((reason: OnHoldReason) => (
              <option key={reason} value={reason}>
                {ON_HOLD_REASON_LABELS[reason]}
              </option>
            ))}
          </select>
          <FieldError state={state} name="onHoldReason" />
        </div>
      ) : null}

      {awaitingParts && parts.length > 0 ? (
        <div>
          <label htmlFor="transition-part" className={labelClass}>
            Part it is waiting for{' '}
            <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <select id="transition-part" name="onHoldPartId" defaultValue="" className={inputClass}>
            <option value="">Not a particular catalogue part</option>
            {parts.map((part) => (
              <option key={part.id} value={part.id}>
                {part.partNumber} — {part.description}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            The job page then shows what is still on order for it and when it lands.
          </p>
          <FieldError state={state} name="onHoldPartId" />
        </div>
      ) : null}

      {completing ? (
        <fieldset className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">
            Schedules this visit completed
          </legend>
          {completionSchedules.map((schedule) => (
            <label key={schedule.id} className="flex items-start gap-3 text-sm text-slate-800">
              <input
                type="checkbox"
                name="scheduleIds"
                value={schedule.id}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>
                {schedule.label}
                <span className={schedule.overdue ? ' text-red-800' : ' text-slate-500'}>
                  {' — '}
                  {schedule.dueLabel}
                </span>
              </span>
            </label>
          ))}
          <p className="text-xs text-slate-500">
            Recording one marks it done on the day this job completed and moves it on by its interval.
            Leave it clear if this visit did not do that work.
          </p>
          <FieldError state={state} name="scheduleIds" />
        </fieldset>
      ) : null}

      <div>
        <label htmlFor="transition-note" className={labelClass}>
          Note{' '}
          <span className="font-normal text-slate-500">
            {goingOnHold ? '(what is being waited on)' : '(optional)'}
          </span>
        </label>
        <textarea
          id="transition-note"
          name="note"
          rows={2}
          className={inputClass}
          placeholder="Kept on the job's history — the next person to open this will read it."
        />
        <FieldError state={state} name="note" />
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : `Move to ${JOB_STATUS_LABELS[target].toLowerCase()}`}
      </button>
    </form>
  )
}

export function EditJobForm({
  action,
  description: initialDescription,
  internalNotes: initialNotes,
  customerPoRef: initialPo,
}: {
  action: FormAction
  description: string | null
  internalNotes: string | null
  customerPoRef: string | null
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div>
        <label htmlFor="edit-job-description" className={labelClass}>
          What needs doing
        </label>
        <textarea
          id="edit-job-description"
          name="description"
          rows={3}
          defaultValue={initialDescription ?? ''}
          className={inputClass}
        />
        <FieldError state={state} name="description" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="edit-job-notes" className={labelClass}>
            Internal notes
          </label>
          <textarea
            id="edit-job-notes"
            name="internalNotes"
            rows={2}
            defaultValue={initialNotes ?? ''}
            className={inputClass}
          />
          <FieldError state={state} name="internalNotes" />
        </div>

        <div>
          <label htmlFor="edit-job-po" className={labelClass}>
            Customer PO / reference
          </label>
          <input
            id="edit-job-po"
            name="customerPoRef"
            defaultValue={initialPo ?? ''}
            className={inputClass}
          />
          <FieldError state={state} name="customerPoRef" />
        </div>
      </div>

      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  )
}

/**
 * Turning a ticket into jobs. One row is one job, because the same call often produces two: the
 * breakdown visit now, the load test once the crane is running again.
 *
 * The customer, site and cranes come from the ticket and are not editable here; correcting those is
 * done on the ticket before conversion.
 */
export function ConvertTicketForm({
  action,
  jobTypes,
  defaultPriority,
}: {
  action: FormAction
  jobTypes: Array<{ id: string; name: string }>
  defaultPriority: Priority
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const [rows, setRows] = useState([0])

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      {rows.map((row, index) => (
        <fieldset key={row} className="rounded-md border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium text-slate-700">Job {index + 1}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`job-type-${row}`} className={labelClass}>
                Kind of work
              </label>
              <select id={`job-type-${row}`} name="jobTypeId" required className={inputClass}>
                <option value="">Choose…</option>
                {jobTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
              <FieldError state={state} name="jobTypeId" />
            </div>

            <div>
              <label htmlFor={`job-priority-${row}`} className={labelClass}>
                Priority
              </label>
              <select
                id={`job-priority-${row}`}
                name="priority"
                defaultValue={defaultPriority}
                className={inputClass}
              >
                {PRIORITY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <FieldError state={state} name="priority" />
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor={`job-description-${row}`} className={labelClass}>
              What needs doing
            </label>
            <textarea
              id={`job-description-${row}`}
              name="description"
              rows={2}
              className={inputClass}
              placeholder="Optional: the ticket already says what was reported."
            />
            <FieldError state={state} name="description" />
          </div>

          {rows.length > 1 ? (
            <button
              type="button"
              onClick={() => setRows((current) => current.filter((value) => value !== row))}
              className="mt-3 text-sm text-slate-600 underline hover:text-slate-900"
            >
              Remove this job
            </button>
          ) : null}
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Creating…' : `Create ${rows.length === 1 ? 'job' : `${rows.length} jobs`}`}
        </button>
        <button
          type="button"
          onClick={() => setRows((current) => [...current, Math.max(...current) + 1])}
          className={secondaryButtonClass}
        >
          Add another job
        </button>
      </div>
    </form>
  )
}
