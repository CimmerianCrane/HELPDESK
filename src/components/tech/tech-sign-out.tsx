'use client'

import { useState, useTransition } from 'react'
import { techSignOutAction } from '@/app/actions'
import { clearCache } from '@/offline/db'
import { flushOutbox, pendingCount } from '@/offline/outbox'

/**
 * Signing out on a shared tablet has to take the cached work with it.
 *
 * Site tablets are shared. Without this, the next person to sign in would open My Jobs and read the
 * previous technician's customers, addresses and access notes out of Dexie — and, until the cache
 * clear above, their cached pages out of Cache Storage too. Clearing first, then signing out, means
 * the two can never be reversed.
 *
 * Reports the office has not accepted yet are the one thing a silent clear would destroy, so a
 * pending queue makes this two-step: try to send, then ask before deleting. With nothing pending it
 * stays the one tap it was. The tablet's push subscription goes at the same time, for the same
 * reason: the next technician must not get the previous one's job alerts.
 */
/** Ends this browser's job alerts: drop the subscription locally, then the server's copy of it. */
async function dropPushSubscription() {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration('/')
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return

  const { endpoint } = subscription.toJSON()
  await subscription.unsubscribe()
  await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  })
}

export function TechSignOut() {
  const [pending, startTransition] = useTransition()
  const [asked, setAsked] = useState<{ count: number } | null>(null)

  function signOut() {
    startTransition(async () => {
      // The tablet's push subscription goes with the session, or the next technician on this shared
      // tablet keeps getting the previous one's job alerts. Both steps are best-effort: the browser
      // unsubscribe can fail without a worker and the server may be unreachable, and neither is a
      // reason to leave somebody signed in on a shared device.
      await dropPushSubscription().catch(() => undefined)
      // A failed clear must not stop the sign-out — leaving somebody signed in on a shared tablet
      // is the worse of the two failures.
      await clearCache().catch(() => undefined)
      await techSignOutAction()
    })
  }

  function attempt() {
    startTransition(async () => {
      // The signal may have come back since the report was finished, so try before asking.
      await flushOutbox().catch(() => undefined)
      const count = await pendingCount().catch(() => 0)
      if (count > 0) setAsked({ count })
      else signOut()
    })
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={attempt}
        className="shrink-0 rounded-md border border-on-anchor-muted/40 px-3 py-1.5 text-sm text-on-anchor active:bg-white/10 disabled:opacity-60"
      >
        {pending ? 'Signing out…' : 'Sign out'}
      </button>

      {/* A full-width panel rather than a cramped header row: this is the one prompt on the tablet
          whose answer loses work, so it gets room to be read. */}
      {asked && (
        <div
          role="alertdialog"
          aria-label="Unsent reports"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-on-anchor-muted/30 bg-anchor p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto max-w-lg space-y-3 md:max-w-4xl lg:max-w-6xl">
            <p className="text-sm text-on-anchor">
              {asked.count} report{asked.count === 1 ? '' : 's'} on this tablet {asked.count === 1 ? 'has' : 'have'} not
              uploaded. Signing out deletes {asked.count === 1 ? 'it' : 'them'}.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={signOut}
                className="flex-1 rounded-md bg-neg px-3 py-2.5 font-semibold text-white disabled:opacity-60"
              >
                {pending ? 'Signing out…' : 'Delete and sign out'}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setAsked(null)}
                className="flex-1 rounded-md border border-on-anchor-muted/40 px-3 py-2.5 font-medium text-on-anchor disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
