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
          className="rounded-md border border-neg/30 bg-neg/10 px-3 py-2 text-sm text-neg"
        >
          {state.message}
        </p>
      ) : null}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-ink">
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
          className="mt-1 block w-full rounded-md border border-line bg-field px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
        />
        {state.fields?.email ? (
          <p id="email-error" className="mt-1 text-sm text-neg">
            {state.fields.email.join(' ')}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-ink">
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
          className="mt-1 block w-full rounded-md border border-line bg-field px-3 py-2 text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40"
        />
        {state.fields?.password ? (
          <p id="password-error" className="mt-1 text-sm text-neg">
            {state.fields.password.join(' ')}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-hivis px-4 py-2.5 font-semibold text-ink hover:bg-hivis/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
