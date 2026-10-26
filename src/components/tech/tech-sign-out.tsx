'use client'

import { useTransition } from 'react'
import { signOutAction } from '@/app/actions'
import { clearCache } from '@/offline/db'

/**
 * Signing out on a phone has to take the cached work with it.
 *
 * Site phones are shared. Without this, the next person to sign in would open My Jobs and read the
 * previous technician's customers, addresses and access notes out of Dexie before any request to the
 * server could say otherwise. Clearing first, then signing out, means the two can never be reversed.
 */
export function TechSignOut() {
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          // A failed clear must not stop the sign-out — leaving somebody signed in on a shared phone
          // is the worse of the two failures.
          await clearCache().catch(() => undefined)
          await signOutAction()
        })
      }}
      className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 active:bg-slate-100 disabled:opacity-60"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
