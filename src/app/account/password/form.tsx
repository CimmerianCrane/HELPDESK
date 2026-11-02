'use client'

import { useActionState } from 'react'
import { FieldError, FormMessage, inputClass, labelClass } from '@/components/office/ui'
import { IDLE_FORM } from '@/server/action-result'
import { changePasswordAction } from './actions'

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div>
        <label htmlFor="currentPassword" className={labelClass}>
          Current password
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
        <FieldError state={state} name="currentPassword" />
      </div>

      <div>
        <label htmlFor="password" className={labelClass}>
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-muted">
          At least 12 characters. Changing it signs out every other device you are signed in on.
        </p>
        <FieldError state={state} name="password" />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 font-medium text-accent-fg hover:bg-anchor-soft disabled:opacity-60"
      >
        {pending ? 'Changing…' : 'Change password'}
      </button>
    </form>
  )
}
