'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * A new deploy reaching an installed app, without taking a report away (slice 41).
 *
 * The worker no longer activates itself (`skipWaiting: false`), so a new build waits while the
 * tablet is open. This is the only thing that tells it to take over — and it never does so on its
 * own. A closed app updates on its next cold start; an open one updates when the technician taps.
 *
 * The draft is flushed on `pagehide` by the report form, so the reload the tap causes costs at most
 * the debounce window. On a report the banner says where the draft is, because "update now" in the
 * middle of a sign-off is the one place it needs reassuring.
 */

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/**
 * Read by the `controllerchange` listener, which is subscribed once. A first-time claim
 * (`clientsClaim`) fires that event too, and reloading then would be a reload for nothing.
 */
const applying = { current: false }

export function AppUpdate() {
  const pathname = usePathname()
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let registration: ServiceWorkerRegistration | undefined
    let disposed = false

    const check = async () => {
      try {
        registration = await navigator.serviceWorker.getRegistration('/')
        if (disposed || !registration) return
        await registration.update()
        setWaiting(registration.waiting)
      } catch {
        // A failed check is not news: the next one, or the next cold start, will do.
      }
    }

    void check()
    const timer = setInterval(() => void check(), CHECK_EVERY_MS)
    // An app resumed from the background may have been away for a shift.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    const onController = () => {
      if (!disposed && applying.current) window.location.reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    navigator.serviceWorker.addEventListener('controllerchange', onController)

    return () => {
      disposed = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      navigator.serviceWorker.removeEventListener('controllerchange', onController)
    }
  }, [])

  if (!waiting) return null

  function update() {
    if (!waiting) return
    applying.current = true
    setBusy(true)
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  return (
    <div
      role="status"
      className="border-b border-on-anchor-muted/30 bg-anchor-soft px-4 py-2 md:px-6 lg:px-8"
    >
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3 md:max-w-4xl lg:max-w-6xl">
        <p className="min-w-0 text-xs text-on-anchor">
          A newer version of the app is ready.
          {pathname.includes('/report') && ' Your draft is saved on this tablet.'}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={update}
          className="shrink-0 rounded-md bg-hivis px-3 py-1 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {busy ? 'Updating…' : 'Update now'}
        </button>
      </div>
    </div>
  )
}

