'use client'

import Link from 'next/link'
import { useTechSync } from '@/offline/use-tech-sync'

/**
 * The one line that tells a technician whether what they are looking at is current.
 *
 * It says when the copy on the phone was taken, not just "offline", because "offline since this
 * morning" and "offline since Tuesday" mean different things about whether the address in front of
 * them can still be trusted.
 */
export function SyncStatus() {
  const { online, syncing, lastSynced, pending, error, sessionExpired, sync } = useTechSync()

  const stamp = lastSynced
    ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(lastSynced)
    : null

  // Nothing here blames the signal when the signal is fine: an ended session is the one case the
  // technician can act on, and a Retry button would just fail again.
  if (sessionExpired) {
    return (
      <p className="flex items-center gap-2 text-xs text-hivis">
        <span className="inline-block h-2 w-2 rounded-full bg-hivis" aria-hidden />
        <span>Session ended</span>
        <Link href="/m/login" className="underline underline-offset-2">
          Sign in again
        </Link>
      </p>
    )
  }

  if (syncing) {
    return (
      <p className="text-xs text-on-anchor-muted">
        {pending > 0 ? `Sending ${pending} report${pending === 1 ? '' : 's'}…` : 'Syncing…'}
      </p>
    )
  }

  // Finished field work that has not reached the office is the one thing a technician must not miss.
  if (pending > 0) {
    return (
      <p className="flex items-center gap-2 text-xs text-hivis">
        <span className="inline-block h-2 w-2 rounded-full bg-hivis" aria-hidden />
        <span>
          {pending} report{pending === 1 ? '' : 's'} waiting to upload
        </span>
        <button type="button" onClick={() => void sync()} className="underline underline-offset-2">
          Retry
        </button>
      </p>
    )
  }

  if (!online || error) {
    return (
      <p className="flex items-center gap-2 text-xs text-hivis">
        <span className="inline-block h-2 w-2 rounded-full bg-hivis" aria-hidden />
        <span>{stamp ? `Offline · saved ${stamp}` : 'Offline · nothing saved yet'}</span>
        <button
          type="button"
          onClick={() => void sync()}
          className="underline underline-offset-2"
        >
          Retry
        </button>
      </p>
    )
  }

  return (
    <p className="flex items-center gap-2 text-xs text-on-anchor-muted">
      <span className="inline-block h-2 w-2 rounded-full bg-pos" aria-hidden />
      <span>{stamp ? `Up to date · ${stamp}` : 'Up to date'}</span>
    </p>
  )
}
