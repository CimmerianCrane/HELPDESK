'use client'

import { useState, useSyncExternalStore } from 'react'
import { useTechSync } from '@/offline/use-tech-sync'

/**
 * Opting a tablet in to job alerts (slice 43).
 *
 * Two conditions shape this card. Permission is requested only on a tap — Chrome refuses a prompt
 * that is not tied to one, and a refusal is sticky for the origin. And the card waits until push is
 * configured *and* the first sync has succeeded: asking before either guarantees that the "yes" the
 * technician gives buys a notification nothing will ever send. Its own "should this show?" answer is
 * read from the browser rather than mirrored into state — a decision about permission is an external
 * store, the same shape as the install card.
 *
 * It sits beside the install card on `/m/jobs` because that is the one screen where setting up the
 * tablet belongs. Declining is remembered the same way — a decision about your own device should not
 * be asked twice a shift.
 */

const DISMISSED_KEY = 'tech.pushPromptDismissedAt'
const DISMISS_DAYS = 30

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function getOfferable() {
  if (typeof Notification === 'undefined' || !('PushManager' in window)) return false
  if (Notification.permission !== 'default') return false
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY))
    // Storage blocked reads as not dismissed: not remembering "no" is a smaller failure than never
    // offering at all.
    return !(Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000)
  } catch {
    return true
  }
}

export function PushPermission({ publicKey }: { publicKey: string | null }) {
  const { lastSynced } = useTechSync()
  const offerable = useSyncExternalStore(subscribe, getOfferable, () => false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Offering before the first sync would buy a "yes" for a notification nothing can send yet.
  if (!publicKey || !lastSynced || !offerable) return null

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()))
    } catch {
      // Nothing to remember with; the card just comes back next visit.
    }
    notify()
  }

  async function enable() {
    if (!publicKey) return
    setBusy(true)
    setError(null)
    try {
      // Only ever after the tap above: this is the promise Chrome holds us to.
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setError('Notifications are off for this app. Turn them on in the browser settings.')
        notify()
        return
      }

      const registration = await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          // Android's push service requires a visible notification for every push, which this app
          // sends; `userVisibleOnly` is not optional.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBytes(publicKey),
        }))

      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      })
      if (!response.ok) throw new Error('The server could not save this tablet.')
      // Permission is now 'granted', which `getOfferable` reads on the next render.
      notify()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not turn alerts on.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <p className="font-medium text-ink">Job alerts on this tablet</p>
      <p className="mt-1 text-sm text-muted">
        It chimes here when the office dispatches you a job, even with the app closed.
      </p>
      {error ? <p className="mt-2 text-sm text-neg">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void enable()}
          className="rounded-md bg-hivis px-3 py-2 font-medium text-ink active:bg-hivis-pale disabled:opacity-60"
        >
          {busy ? 'Turning on…' : 'Turn on alerts'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={dismiss}
          className="rounded-md border border-line px-3 py-2 text-sm text-ink active:bg-raised disabled:opacity-60"
        >
          Not now
        </button>
      </div>
    </div>
  )
}

/** VAPID keys are base64url; `subscribe` wants the raw bytes. */
function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
