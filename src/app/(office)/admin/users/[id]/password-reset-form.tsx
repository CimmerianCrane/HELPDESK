'use client'

import { useActionState } from 'react'
import {
  FieldError,
  FormMessage,
  inputClass,
  labelClass,
  secondaryButtonClass,
} from '@/components/office/ui'
import { IDLE_FORM } from '@/server/action-result'
import { setUserPasswordAction } from '../actions'

export function PasswordResetForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(
    setUserPasswordAction.bind(null, userId),
    IDLE_FORM,
  )

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div>
        <label htmlFor="password" className={labelClass}>
          New temporary password
        </label>
        <input
          id="password"
          name="password"
          type="text"
          required
          autoComplete="new-password"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          At least 12 characters. The change is recorded in the audit log; the password itself never
          is.
        </p>
        <FieldError state={state} name="password" />
      </div>

      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        {pending ? 'Setting…' : 'Set password'}
      </button>
    </form>
  )
}
