'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import {
  FieldError,
  FormMessage,
  buttonClass,
  inputClass,
  labelClass,
} from '@/components/office/ui'
import { IDLE_FORM } from '@/server/action-result'
import { createUserAction } from './actions'

export interface RoleOption {
  value: string
  label: string
  description: string
}

export interface CustomerOption {
  id: string
  name: string
}

export function UserCreateForm({
  roles,
  customers,
}: {
  roles: RoleOption[]
  customers: CustomerOption[]
}) {
  const [state, formAction, pending] = useActionState(createUserAction, IDLE_FORM)
  const [role, setRole] = useState('TECHNICIAN')
  const formRef = useRef<HTMLFormElement>(null)

  // Clear the form once the user has actually been created, so a second one can be typed straight in.
  useEffect(() => {
    if (state.ok && state.message) formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className={labelClass}>
            Name
          </label>
          <input id="name" name="name" required className={inputClass} />
          <FieldError state={state} name="name" />
        </div>

        <div>
          <label htmlFor="email" className={labelClass}>
            Email
          </label>
          <input id="email" name="email" type="email" required className={inputClass} />
          <FieldError state={state} name="email" />
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
            className={inputClass}
          >
            {roles.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {roles.find((option) => option.value === role)?.description}
          </p>
          <FieldError state={state} name="role" />
        </div>

        <div>
          <label htmlFor="phone" className={labelClass}>
            Phone <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input id="phone" name="phone" className={inputClass} />
          <FieldError state={state} name="phone" />
        </div>

        {role === 'TECHNICIAN' ? (
          <div>
            <label htmlFor="employeeNo" className={labelClass}>
              Employee number{' '}
              <span className="font-normal text-slate-500">(optional, appears on job sheets)</span>
            </label>
            <input id="employeeNo" name="employeeNo" className={inputClass} />
            <FieldError state={state} name="employeeNo" />
          </div>
        ) : null}

        {role === 'CUSTOMER' ? (
          <div>
            <label htmlFor="customerId" className={labelClass}>
              Customer
            </label>
            <select id="customerId" name="customerId" required className={inputClass}>
              <option value="">Choose a customer…</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              The account this login can see in the portal. Nothing else is visible to it.
            </p>
            <FieldError state={state} name="customerId" />
          </div>
        ) : null}

        <div>
          <label htmlFor="password" className={labelClass}>
            Temporary password
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
            At least 12 characters. Shown as you type so you can read it out — the user changes it
            after signing in.
          </p>
          <FieldError state={state} name="password" />
        </div>
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Creating…' : 'Create user'}
      </button>
    </form>
  )
}
