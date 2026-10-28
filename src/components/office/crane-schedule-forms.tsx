'use client'

import { useActionState } from 'react'
import { SCHEDULE_TYPES, SCHEDULE_TYPE_LABELS } from '@/lib/validation/schedules'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import { FieldError, FormMessage, buttonClass, inputClass, labelClass } from './ui'

/**
 * Forms for a crane's recurring obligations (slice 12).
 *
 * The interval and the next-due date are an either/or: with an interval the service derives the date
 * from the last one done, without one the date is typed. Both fields stay visible and the helper text
 * says which is in charge — a field that vanishes is a field people fill in twice before they trust it.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

export interface ScheduleFormValues {
  id: string
  scheduleType: string
  intervalMonths: number | null
  lastDoneDate: Date | null
  nextDueDate: Date | null
  reminderOffsetsDays: number[]
  autoCreateDraftJob: boolean
  /** The kind of work the daily scan raises when this falls due (slice 15). */
  draftJobTypeId: string | null
  ruleId: string | null
  /** The citation and AE flag as stored, so a rule that has since been superseded is still shown. */
  ruleReference: string | null
  requiresAE: boolean
  notes: string | null
}

export interface CraneOption {
  id: string
  assetTag: string
  siteName: string
}

/** One rule in force for this kind of crane, offered as the basis for a new obligation. */
export interface RuleOption {
  id: string
  scheduleType: string
  intervalMonths: number | null
  requiresAE: boolean
  sourceReference: string
}

/** One kind of work a draft job can be raised as. */
export interface JobTypeOption {
  id: string
  name: string
}

/** `YYYY-MM-DD` for a date input; the stored value is already UTC midnight on the day it means. */
function toDayInput(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : ''
}

