import type { FormState } from '@/server/action-result'

/** Shared form styling, so every form in the app looks like the same app. */

export const inputClass =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-100'

export const labelClass = 'block text-sm font-medium text-slate-700'

export const buttonClass =
  'rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-60'

export const secondaryButtonClass =
  'rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60'

export const cardClass = 'rounded-lg border border-slate-200 bg-white p-6 shadow-sm'

/** Renders nothing until the form has been submitted, then either the error or the confirmation. */
export function FormMessage({ state }: { state: FormState }) {
  if (!state.message) return null

  return (
    <p
      role={state.ok ? 'status' : 'alert'}
      className={
        state.ok
          ? 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900'
          : 'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800'
      }
    >
      {state.message}
    </p>
  )
}

/** Per-field messages, keyed the way Zod reports them. */
export function FieldError({ state, name }: { state: FormState; name: string }) {
  const messages = state.fields?.[name]
  if (!messages?.length) return null

  return (
    <p id={`${name}-error`} className="mt-1 text-sm text-red-700">
      {messages.join(' ')}
    </p>
  )
}
