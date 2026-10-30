'use client'

import { useActionState, useState } from 'react'
import {
  FieldError,
  FormMessage,
  buttonClass,
  inputClass,
  labelClass,
} from '@/components/office/ui'
import { IDLE_FORM } from '@/server/action-result'
import { updateUserAction } from '../actions'
import type { CustomerOption, RoleOption } from '../user-create-form'

export function UserEditForm({
  userId,
  user,
  roles,
  customers,
  isSelf,
}: {
  userId: string
  user: {
    name: string
    role: string
    phone: string | null
    isActive: boolean
    customerId: string | null
  }
  roles: RoleOption[]
  customers: CustomerOption[]
  isSelf: boolean
}) {
  const [state, formAction, pending] = useActionState(
    updateUserAction.bind(null, userId),
    IDLE_FORM,
  )
  // Local, so choosing "Customer" reveals the picker before the first save.
  const [role, setRole] = useState(user.role)

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
            value={role}
            onChange={(event) => setRole(event.target.value)}
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

        {role === 'CUSTOMER' ? (
          <div>
            <label htmlFor="customerId" className={labelClass}>
              Customer
            </label>
            <select
              id="customerId"
              name="customerId"
              defaultValue={user.customerId ?? ''}
              required
              className={inputClass}
            >
              <option value="">Choose a customer…</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              The account this login can see in the portal.
            </p>
            <FieldError state={state} name="customerId" />
          </div>
        ) : null}

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
