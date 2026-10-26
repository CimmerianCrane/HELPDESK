'use client'

import Link from 'next/link'
import { useActionState, useEffect, useRef } from 'react'
import {
  FieldError,
  FormMessage,
  buttonClass,
  inputClass,
  labelClass,
  secondaryButtonClass,
} from '@/components/office/ui'
import {
  CONTACT_ROLES,
  CUSTOMER_STATUSES,
  PREFERRED_CHANNELS,
} from '@/lib/validation/customers'
import {
  CONTACT_ROLE_LABELS,
  CUSTOMER_STATUS_LABELS,
  PREFERRED_CHANNEL_LABELS,
} from '@/server/customers/labels'
import { IDLE_FORM, type FormState } from '@/server/action-result'

/**
 * Customer and contact forms. Client components only because they need `useActionState` for inline
 * validation messages; the same Zod schema runs again on the server, and the permission check lives
 * in the service. Nothing here is a security boundary.
 *
 * Each contact form receives its action from the page, already bound to the customer (and, for an
 * edit, the contact) — so this file has no opinion about create-versus-update.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

export interface CustomerFormValues {
  id: string
  legalName: string
  tradingName: string | null
  uen: string | null
  status: string
  paymentTerms: number | null
  notes: string | null
  billingAddress: {
    line1: string | null
    line2: string | null
    city: string | null
    postcode: string | null
    country: string | null
  } | null
}

const ADDRESS_FIELDS = [
  { name: 'line1', label: 'Address line 1', wide: true },
  { name: 'line2', label: 'Address line 2', wide: true },
  { name: 'city', label: 'City', wide: false },
  { name: 'postcode', label: 'Postcode', wide: false },
  { name: 'country', label: 'Country', wide: false },
] as const

function CustomerFields({ value }: { value?: CustomerFormValues }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor="legalName" className={labelClass}>
          Legal name
        </label>
        <input
          id="legalName"
          name="legalName"
          required
          defaultValue={value?.legalName}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          Exactly as it appears on invoices. The trading name, below, is the short one.
        </p>
      </div>

      <div>
        <label htmlFor="tradingName" className={labelClass}>
          Trading name <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <input
          id="tradingName"
          name="tradingName"
          defaultValue={value?.tradingName ?? ''}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="uen" className={labelClass}>
          UEN <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <input id="uen" name="uen" defaultValue={value?.uen ?? ''} className={inputClass} />
        <p className="mt-1 text-xs text-slate-500">
          A change here will raise a re-registration reminder once the compliance engine is built.
        </p>
      </div>

      <div>
        <label htmlFor="status" className={labelClass}>
          Status
        </label>
        <select
          id="status"
          name="status"
          defaultValue={value?.status ?? 'PROSPECT'}
          className={inputClass}
        >
          {CUSTOMER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {CUSTOMER_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="paymentTerms" className={labelClass}>
          Payment terms <span className="font-normal text-slate-500">(days)</span>
        </label>
        <input
          id="paymentTerms"
          name="paymentTerms"
          type="number"
          min={0}
          max={365}
          defaultValue={value?.paymentTerms ?? 30}
          className={inputClass}
        />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="notes" className={labelClass}>
          Notes <span className="font-normal text-slate-500">(optional, internal)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={value?.notes ?? ''}
          className={inputClass}
        />
      </div>

      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium text-slate-700">
          Billing address <span className="font-normal text-slate-500">(optional)</span>
        </legend>
        <p className="mt-1 text-xs text-slate-500">
          Kept as fields rather than one blob, because it is printed on invoices.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {ADDRESS_FIELDS.map((field) => (
            <div key={field.name} className={field.wide ? 'sm:col-span-2' : ''}>
              <label htmlFor={`address-${field.name}`} className={labelClass}>
                {field.label}
              </label>
              <input
                id={`address-${field.name}`}
                name={`address.${field.name}`}
                defaultValue={value?.billingAddress?.[field.name] ?? ''}
                className={inputClass}
              />
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  )
}

/** Messages for fields the shared fieldset does not render an error slot for. */
function CustomerFieldErrors({ state }: { state: FormState }) {
  return (
    <>
      <FieldError state={state} name="legalName" />
      <FieldError state={state} name="tradingName" />
      <FieldError state={state} name="uen" />
      <FieldError state={state} name="status" />
      <FieldError state={state} name="paymentTerms" />
      <FieldError state={state} name="notes" />
    </>
  )
}

