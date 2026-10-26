'use client'

import { useTechSync } from '@/offline/use-tech-sync'

/**
 * The one line that tells a technician whether what they are looking at is current.
 *
 * It says when the copy on the phone was taken, not just "offline", because "offline since this
 * morning" and "offline since Tuesday" mean different things about whether the address in front of
 * them can still be trusted.
 */
export function SyncStatus() {
  const { online, syncing, lastSynced, error, sync } = useTechSync()

  const stamp = lastSynced
    ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(lastSynced)
    : null

  if (syncing) {
    return <p className="text-xs text-slate-500">Syncing…</p>
  }

  if (!online || error) {
    return (
      <p className="flex items-center gap-2 text-xs text-amber-800">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-500" aria-hidden />
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
    <p className="flex items-center gap-2 text-xs text-slate-500">
      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
      <span>{stamp ? `Up to date · ${stamp}` : 'Up to date'}</span>
    </p>
  )
}
