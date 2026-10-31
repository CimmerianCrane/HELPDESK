'use client'

import { useActionState } from 'react'
import { FormMessage, buttonClass, inputClass, labelClass } from '@/components/office/ui'
import { IDLE_FORM, type FormState } from '@/server/action-result'

/**
 * Site forms. Same shape as the customer forms: the action arrives already bound to the customer (and,
 * when editing, the site), so this file only renders fields.
 *
 * `idPrefix` exists because a customer page can show a create form and several edit panels at once,
 * and two inputs sharing an id break `<label for>` — screen readers then announce the wrong label.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

export interface SiteFormValues {
  id: string
  name: string
  address: {
    line1: string | null
    line2: string | null
    city: string | null
    postcode: string | null
    country: string | null
  } | null
  accessNotes?: string | null
  inductionRequirements?: string | null
  operatingHours?: string | null
  latitude?: number | null
  longitude?: number | null
}

function SiteFields({
  value,
  idPrefix,
}: {
  value?: SiteFormValues
  idPrefix: string
}) {
  const id = (name: string) => `${idPrefix}-${name}`

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor={id('name')} className={labelClass}>
          Site name
        </label>
        <input
          id={id('name')}
          name="name"
          required
          defaultValue={value?.name}
          placeholder="Tuas Workshop"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-muted">
          What the office calls it. This is the name a spreadsheet import matches against.
        </p>
      </div>

      <div className="sm:col-span-2">
        <label htmlFor={id('line1')} className={labelClass}>
          Address line 1
        </label>
        <input
          id={id('line1')}
          name="address.line1"
          defaultValue={value?.address?.line1 ?? ''}
          className={inputClass}
        />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor={id('line2')} className={labelClass}>
          Address line 2 <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={id('line2')}
          name="address.line2"
          defaultValue={value?.address?.line2 ?? ''}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('city')} className={labelClass}>
          City
        </label>
        <input
          id={id('city')}
          name="address.city"
          defaultValue={value?.address?.city ?? ''}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('postcode')} className={labelClass}>
          Postcode
        </label>
        <input
          id={id('postcode')}
          name="address.postcode"
          defaultValue={value?.address?.postcode ?? ''}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('country')} className={labelClass}>
          Country
        </label>
        <input
          id={id('country')}
          name="address.country"
          defaultValue={value?.address?.country ?? 'Singapore'}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('operatingHours')} className={labelClass}>
          Operating hours <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={id('operatingHours')}
          name="operatingHours"
          defaultValue={value?.operatingHours ?? ''}
          placeholder="Mon–Fri 08:00–17:00"
          className={inputClass}
        />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor={id('accessNotes')} className={labelClass}>
          Access notes
        </label>
        <textarea
          id={id('accessNotes')}
          name="accessNotes"
          rows={3}
          defaultValue={value?.accessNotes ?? ''}
          placeholder="Report to security at Gate B. Bring your own PPE; hard hats are not lent out."
          className={inputClass}
        />
        <p className="mt-1 text-xs text-muted">
          Shown to the technician on the job sheet. This is the field that saves a wasted trip.
        </p>
      </div>

      <div className="sm:col-span-2">
        <label htmlFor={id('inductionRequirements')} className={labelClass}>
          Induction requirements
        </label>
        <textarea
          id={id('inductionRequirements')}
          name="inductionRequirements"
          rows={2}
          defaultValue={value?.inductionRequirements ?? ''}
          placeholder="Site induction required; valid for 12 months."
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('latitude')} className={labelClass}>
          Latitude <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={id('latitude')}
          name="latitude"
          inputMode="decimal"
          defaultValue={value?.latitude ?? ''}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('longitude')} className={labelClass}>
          Longitude <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={id('longitude')}
          name="longitude"
          inputMode="decimal"
          defaultValue={value?.longitude ?? ''}
          className={inputClass}
        />
      </div>
    </div>
  )
}

export function SiteForm({
  action,
  value,
  submitLabel,
  idPrefix,
}: {
  action: ServerAction
  value?: SiteFormValues
  submitLabel: string
  idPrefix: string
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-5">
      <SiteFields value={value} idPrefix={idPrefix} />
      <FormMessage state={state} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

export function ArchiveSiteButton({
  action,
  name,
  craneCount,
}: {
  action: ServerAction
  name: string
  craneCount: number
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, IDLE_FORM)
  const blocked = craneCount > 0

  return (
    <form action={formAction} className="space-y-2">
      <button
        type="submit"
        disabled={pending || blocked}
        className="rounded-md border border-neg/40 px-3 py-1.5 text-sm font-medium text-neg hover:bg-neg/10 disabled:opacity-60"
      >
        {pending ? 'Archiving…' : `Archive ${name}`}
      </button>
      {blocked ? (
        <p className="text-xs text-muted">
          This site still has {craneCount} {craneCount === 1 ? 'crane' : 'cranes'}. Move or archive
          them first — archiving the site would hide them with it.
        </p>
      ) : null}
      <FormMessage state={state} />
    </form>
  )
}
