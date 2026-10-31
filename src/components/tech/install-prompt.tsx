'use client'

import { useSyncExternalStore } from 'react'

/**
 * The one chance to turn a Chrome tab into an installed app (slice 41).
 *
 * `beforeinstallprompt` fires once, early, and cannot be re-asked for — so it is captured in a
 * module-level variable by a script that runs before React hydrates (in the tech layout). This
 * component only reads what that stored. Until it fires, the card shows the browser's own route in
 * instead of a button that does nothing: Chrome's menu → Add to Home screen.
 *
 * The card is meant to be seen in a browser tab, which is also what the e2e test renders. Dismissal
 * lasts 30 days rather than for ever: a technician who said "not now" on day one is exactly the
 * person who wants it a fortnight later.
 */

const DISMISSED_KEY = 'tech.installPromptDismissedAt'
const DISMISS_DAYS = 30

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window {
    __techInstallPrompt?: BeforeInstallPromptEvent
    __techInstallListeners?: Set<() => void>
  }
}

const emit = () => window.__techInstallListeners?.forEach((listener) => listener())

function subscribe(onChange: () => void) {
  window.__techInstallListeners ??= new Set()
  window.__techInstallListeners.add(onChange)
  window.addEventListener('appinstalled', onChange)
  return () => {
    window.__techInstallListeners?.delete(onChange)
    window.removeEventListener('appinstalled', onChange)
  }
}

const getPrompt = () => window.__techInstallPrompt ?? null
const getDismissed = () => {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY))
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch {
    // Storage can be blocked; a missing preference is not worth a broken screen.
    return false
  }
}
const getInstalled = () => window.matchMedia('(display-mode: standalone)').matches

export function InstallPrompt() {
  const prompt = useSyncExternalStore(subscribe, getPrompt, () => null)
  // Hidden on the server: it cannot know whether this browser can install, and the tabs that cannot
  // are the ones this card is not for.
  const dismissed = useSyncExternalStore(subscribe, getDismissed, () => true)
  const installed = useSyncExternalStore(subscribe, getInstalled, () => true)

  if (dismissed || installed) return null

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()))
    } catch {
      // Nothing to remember with; the card just comes back next visit.
    }
    emit()
  }

  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <p className="font-medium text-ink">Install on this tablet</p>
      <p className="mt-1 text-sm text-muted">
        The app then opens full screen and works with no signal.
        {!prompt && ' Use your browser’s menu and choose “Add to Home screen” or “Install app”.'}
      </p>
      <div className="mt-3 flex gap-2">
        {prompt && (
          <button
            type="button"
            onClick={() =>
              void prompt
                .prompt()
                .then(() => prompt.userChoice)
                .then(({ outcome }) => {
                  if (outcome === 'dismissed') dismiss()
                })
            }
            className="rounded-md bg-hivis px-3 py-2 font-medium text-ink active:bg-hivis-pale"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md border border-line px-3 py-2 text-sm text-ink active:bg-raised"
        >
          Not now
        </button>
      </div>
    </div>
  )
}
