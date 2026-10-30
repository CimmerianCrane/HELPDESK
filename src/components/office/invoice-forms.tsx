'use client'

import { useActionState, useState } from 'react'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/lib/validation/invoices'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import { FieldError, FormMessage, buttonClass, inputClass, labelClass, secondaryButtonClass } from './ui'

/**
 * Invoice forms (slice 20).
 *
 * The line editor is the same on the job page (raise) and the invoice page (edit a draft): rows post
 * the same three field names in render order, which is the assumption `lineBody` in the action makes.
 * A row with no description is dropped, so the empty row left at the bottom is harmless.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

interface LineDraft {
  key: number
  description: string
  quantity: string
  unitPrice: string
}

let nextKey = 0
function blankLine(): LineDraft {
  nextKey += 1
  return { key: nextKey, description: '', quantity: '1', unitPrice: '' }
}

export function InvoiceForm({
  action,
  initialLines,
  suggested,
  submitLabel = 'Raise the invoice',
}: {
  action: ServerAction
  initialLines?: Array<{ description: string; quantity: number; unitPrice: number }>
  /** The job's parts at their sell price, offered as prefilled lines. Only the create form passes these. */
  suggested?: Array<{ description: string; quantity: number; unitPrice: number }>
  submitLabel?: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const [lines, setLines] = useState<LineDraft[]>(() => {
    const seeded = (initialLines ?? []).map((line) => {
      nextKey += 1
      return {
        key: nextKey,
        description: line.description,
        quantity: String(line.quantity),
        unitPrice: line.unitPrice.toFixed(2),
      }
    })
    return seeded.length > 0 ? seeded : [blankLine()]
  })

  const update = (key: number, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      {suggested && suggested.length > 0 ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3">
          <p className="text-sm font-medium text-sky-900">Parts issued on this job</p>
          <p className="mt-1 text-xs text-sky-800">
            Offered at their sell price, from the stock movements the technician recorded. Add one,
            then adjust anything that should be charged differently — warranty, or a fixed price.
          </p>
          <ul className="mt-2 space-y-1">
            {suggested.map((line, index) => (
              <li key={index} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-sky-900">
                  {line.description} · {line.quantity} × ${line.unitPrice.toFixed(2)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setLines((current) => [...current, { ...blankLine(), ...line, key: (nextKey += 1), quantity: String(line.quantity), unitPrice: line.unitPrice.toFixed(2) }])
                  }
                  className="text-sm text-sky-900 underline hover:text-sky-950"
                >
                  Add to invoice
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-3">
        {lines.map((line) => (
          <div key={line.key} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-12">
            <div className="sm:col-span-8">
              <label className={labelClass} htmlFor={`description-${line.key}`}>
                Description
              </label>
              <input
                id={`description-${line.key}`}
                name="description"
                value={line.description}
                onChange={(event) => update(line.key, { description: event.target.value })}
                maxLength={500}
                placeholder="e.g. 4 hours on site — hoist brake replacement"
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor={`quantity-${line.key}`}>
                Qty
              </label>
              <input
                id={`quantity-${line.key}`}
                name="quantity"
                type="number"
                step="0.001"
                min="0.001"
                value={line.quantity}
                onChange={(event) => update(line.key, { quantity: event.target.value })}
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor={`price-${line.key}`}>
                Unit price
              </label>
              <input
                id={`price-${line.key}`}
                name="unitPrice"
                type="number"
                step="0.01"
                min="0"
                value={line.unitPrice}
                onChange={(event) => update(line.key, { unitPrice: event.target.value })}
                placeholder="0.00"
                className={inputClass}
              />
            </div>

            {lines.length > 1 ? (
              <div className="sm:col-span-12">
                <button
                  type="button"
                  onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}
                  className="text-sm text-slate-500 underline hover:text-slate-800"
                >
                  Remove this line
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <FieldError state={state} name="lines" />

      <button
        type="button"
        onClick={() => setLines((current) => [...current, blankLine()])}
        className={secondaryButtonClass}
      >
        Add a line
      </button>

      <p className="text-xs text-slate-500">
        GST is added at the rate in Settings when the invoice is issued. A draft can be edited; once
        it is issued, the lines are the numbers the customer is charged.
      </p>

      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

/** Issue a draft, or void one nothing has been paid against. */
export function InvoiceDecisionForm({
  action,
  status,
  label,
  withReason = false,
  primary = false,
}: {
  action: ServerAction
  status: 'ISSUED' | 'VOID'
  label: string
  withReason?: boolean
  primary?: boolean
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-2">
      <FormMessage state={state} />
      <input type="hidden" name="status" value={status} />
      {withReason ? (
        <div>
          <label className={labelClass} htmlFor={`reason-${status}`}>
            Reason
          </label>
          <input
            id={`reason-${status}`}
            name="reason"
            maxLength={500}
            placeholder="e.g. Raised in error — wrong job"
            className={inputClass}
          />
          <FieldError state={state} name="reason" />
        </div>
      ) : null}
      <button type="submit" className={primary ? buttonClass : secondaryButtonClass} disabled={pending}>
        {pending ? 'Saving…' : label}
      </button>
    </form>
  )
}

/** Money received against an issued invoice. The amount is the only thing that moves the status. */
export function RecordPaymentForm({
  action,
  remaining,
  currency,
  today,
  defaultMethod = 'BANK_TRANSFER',
}: {
  action: ServerAction
  /** What is still owed, in currency units — the field starts at it. */
  remaining: number
  currency: string
  /** Today's day key in the operating timezone, so the date field opens on the right day. */
  today: string
  defaultMethod?: (typeof PAYMENT_METHODS)[number]
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-3">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="amount">
            Amount ({currency})
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={remaining.toFixed(2)}
            className={inputClass}
          />
          <FieldError state={state} name="amount" />
        </div>
        <div>
          <label className={labelClass} htmlFor="method">
            Method
          </label>
          <select id="method" name="method" defaultValue={defaultMethod} className={inputClass}>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </select>
          <FieldError state={state} name="method" />
        </div>
        <div>
          <label className={labelClass} htmlFor="paidAt">
            Received on
          </label>
          <input id="paidAt" name="paidAt" type="date" defaultValue={today} className={inputClass} />
          <FieldError state={state} name="paidAt" />
        </div>
        <div>
          <label className={labelClass} htmlFor="reference">
            Reference (optional)
          </label>
          <input
            id="reference"
            name="reference"
            maxLength={100}
            placeholder="e.g. PayNow reference"
            className={inputClass}
          />
          <FieldError state={state} name="reference" />
        </div>
      </div>
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? 'Recording…' : 'Record the payment'}
      </button>
    </form>
  )
}

/** Sends every billed invoice not yet in the accounting system (slice 37). One press, one run. */
export function PushInvoicesForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-2">
      <FormMessage state={state} />
      <button type="submit" className={secondaryButtonClass} disabled={pending}>
        {pending ? 'Pushing…' : 'Push to the accounting system'}
      </button>
    </form>
  )
}
