import type { FormState } from '@/server/action-result'

/**
 * Shared form styling, so every form in the app looks like the same app.
 *
 * Surfaces here separate by tone, not by a line or a shadow: a panel is one step off the sheet, a
 * field is the white of a clean page. `--color-line` is only for what the eye must find (a field's
 * edge, a table's edge). The charcoal `accent` is the primary action; Hi-Vis yellow is the product's
 * signal and is spent on the current nav item and the classification marks, never on body text.
 */

export const inputClass =
  'mt-1 block w-full rounded-md border border-line bg-field px-3 py-2 text-ink placeholder:text-faint focus:border-ink focus:outline-none focus:ring-2 focus:ring-hivis/40 disabled:bg-panel disabled:text-muted'

export const labelClass = 'block text-sm font-medium text-ink'

export const buttonClass =
  'rounded-md bg-accent px-4 py-2 font-medium text-accent-fg hover:bg-anchor-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60'

/** The Hi-Vis action. One per screen, on the thing the screen exists to do. */
export const hiVisButtonClass =
  'rounded-md bg-hivis px-4 py-2 font-semibold text-ink hover:bg-hivis/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60'

export const secondaryButtonClass =
  'rounded-md bg-raised px-4 py-2 font-medium text-ink hover:bg-panel disabled:opacity-60'

// A panel is a tone step off the sheet — no border, no elevation. `rounded-lg` is this app's one radius.
export const cardClass = 'rounded-lg bg-panel p-6'

/** Document numbers, asset tags and codes, in the identifier face and lining figures. */
export const codeClass = 'text-[0.92em] tracking-tight'

/** The page's own heading, in the condensed display face. */
export const pageTitleClass = 'font-display text-title font-semibold text-ink'

/** Renders nothing until the form has been submitted, then either the error or the confirmation. */
export function FormMessage({ state }: { state: FormState }) {
  if (!state.message) return null

  return (
    <p
      role={state.ok ? 'status' : 'alert'}
      className={
        state.ok
          ? 'rounded-md bg-panel px-3 py-2 text-sm text-pos'
          : 'rounded-md bg-neg/10 px-3 py-2 text-sm text-neg'
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
    <p id={`${name}-error`} className="mt-1 text-sm text-neg">
      {messages.join(' ')}
    </p>
  )
}