export function CreateCustomerForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const formRef = useRef<HTMLFormElement>(null)

  // Clear it once the customer has actually been created, so a second one can be typed straight in.
  useEffect(() => {
    if (state.ok && state.message) formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <FormMessage state={state} />
      <CustomerFieldErrors state={state} />
      <CustomerFields />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Creating…' : 'Create customer'}
      </button>
    </form>
  )
}

export function EditCustomerForm({
  customer,
  action,
}: {
  customer: CustomerFormValues
  action: ServerAction
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-5">
      <FormMessage state={state} />
      <CustomerFieldErrors state={state} />
      <CustomerFields value={customer} />

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Saving…' : 'Save changes'}
        </button>
        <Link href={`/customers/${customer.id}`} className={secondaryButtonClass}>
          Cancel
        </Link>
      </div>
    </form>
  )
}

export function ArchiveCustomerButton({
  action,
  hasHistory,
}: {
  action: ServerAction
  hasHistory: boolean
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const detail = hasHistory
          ? ' Its sites and contacts are archived with it, and its job and crane history stays readable.'
          : ''
        if (!window.confirm(`Archive this customer?${detail}`)) event.preventDefault()
      }}
      className="space-y-2"
    >
      <FormMessage state={state} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-red-300 bg-white px-4 py-2 font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
      >
        {pending ? 'Archiving…' : 'Archive customer'}
      </button>
      <p className="max-w-md text-xs text-slate-500">
        Archived customers leave the list but not the history. Nothing is ever hard-deleted.
      </p>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export interface ContactFormValues {
  id: string
  name: string
  role: string
  phone: string | null
  email: string | null
  preferredChannel: string
  isPrimary: boolean
  siteId: string | null
}

function ContactFields({
  action,
  value,
  sites,
  submitLabel,
  idPrefix,
}: {
  action: ServerAction
  value?: ContactFormValues
  sites: Array<{ id: string; name: string }>
  submitLabel: string
  idPrefix: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.ok && state.message) formRef.current?.reset()
  }, [state])

  // Ids are prefixed because the add form and the edit forms can appear on the same page.
  const id = (name: string) => `${idPrefix}-${name}`

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={id('name')} className={labelClass}>
            Name
          </label>
          <input
            id={id('name')}
            name="name"
            required
            defaultValue={value?.name}
            className={inputClass}
          />
          <FieldError state={state} name="name" />
        </div>

        <div>
          <label htmlFor={id('role')} className={labelClass}>
            Role
          </label>
          <select
            id={id('role')}
            name="role"
            defaultValue={value?.role ?? 'SITE_CONTACT'}
            className={inputClass}
          >
            {CONTACT_ROLES.map((role) => (
              <option key={role} value={role}>
                {CONTACT_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          <FieldError state={state} name="role" />
        </div>

        <div>
          <label htmlFor={id('phone')} className={labelClass}>
            Phone <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            id={id('phone')}
            name="phone"
            defaultValue={value?.phone ?? ''}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={id('email')} className={labelClass}>
            Email <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            id={id('email')}
            name="email"
            type="email"
            defaultValue={value?.email ?? ''}
            className={inputClass}
          />
          <FieldError state={state} name="email" />
        </div>

        <div>
          <label htmlFor={id('channel')} className={labelClass}>
            Preferred channel
          </label>
          <select
            id={id('channel')}
            name="preferredChannel"
            defaultValue={value?.preferredChannel ?? 'PHONE'}
            className={inputClass}
          >
            {PREFERRED_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {PREFERRED_CHANNEL_LABELS[channel]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={id('site')} className={labelClass}>
            Site <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <select
            id={id('site')}
            name="siteId"
            defaultValue={value?.siteId ?? ''}
            className={inputClass}
            disabled={sites.length === 0}
          >
            <option value="">Whole company</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {sites.length === 0
              ? 'No sites yet — the sites screen arrives in the next slice.'
              : 'Leave as “whole company” for accounts and decision makers.'}
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          name="isPrimary"
          defaultChecked={value?.isPrimary}
          className="h-4 w-4 rounded border-slate-300"
        />
        Primary contact — the one to call first
      </label>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

export function ContactForm(props: {
  action: ServerAction
  value?: ContactFormValues
  sites: Array<{ id: string; name: string }>
  submitLabel: string
  idPrefix: string
}) {
  return <ContactFields {...props} />
}

export function ArchiveContactButton({
  action,
  name,
}: {
  action: ServerAction
  name: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`Archive ${name}? The record stays in the history.`)) {
          event.preventDefault()
        }
      }}
      className="inline"
    >
      <FormMessage state={state} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-medium text-red-700 underline hover:text-red-900 disabled:opacity-60"
      >
        {pending ? 'Archiving…' : 'Archive'}
      </button>
    </form>
  )
}
