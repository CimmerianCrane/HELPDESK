'use client'

import { useActionState } from 'react'
import {
  FieldError,
  FormMessage,
  buttonClass,
  inputClass,
  labelClass,
} from '@/components/office/ui'
import { IDLE_FORM } from '@/server/action-result'
import { updateUserAction } from '../actions'
import type { RoleOption } from '../user-create-form'

export function UserEditForm({
  userId,
  user,
  roles,
  isSelf,
}: {
  userId: string
  user: { name: string; role: string; phone: string | null; isActive: boolean }
  roles: RoleOption[]
  isSelf: boolean
}) {
  const [state, formAction, pending] = useActionState(
    updateUserAction.bind(null, userId),
    IDLE_FORM,
  )

  return (
    <form action={formAction} className="space-y-5">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className={labelClass}>
            Name
          </label>
          <input id="name" name="name" defaultValue={user.name} required className={inputClass} />
          <FieldError state={state} name="name" />
        </div>

        <div>
          <label htmlFor="role" className={labelClass}>
            Role
          </label>
          <select
            id="role"
            name="role"
            defaultValue={user.role}
            disabled={isSelf}
            className={inputClass}
          >
            {roles.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {isSelf ? (
            <>
              {/* Disabled inputs are not submitted, so carry the current role through unchanged. */}
              <input type="hidden" name="role" value={user.role} />
              <p className="mt-1 text-xs text-slate-500">
                You cannot change your own role. Ask another administrator.
              </p>
            </>
          ) : null}
          <FieldError state={state} name="role" />
        </div>

        <div>
          <label htmlFor="phone" className={labelClass}>
            Phone <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input id="phone" name="phone" defaultValue={user.phone ?? ''} className={inputClass} />
          <FieldError state={state} name="phone" />
        </div>

        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={user.isActive}
              disabled={isSelf}
              className="h-4 w-4 rounded border-slate-300"
            />
            Active — can sign in
          </label>
          {isSelf ? (
            <>
              <input type="hidden" name="isActive" value="true" />
            </>
          ) : null}
        </div>
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  )
}
