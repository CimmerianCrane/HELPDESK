'use client'

import { useActionState } from 'react'
import { FormMessage, buttonClass, inputClass, labelClass } from '@/components/office/ui'
import { CRANE_TYPES } from '@/lib/validation/cranes'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import { CRANE_TYPE_LABELS } from '@/lib/cranes/labels'

/**
 * Crane forms. The action arrives bound to whatever identifies the crane (its id when editing, the
 * customer when creating), so this file has no opinion about create-versus-update.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

export interface CraneFormValues {
  id: string
  assetTag: string
  qrValue: string
  type: string
  brand: string | null
  model: string | null
  serialNumber: string | null
  swlKg: number
  yearOfManufacture: number | null
  statutoryRegistrationNo: string | null
  registrationDate: Date | null
  ownerEntity: string | null
  locationOnSite: string | null
  hourMeter: number | null
  notes: string | null
  site: { id: string; name: string }
}

export interface SiteOption {
  id: string
  name: string
}

/** `YYYY-MM-DD` for a date input, reading the stored value as the calendar day it was entered. */
function toDateInput(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : ''
}

function CraneFields({
  value,
  sites,
  customerId,
  idPrefix,
}: {
  value?: CraneFormValues
  sites: SiteOption[]
  customerId: string
  idPrefix: string
}) {
  const id = (name: string) => `${idPrefix}-${name}`

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="customerId" value={customerId} />

      <div>
        <label htmlFor={id('assetTag')} className={labelClass}>
          Asset tag
        </label>
        <input
          id={id('assetTag')}
          name="assetTag"
          defaultValue={value?.assetTag ?? ''}
          placeholder="OVH-01"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          {value
            ? 'What the customer calls it. Changing this does not change the QR sticker.'
            : 'Leave blank to generate one.'}
        </p>
      </div>

      <div>
        <label htmlFor={id('type')} className={labelClass}>
          Type
        </label>
        <select id={id('type')} name="type" defaultValue={value?.type ?? ''} className={inputClass}>
          <option value="" disabled>
            Choose…
          </option>
          {CRANE_TYPES.map((type) => (
            <option key={type} value={type}>
              {CRANE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={id('siteId')} className={labelClass}>
          Site
        </label>
        <select id={id('siteId')} name="siteId" defaultValue={value?.site.id ?? ''} className={inputClass}>
          <option value="" disabled>
            Choose…
          </option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={id('swlKg')} className={labelClass}>
          Safe working load (kg)
        </label>
        <input
          id={id('swlKg')}
          name="swlKg"
          inputMode="decimal"
          required
          defaultValue={value?.swlKg ?? ''}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">As marked on the plate, not a rounded estimate.</p>
      </div>

      <div>
        <label htmlFor={id('brand')} className={labelClass}>
          Make
        </label>
        <input id={id('brand')} name="brand" defaultValue={value?.brand ?? ''} className={inputClass} />
      </div>

      <div>
        <label htmlFor={id('model')} className={labelClass}>
          Model
        </label>
        <input id={id('model')} name="model" defaultValue={value?.model ?? ''} className={inputClass} />
      </div>

      <div>
        <label htmlFor={id('serialNumber')} className={labelClass}>
          Serial number
        </label>
        <input
          id={id('serialNumber')}
          name="serialNumber"
          defaultValue={value?.serialNumber ?? ''}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('yearOfManufacture')} className={labelClass}>
          Year of manufacture
        </label>
        <input
          id={id('yearOfManufacture')}
          name="yearOfManufacture"
          inputMode="numeric"
          defaultValue={value?.yearOfManufacture ?? ''}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('statutoryRegistrationNo')} className={labelClass}>
          Statutory registration no.
        </label>
        <input
          id={id('statutoryRegistrationNo')}
          name="statutoryRegistrationNo"
          defaultValue={value?.statutoryRegistrationNo ?? ''}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('registrationDate')} className={labelClass}>
          Registration date
        </label>
        <input
          id={id('registrationDate')}
          name="registrationDate"
          type="date"
          defaultValue={toDateInput(value?.registrationDate ?? null)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('ownerEntity')} className={labelClass}>
          Owner of record
        </label>
        <input
          id={id('ownerEntity')}
          name="ownerEntity"
          defaultValue={value?.ownerEntity ?? ''}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('locationOnSite')} className={labelClass}>
          Location on site
        </label>
        <input
          id={id('locationOnSite')}
          name="locationOnSite"
          defaultValue={value?.locationOnSite ?? ''}
          placeholder="Bay 3, north end"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('hourMeter')} className={labelClass}>
          Hour meter
        </label>
        <input
          id={id('hourMeter')}
          name="hourMeter"
          inputMode="decimal"
          defaultValue={value?.hourMeter ?? ''}
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
          rows={3}
          defaultValue={value?.notes ?? ''}
          className={inputClass}
        />
      </div>
    </div>
  )
}

export function CraneForm({
  action,
  value,
  sites,
  customerId,
  submitLabel,
  idPrefix,
}: {
  action: ServerAction
  value?: CraneFormValues
  sites: SiteOption[]
  customerId: string
  submitLabel: string
  idPrefix: string
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-5">
      <CraneFields value={value} sites={sites} customerId={customerId} idPrefix={idPrefix} />
      <FormMessage state={state} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

export function RestrictCraneButton({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-3">
      <label htmlFor="restrict-reason" className={labelClass}>
        Why is this crane being restricted?
      </label>
      <textarea
        id="restrict-reason"
        name="reason"
        rows={2}
        required
        className={inputClass}
        placeholder="Wire rope shows broken wires; do not operate pending inspection."
      />
      <p className="text-xs text-slate-600">
        A restriction without a reason is no use to the technician standing at the machine, so this is
        required. It is shown on the crane record and kept in the audit log.
      </p>
      <FormMessage state={state} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-800 disabled:opacity-60"
      >
        {pending ? 'Restricting…' : 'Restrict — do not operate'}
      </button>
    </form>
  )
}

export function UnrestrictCraneButton({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-2">
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Clearing…' : 'Clear the restriction'}
      </button>
      <FormMessage state={state} />
    </form>
  )
}

export function AcknowledgeReregistrationButton({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
      >
        {pending ? 'Recording…' : 'Mark as checked'}
      </button>
      <FormMessage state={state} />
    </form>
  )
}

export function ArchiveCraneButton({
  action,
  assetTag,
  hasHistory,
}: {
  action: ServerAction
  assetTag: string
  hasHistory: boolean
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-2">
      <button
        type="submit"
        disabled={pending || hasHistory}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-60"
      >
        {pending ? 'Archiving…' : `Archive ${assetTag}`}
      </button>
      <p className="text-xs text-slate-600">
        {hasHistory
          ? 'This crane has job or report history. Set its status to decommissioned instead — archiving is for one entered by mistake.'
          : 'Only for a crane entered by mistake. Archiving leaves the record and its audit trail intact.'}
      </p>
      <FormMessage state={state} />
    </form>
  )
}