function ScheduleFields({
  value,
  crane,
  cranes,
  rules,
  jobTypes,
  state,
  idPrefix,
}: {
  value?: ScheduleFormValues
  crane?: CraneOption
  cranes?: CraneOption[]
  rules?: RuleOption[]
  jobTypes?: JobTypeOption[]
  state: FormState
  idPrefix: string
}) {
  const id = (name: string) => `${idPrefix}-${name}`

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {cranes ? (
        <div className="sm:col-span-2">
          <label htmlFor={id('craneId')} className={labelClass}>
            Crane
          </label>
          <select id={id('craneId')} name="craneId" required className={inputClass} defaultValue="">
            <option value="">Choose a crane…</option>
            {cranes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.assetTag} — {option.siteName}
              </option>
            ))}
          </select>
        </div>
      ) : crane ? (
        <p className="text-sm text-slate-600 sm:col-span-2">
          Obligation for <span className="font-medium text-slate-900">{crane.assetTag}</span>.
        </p>
      ) : null}

      {/* Shown even with no rules in force when the schedule already cites one, so the citation
          stays visible and submitted instead of being dropped by a hidden field. */}
      {rules && (rules.length > 0 || value?.ruleId) ? (
        <div className="sm:col-span-2">
          <label htmlFor={id('ruleId')} className={labelClass}>
            Based on a rule
          </label>
          <select
            id={id('ruleId')}
            name="ruleId"
            defaultValue={value?.ruleId ?? ''}
            className={inputClass}
          >
            <option value="">Not from a rule — set the kind and interval myself</option>
            {rules.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {SCHEDULE_TYPE_LABELS[rule.scheduleType as keyof typeof SCHEDULE_TYPE_LABELS] ??
                  rule.scheduleType}
                {rule.intervalMonths ? ` · every ${rule.intervalMonths} mo` : ''}
                {rule.requiresAE ? ' · AE' : ''} · {rule.sourceReference}
              </option>
            ))}
            {/* A schedule citing a rule that has since been ended keeps its citation. Without this
                option the browser would select the first one and saving would quietly drop it. */}
            {value?.ruleId && !rules.some((rule) => rule.id === value.ruleId) ? (
              <option value={value.ruleId}>
                {SCHEDULE_TYPE_LABELS[
                  value.scheduleType as keyof typeof SCHEDULE_TYPE_LABELS
                ] ?? value.scheduleType}
                {value.intervalMonths ? ` · every ${value.intervalMonths} mo` : ''}
                {value.requiresAE ? ' · AE' : ''} · {value.ruleReference ?? 'the rule this is based on'}{' '}
                (no longer offered)
              </option>
            ) : null}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Adopting a rule copies its kind and interval, and records the reference on this schedule.
            The rule itself is maintained under Compliance.
          </p>
        </div>
      ) : null}

      <div>
        <label htmlFor={id('scheduleType')} className={labelClass}>
          Kind
        </label>
        <select
          id={id('scheduleType')}
          name="scheduleType"
          required
          defaultValue={value?.scheduleType ?? 'MONTHLY_SERVICE'}
          className={inputClass}
        >
          {SCHEDULE_TYPES.map((type) => (
            <option key={type} value={type}>
              {SCHEDULE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={id('intervalMonths')} className={labelClass}>
          Every (months)
        </label>
        <input
          id={id('intervalMonths')}
          name="intervalMonths"
          type="number"
          min={1}
          max={120}
          defaultValue={value?.intervalMonths ?? ''}
          placeholder="Leave blank for a one-off"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('lastDoneDate')} className={labelClass}>
          Last done
        </label>
        <input
          id={id('lastDoneDate')}
          name="lastDoneDate"
          type="date"
          defaultValue={toDayInput(value?.lastDoneDate ?? null)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('nextDueDate')} className={labelClass}>
          Next due
        </label>
        <input
          id={id('nextDueDate')}
          name="nextDueDate"
          type="date"
          defaultValue={toDayInput(value?.nextDueDate ?? null)}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          With an interval, this is worked out from the last done date and whatever is typed here is
          ignored. Without one, type the date.
        </p>
      </div>

      <div>
        <label htmlFor={id('reminderOffsets')} className={labelClass}>
          Remind (days before)
        </label>
        <input
          id={id('reminderOffsets')}
          name="reminderOffsets"
          defaultValue={(value?.reminderOffsetsDays ?? [90, 60, 30]).join(', ')}
          placeholder="90, 60, 30"
          className={inputClass}
        />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor={id('notes')} className={labelClass}>
          Notes
        </label>
        <textarea
          id={id('notes')}
          name="notes"
          rows={2}
          defaultValue={value?.notes ?? ''}
          className={inputClass}
        />
      </div>

      <div className="sm:col-span-2 space-y-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="autoCreateDraftJob"
            defaultChecked={value?.autoCreateDraftJob ?? false}
            className="h-4 w-4 rounded border-slate-300"
          />
          Raise a draft job when this becomes due
        </label>
        {jobTypes ? (
          <div>
            <label htmlFor={id('draftJobTypeId')} className={labelClass}>
              Kind of work to raise
            </label>
            <select
              id={id('draftJobTypeId')}
              name="draftJobTypeId"
              defaultValue={value?.draftJobTypeId ?? ''}
              className={inputClass}
            >
              <option value="">Nothing — remind us only</option>
              {jobTypes.map((jobType) => (
                <option key={jobType.id} value={jobType.id}>
                  {jobType.name}
                </option>
              ))}
            </select>
            <FieldError state={state} name="draftJobTypeId" />
          </div>
        ) : null}
        <p className="text-xs text-slate-500">
          The daily reminder run emails the office at the offsets above. A draft job is raised only on
          the day it is due, in the kind of work chosen here.
        </p>
      </div>
    </div>
  )
}

export function ScheduleForm({
  action,
  value,
  crane,
  cranes,
  rules,
  jobTypes,
  submitLabel,
  idPrefix,
}: {
  action: ServerAction
  value?: ScheduleFormValues
  crane?: CraneOption
  cranes?: CraneOption[]
  rules?: RuleOption[]
  jobTypes?: JobTypeOption[]
  submitLabel: string
  idPrefix: string
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-5">
      <ScheduleFields
        value={value}
        crane={crane}
        cranes={cranes}
        rules={rules}
        jobTypes={jobTypes}
        state={state}
        idPrefix={idPrefix}
      />
      <FormMessage state={state} />
      {/* A rule that spans two fields (interval versus a typed date) is reported against the form. */}
      <FieldError state={state} name="_form" />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

export function ArchiveScheduleButton({
  action,
  label,
}: {
  action: ServerAction
  label: string
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
      >
        {pending ? 'Ending…' : `End — ${label}`}
      </button>
      <p className="text-xs text-slate-500">
        Ends the obligation. The record and its audit trail stay, so a past reminder or job can still
        say what was due.
      </p>
      <FormMessage state={state} />
    </form>
  )
}
