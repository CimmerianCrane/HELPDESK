'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SyncBundle } from '@/server/tech/my-jobs'
import { lastSyncedAt, storeBundle } from './db'

/**
 * Keeps the phone's cache up to date and tells the screens how stale it is.
 *
 * The rule this file exists to enforce: **never show a technician a blank screen because the signal
 * dropped.** The pages are server-rendered when there is a network and served from the service
 * worker when there is not; this provider is what makes the second case show real work rather than
 * a "you are offline" placeholder.
 *
 * It syncs on mount and whenever the browser says it is back online. It deliberately does not poll:
 * a phone in a pocket draining its battery to ask whether anything changed is worse than a
 * technician pulling to refresh.
 */

export interface TechSyncState {
  online: boolean
  syncing: boolean
  lastSynced: Date | null
  error: string | null
  sync: () => Promise<void>
}

const TechSyncContext = createContext<TechSyncState | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  // `navigator.onLine` is false before hydration on the server, so start optimistic and correct
  // during the first effect rather than flashing an offline banner on every page load.
  const [online, setOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  // One sync at a time. The mount sync and the "back online" event can otherwise overlap after a
  // flaky lift, and two bundles written in the wrong order would leave the older one in place.
  const inFlight = useRef(false)

  const sync = useCallback(async () => {
    if (inFlight.current) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError('No signal. Showing what was saved on this phone.')
      return
    }

    inFlight.current = true
    setSyncing(true)
    try {
      const response = await fetch('/api/tech/sync', {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) {
        // A 401 means the session has gone; the next page load sends them to sign in. Saying so
        // here is better than silently keeping a cache the server will no longer accept.
        setError(
          response.status === 401
            ? 'Your session has ended. Sign in again to sync.'
            : 'The server could not be reached. Showing what was saved on this phone.',
        )
        return
      }

      const bundle = (await response.json()) as SyncBundle
      await storeBundle(bundle)
      setLastSynced(new Date(bundle.generatedAt))
      setError(null)
    } catch {
      // A network failure is not a bug: it is the normal state of a lift shaft.
      setError('No signal. Showing what was saved on this phone.')
    } finally {
      inFlight.current = false
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    setOnline(navigator.onLine)

    // The stored timestamp is what the page shows before the first sync of this visit finishes.
    void lastSyncedAt().then((value) => {
      if (value) setLastSynced((current) => current ?? value)
    })

    const onOnline = () => {
      setOnline(true)
      void sync()
    }
    const onOffline = () => {
      setOnline(false)
      setError('No signal. Showing what was saved on this phone.')
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    void sync()

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [sync])

  return (
    <TechSyncContext.Provider value={{ online, syncing, lastSynced, error, sync }}>
      {children}
    </TechSyncContext.Provider>
  )
}

export function useTechSync(): TechSyncState {
  const value = useContext(TechSyncContext)
  if (!value) throw new Error('useTechSync must be used inside <SyncProvider>.')
  return value
}
