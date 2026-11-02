/**
 * Asking the browser to wake the worker when the signal is back (slice 42).
 *
 * One tag, one queue. The worker's `sync` listener runs `flushOutbox` with no page open, which is
 * the only way a report queued in a lift uploads after the tablet is pocketed. Feature-detected and
 * silent: Chrome on Android is the target and everywhere else there is simply no background wake-up,
 * with the page's own `online` handler still in place.
 */

export const OUTBOX_SYNC_TAG = 'tech-outbox'

function supported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window
}

export async function requestOutboxSync(): Promise<void> {
  if (!supported()) return
  try {
    const registration = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
      sync?: { register(tag: string): Promise<void> }
    }
    await registration.sync?.register(OUTBOX_SYNC_TAG)
  } catch {
    // Best-effort: a browser that refuses this still uploads when a page is open.
  }
}
