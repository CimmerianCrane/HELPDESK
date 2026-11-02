/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker'
import { NetworkOnly, Serwist } from 'serwist'
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
// Relative, not `@/`: the worker is built by esbuild, and this file must not depend on the alias.
import { flushOutbox } from '../offline/outbox'

/**
 * The service worker.
 *
 * Its job is narrow and worth stating, because a service worker that tries to do more than this is
 * how a web app ends up serving last week's prices: keep the app's own pages so the technician app
 * opens in a basement, and keep the shared JavaScript and CSS so a page still works when it is
 * served from that cache. It never caches `/api/tech/sync` — that request is the one the phone
 * makes *because* it wants the truth, and a cached answer would look exactly like a fresh one.
 *
 * `defaultCache` covers Next's App Router payloads (documents, RSC, static chunks). The fallback
 * entry is what an uncached page gets with no network.
 *
 * Updates are opt-in (slice 41). `skipWaiting: false` means a new worker waits until the technician
 * taps the banner, because an installed app swaps workers silently and an open report can then ask a
 * new build for JavaScript it never loaded. A closed app updates on its next cold start.
 *
 * Background Sync (slice 42) runs the same `flushOutbox` the page runs, with no page open. The
 * outbox is ordered and idempotent, so there is no second queue and no second endpoint.
 */
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      // Everything that is neither the technician app nor a build asset goes straight to the
      // network. `defaultCache`'s generic `apis` rule cached `/api/tech/sync` for a day (the one
      // request that must always be fresh) and its document rules cached office pages on a worker
      // that is registered at scope `/`. Requests that fail here surface as failures, not as
      // plausible-looking stale data.
      matcher({ request, url }) {
        if (request.method !== 'GET') return false
        if (url.origin !== self.location.origin) return false
        return !url.pathname.startsWith('/m/') && !url.pathname.startsWith('/_next/')
      },
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher({ request }) {
          // Only the phone's routes. An office user with no connection should see the browser's
          // offline page, not a technician's job list.
          return request.destination === 'document' && new URL(request.url).pathname.startsWith('/m/')
        },
      },
    ],
  },
})

serwist.addEventListeners()

// The update banner's "Update now". Only a message from the page activates the waiting worker.
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})

/**
 * Background Sync (slice 42): upload the queue after the tablet is pocketed.
 *
 * Rejecting the event is what tells Chrome to retry later with backoff, so it is done only when the
 * failure could pass — no signal, a 5xx, a 429. An ended session or a refused report resolves: a
 * dead session must not make the browser retry for days, and the technician is told instead.
 * Best-effort by design (Doze, a force-stop); the page's `online` handler is still the main path.
 */
self.addEventListener('sync', (event) => {
  const syncEvent = event as ExtendableEvent & { tag?: string }
  if (syncEvent.tag !== 'tech-outbox') return

  syncEvent.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ includeUncontrolled: true })
      // A throw from `flushOutbox` itself means the queue could not be read — also worth a retry.
      const result = await flushOutbox()
      for (const client of clients) {
        client.postMessage(
          result.sessionExpired
            ? { type: 'tech-auth-expired' }
            : { type: 'tech-sync-result', result },
        )
      }
      if (result.retryable) throw new Error('The queue was not all sent; retry when signal returns.')
    })(),
  )
})

/**
 * Push (slice 43): a job was dispatched.
 *
 * The payload is written by the server and shaped by `sendPushToUsers`. The link is re-checked here
 * rather than trusted: anything but a `/m/` path opens nothing, because a notification is a tap that
 * leaves the app's own power to validate anything. `tag` is the job id, so a re-dispatch replaces the
 * first banner instead of stacking a second one for the same visit.
 */
self.addEventListener('push', (event) => {
  const pushEvent = event as PushEvent
  let payload: { title?: string; body?: string; link?: string; tag?: string } = {}
  try {
    payload = (pushEvent.data?.json() ?? {}) as typeof payload
  } catch {
    // A push with no readable body is still a dispatch; the title says so.
  }
  const title = payload.title ?? 'New job dispatched'
  const link = payload.link
  pushEvent.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body ?? '',
      tag: payload.tag,
      data: { url: link && link.startsWith('/m/') && !link.startsWith('//') ? link : '/m/jobs' },
      icon: '/icons/tech-192.png',
      badge: '/icons/tech-192.png',
    }),
  )
})

/**
 * Tapping the notification opens the job. An already-open app is focused rather than a second window
 * being stacked on top of it, which on a tablet is the difference between returning to a shift's work
 * and starting again.
 */
self.addEventListener('notificationclick', (event) => {
  const clickEvent = event as NotificationEvent
  clickEvent.notification.close()

  const data = (clickEvent.notification.data ?? {}) as { url?: string }
  const url = data.url && data.url.startsWith('/m/') ? data.url : '/m/jobs'
  const target = new URL(url, self.location.origin).href

  clickEvent.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clients) {
        if (client.url === target && 'focus' in client) return client.focus()
      }
      if (clients.length > 0 && 'focus' in clients[0]) {
        const focused = clients[0]
        await focused.focus()
        // The window can be navigated once it is focused; `navigate` is not on every client type.
        if ('navigate' in focused) return focused.navigate(target)
        return undefined
      }
      return self.clients.openWindow(target)
    })(),
  )
})
