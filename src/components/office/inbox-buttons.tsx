'use client'

import { useActionState } from 'react'
import type { FormState } from '@/server/action-result'
import { IDLE_FORM } from '@/server/action-result'
import { secondaryButtonClass } from '@/components/office/ui'

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

/**
 * The two writes the inbox has: mark one read, mark all read. Both are plain buttons posting to a
 * bound server action, like the "Mark as checked" button on a crane.
 *
 * Marking one read is deliberately not a link to the job: an alert that navigates away from the
 * inbox the moment it is clicked makes "what did I just action" unanswerable. The title is the link;
 * the button only clears the badge.
 */
export function MarkReadButton({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, IDLE_FORM)

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-muted hover:bg-raised disabled:opacity-60"
      >
        {pending ? 'Marking…' : 'Mark read'}
      </button>
      {state.ok ? null : <p className="mt-1 text-xs text-neg">{state.message}</p>}
    </form>
  )
}

export function MarkAllReadButton({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-1">
      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        {pending ? 'Marking…' : 'Mark all read'}
      </button>
      {state.message && !state.ok ? (
        <p className="text-xs text-neg">{state.message}</p>
      ) : null}
    </form>
  )
}
