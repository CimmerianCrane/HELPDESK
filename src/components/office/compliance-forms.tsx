'use client'

import { useActionState } from 'react'
import { CRANE_TYPE_LABELS } from '@/lib/cranes/labels'
import { CRANE_TYPES } from '@/lib/validation/cranes'
import { SCHEDULE_TYPES, SCHEDULE_TYPE_LABELS } from '@/lib/validation/schedules'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import { FieldError, FormMessage, buttonClass, inputClass, labelClass } from './ui'

/**
 * The compliance rule forms (slice 14). Nothing in here knows a regulatory fact: every field is typed
 * by the office team, and `sourceReference` and `reviewedAt` are required so each rule carries the
 * paperwork it came from.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

export interface ComplianceRuleFormValues {
  id: string
  craneType: string
  scheduleType: string
  intervalMonths: number | null
  requiresAE: boolean
  isActive: boolean
  effectiveFrom: Date | null
  effectiveTo: Date | null
  sourceReference: string
  reviewedAt: Date | null
  notes: string | null
}

/** `YYYY-MM-DD` for a date input; the stored value is already UTC midnight on the day it means. */
function toDayInput(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : ''
}

function RuleFields({ value, idPrefix }: { value?: ComplianceRuleFormValues; idPrefix: string }) {
  const id = (name: string) => `${idPrefix}-${name}`

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor={id('craneType')} className={labelClass}>
          Kind of crane
        </label>
        <select
          id={id('craneType')}
          name="craneType"
          required
          defaultValue={value?.craneType ?? CRANE_TYPES[0]}
          className={inputClass}
        >
          {CRANE_TYPES.map((type) => (
            <option key={type} value={type}>
              {CRANE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={id('scheduleType')} className={labelClass}>
          Obligation
        </label>
        <select
          id={id('scheduleType')}
          name="scheduleType"
          required
          defaultValue={value?.scheduleType ?? 'ANNUAL_EXAMINATION'}
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
        <label htmlFor={id('sourceReference')} className={labelClass}>
          Source / reference
        </label>
        <input
          id={id('sourceReference')}
          name="sourceReference"
          required
          defaultValue={value?.sourceReference ?? ''}
          placeholder="Circular number, publication date, or who confirmed it"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          Required. This is what a question about a crane is answered with.
        </p>
      </div>

      <div>
        <label htmlFor={id('effectiveFrom')} className={labelClass}>
          Applies from
        </label>
        <input
          id={id('effectiveFrom')}
          name="effectiveFrom"
          type="date"
          defaultValue={toDayInput(value?.effectiveFrom ?? null)}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">Leave both dates blank if it has always applied.</p>
      </div>

      <div>
        <label htmlFor={id('effectiveTo')} className={labelClass}>
          Stops applying
        </label>
        <input
          id={id('effectiveTo')}
          name="effectiveTo"
          type="date"
          defaultValue={toDayInput(value?.effectiveTo ?? null)}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          Inclusive. Give the replaced rule an end date before adding its replacement.
        </p>
      </div>

      <div>
        <label htmlFor={id('reviewedAt')} className={labelClass}>
          Reviewed on
        </label>
        <input
          id={id('reviewedAt')}
          name="reviewedAt"
          type="date"
          required
          defaultValue={toDayInput(value?.reviewedAt ?? null)}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          Required. Saving records you as the reviewer.
        </p>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={value?.isActive ?? true}
            className="h-4 w-4 rounded border-slate-300"
          />
          In force
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="requiresAE"
            defaultChecked={value?.requiresAE ?? false}
            className="h-4 w-4 rounded border-slate-300"
          />
          An Authorised Examiner is required
        </label>
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
    </div>
  )
}

export function ComplianceRuleForm({
  action,
  value,
  submitLabel,
  idPrefix,
}: {
  action: ServerAction
  value?: ComplianceRuleFormValues
  submitLabel: string
  idPrefix: string
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-5">
      <RuleFields value={value} idPrefix={idPrefix} />
      <FormMessage state={state} />
      <FieldError state={state} name="_form" />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
