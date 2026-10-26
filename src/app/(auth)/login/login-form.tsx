'use client'

import { useActionState } from 'react'
import { signInAction, type LoginState } from './actions'

const INITIAL: LoginState = { message: null }

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signInAction, INITIAL)

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />

      {state.message ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {state.message}
        </p>
      ) : null}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          aria-invalid={state.fields?.email ? true : undefined}
          aria-describedby={state.fields?.email ? 'email-error' : undefined}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
        />
        {state.fields?.email ? (
          <p id="email-error" className="mt-1 text-sm text-red-700">
            {state.fields.email.join(' ')}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.fields?.password ? true : undefined}
          aria-describedby={state.fields?.password ? 'password-error' : undefined}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
        />
        {state.fields?.password ? (
          <p id="password-error" className="mt-1 text-sm text-red-700">
            {state.fields.password.join(' ')}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-slate-900 px-4 py-2.5 font-medium text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
