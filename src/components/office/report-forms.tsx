'use client'

import { useActionState } from 'react'
import type { FormState } from '@/server/action-result'
import { FieldError, FormMessage, buttonClass, inputClass, labelClass } from './ui'

/**
 * The office's decisions on a submitted report. Three buttons and one sentence of justification, in
 * the same shape as every other action form in the app.
 */

type FormAction = (state: FormState, formData: FormData) => Promise<FormState>

export function ApproveReportForm({
  action,
  isAmendment,
}: {
  action: FormAction
  isAmendment: boolean
}) {
  const [state, formAction, pending] = useActionState(action, { ok: true, message: null })

  return (
    <form action={formAction} className="space-y-3">
      <FormMessage state={state} />
      <p className="text-sm text-muted">
        {isAmendment
          ? 'Approving issues this amendment with its own number and marks the report it corrects as superseded. Both remain readable.'
          : 'Approving assigns the next document number, renders the PDF with its signatures and photographs, locks the report and tells the customer.'}
      </p>
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? 'Approving…' : 'Approve and issue'}
      </button>
    </form>
  )
}

export function ReturnReportForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, { ok: true, message: null })

  return (
    <form action={formAction} className="space-y-3">
      <FormMessage state={state} />
      <label className={labelClass} htmlFor="return-reason">
        What has to be fixed?
      </label>
      <textarea
        id="return-reason"
        name="reason"
        rows={3}
        required
        minLength={10}
        className={inputClass}
        aria-describedby="return-reason-error"
      />
      <FieldError state={state} name="reason" />
      <button
        type="submit"
        className="rounded-md border border-neg/40 bg-field px-4 py-2 font-medium text-neg hover:bg-neg/10 disabled:opacity-60"
        disabled={pending}
      >
        {pending ? 'Sending back…' : 'Send back for correction'}
      </button>
    </form>
  )
}

export function AmendReportForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, { ok: true, message: null })

  return (
    <form action={formAction} className="space-y-3">
      <FormMessage state={state} />
      <label className={labelClass} htmlFor="amend-reason">
        Why is this being corrected?
      </label>
      <textarea
        id="amend-reason"
        name="reason"
        rows={3}
        required
        minLength={10}
        className={inputClass}
        aria-describedby="amend-reason-error"
      />
      <FieldError state={state} name="reason" />
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? 'Starting…' : 'Start an amendment'}
      </button>
    </form>
  )
}

export function SubmitAmendmentForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, { ok: true, message: null })

  return (
    <form action={formAction} className="space-y-3">
      <FormMessage state={state} />
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? 'Submitting…' : 'Submit for approval'}
      </button>
    </form>
  )
}
