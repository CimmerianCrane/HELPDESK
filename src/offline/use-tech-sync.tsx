'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import type { SyncBundle } from '@/server/tech/my-jobs'
import { requestOutboxSync } from './background-sync'
import { lastSyncedAt, storeBundle } from './db'
import { flushOutbox, pendingCount } from './outbox'

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
  /** Reports finished on this phone and not yet accepted by the server. */
  pending: number
  error: string | null
  /** The session has gone. The sync line links to `/m/login` rather than blaming the signal. */
  sessionExpired: boolean
  sync: () => Promise<void>
  refreshPending: () => Promise<void>
}

const TechSyncContext = createContext<TechSyncState | null>(null)

/**
 * The connection is an external store, so it is subscribed to rather than copied into state.
 * The server snapshot is optimistic: `navigator.onLine` does not exist there, and assuming offline
 * would flash the banner on every page load.
 */
function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

const readOnline = () => navigator.onLine

export function SyncProvider({ children }: { children: ReactNode }) {
  const online = useSyncExternalStore(subscribeOnline, readOnline, () => true)
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)

  // One sync at a time. The mount sync and the "back online" event can otherwise overlap after a
  // flaky lift, and two bundles written in the wrong order would leave the older one in place.
  const inFlight = useRef(false)
  // A request that arrives mid-sync is work, not noise — the radio coming back while the mount
  // fetch is still slow is exactly the report the technician has just finished. Dropping it strands
  // that report until the next page load, so it is queued and run when this one ends.
  const queued = useRef(false)

  const sync = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true
      return
    }

    inFlight.current = true
    setSyncing(true)
    try {
      do {
        queued.current = false
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setError('No signal. Showing what was saved on this phone.')
          break
        }

        // Queue first: the bundle fetched below is what tells the phone a report is already in, so
        // sending before reading means a report just completed shows as submitted rather than as an
        // empty form for a second visit.
        const flushed = await flushOutbox()
        setPending(await pendingCount())
        if (flushed.sessionExpired) {
          setSessionExpired(true)
          setError('Your session has ended. Sign in again to send this report.')
          break
        }
        if (flushed.errors.length > 0) {
          // Deliberately not fatal: a refused report must not stop the rest of the day's work from
          // syncing, and the queue is still on the phone for the next attempt.
          setError(flushed.errors[0])
        }

        const response = await fetch('/api/tech/sync', {
          cache: 'no-store',
          headers: { accept: 'application/json' },
        })
        if (!response.ok) {
          // A 401 means the session has gone; the next page load sends them to sign in. Saying so
          // here is better than silently keeping a cache the server will no longer accept.
          setSessionExpired(response.status === 401)
          setError(
            response.status === 401
              ? 'Your session has ended. Sign in again to sync.'
              : 'The server could not be reached. Showing what was saved on this phone.',
          )
          break
        }

        const bundle = (await response.json()) as SyncBundle
        await storeBundle(bundle)
        setLastSynced(new Date(bundle.generatedAt))
        setSessionExpired(false)
        if (flushed.errors.length === 0) setError(null)
        // Asked after the first successful sync, not at first paint: a tablet with nothing saved
        // yet has no reason to be granted persistent storage, and asking during page load is the
        // shape browsers drop or prompt on. Best-effort — a refusal only affects eviction.
        void navigator.storage?.persist?.().catch(() => undefined)
      } while (queued.current)
    } catch {
      // A network failure is not a bug: it is the normal state of a lift shaft.
      setError('No signal. Showing what was saved on this phone.')
    } finally {
      inFlight.current = false
      setSyncing(false)
    }
  }, [])

  const refreshPending = useCallback(async () => {
    setPending(await pendingCount())
  }, [])

  useEffect(() => {
    // Read from the phone's own cache, so these land even when the mount sync finds no signal.
    void pendingCount().then(setPending)
    void lastSyncedAt().then((value) => {
      if (value) setLastSynced((current) => current ?? value)
    })

    // The connection itself is subscribed to above; this only reacts to losing the radio.
    const onOffline = () => setError('No signal. Showing what was saved on this phone.')
    window.addEventListener('offline', onOffline)

    // Deferred a tick: the sync flips `syncing` before its first await, and doing that inside the
    // effect body renders twice for one commit. The timer also gives the cleanup something to cancel.
    const timer = setTimeout(() => void sync(), 0)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('offline', onOffline)
    }
  }, [sync])

  // Coming back online is new work, so it syncs. It subscribes after the initial sync above so a
  // mount never triggers two bundles at once.
  useEffect(() => {
    const onOnline = () => {
      // The page is the primary uploader, but ask the worker too: the technician may pocket the
      // tablet before this flush gets anywhere. Chrome ignores the registration if nothing queued
      // fails, so registering optimistically is cheap.
      void requestOutboxSync()
      void sync()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [sync])

  // The worker flushes the same queue with no page open. When it reports back, the line has to
  // change: "waiting to upload" after the worker has already sent it is a lie.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; result?: { errors?: string[]; sent?: number } }
        | null
      if (data?.type === 'tech-auth-expired') {
        setSessionExpired(true)
        setError('Your session has ended. Sign in again to send this report.')
        return
      }
      if (data?.type !== 'tech-sync-result') return
      void pendingCount().then(setPending)
      const first = data.result?.errors?.[0]
      if (first) setError(first)
      else if (data.result?.sent) setError(null)
    }

    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [])

  return (
    <TechSyncContext.Provider
      value={{ online, syncing, lastSynced, pending, error, sessionExpired, sync, refreshPending }}
    >
      {children}
    </TechSyncContext.Provider>
  )
}

export function useTechSync(): TechSyncState {
  const value = useContext(TechSyncContext)
  if (!value) throw new Error('useTechSync must be used inside <SyncProvider>.')
  return value
}
