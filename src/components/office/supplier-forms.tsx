'use client'

import { useActionState } from 'react'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import { FieldError, FormMessage, buttonClass, inputClass, labelClass } from './ui'

/**
 * One supplier (slice 27). Adds and edits: the fields are the same, and `values` is null when adding.
 * Retiring is the "Active" checkbox, the same way a stock location is retired rather than deleted.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

export interface SupplierFormValues {
  id: string
  name: string
  contactName: string | null
  phone: string | null
  email: string | null
  leadTimeDays: number | null
  notes: string | null
  isActive: boolean
}

export function SupplierForm({
  action,
  values,
  submitLabel,
}: {
  action: ServerAction
  values: SupplierFormValues | null
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const id = values?.id ?? 'new'

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-name`} className={labelClass}>
            Name
          </label>
          <input
            id={`${id}-name`}
            name="name"
            required
            maxLength={160}
            defaultValue={values?.name ?? ''}
            placeholder="Sin Heng Lifting Supplies"
            className={inputClass}
          />
          <FieldError state={state} name="name" />
        </div>

        <div>
          <label htmlFor={`${id}-contact`} className={labelClass}>
            Contact
          </label>
          <input
            id={`${id}-contact`}
            name="contactName"
            maxLength={120}
            defaultValue={values?.contactName ?? ''}
            className={inputClass}
          />
          <FieldError state={state} name="contactName" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-phone`} className={labelClass}>
            Phone
          </label>
          <input
            id={`${id}-phone`}
            name="phone"
            maxLength={40}
            defaultValue={values?.phone ?? ''}
            className={inputClass}
          />
          <FieldError state={state} name="phone" />
        </div>

        <div>
          <label htmlFor={`${id}-email`} className={labelClass}>
            Email
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            maxLength={160}
            defaultValue={values?.email ?? ''}
            className={inputClass}
          />
          <FieldError state={state} name="email" />
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-lead`} className={labelClass}>
          Lead time (days)
        </label>
        <input
          id={`${id}-lead`}
          name="leadTimeDays"
          type="number"
          step="1"
          min="0"
          max="365"
          defaultValue={values?.leadTimeDays ?? ''}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          Roughly how long a delivery takes — the reorder screen shows it beside the group.
        </p>
        <FieldError state={state} name="leadTimeDays" />
      </div>

      <div>
        <label htmlFor={`${id}-notes`} className={labelClass}>
          Notes
        </label>
        <textarea
          id={`${id}-notes`}
          name="notes"
          rows={2}
          maxLength={2000}
          defaultValue={values?.notes ?? ''}
          className={inputClass}
        />
        <FieldError state={state} name="notes" />
      </div>

      <div className="flex items-start gap-2">
        <input
          id={`${id}-active`}
          name="isActive"
          type="checkbox"
          defaultChecked={values?.isActive ?? true}
          className="mt-1 size-4 rounded border-slate-300"
        />
        <label htmlFor={`${id}-active`} className="text-sm text-slate-700">
          Active
          <span className="block text-xs text-slate-500">
            A retired supplier keeps its past orders and price history, but no part may prefer it.
          </span>
        </label>
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
