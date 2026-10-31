/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker'
import { Serwist } from 'serwist'
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'

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
  runtimeCaching: defaultCache,
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
