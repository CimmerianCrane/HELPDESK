# PLAN-TABLET-APP.md — the technician Android tablet app

**Read this after `KICKOFF.md`.** It is the plan for turning the existing technician PWA into a
first-class Android tablet app. As at 31 Oct 2026 **slices 40–45 are built** — the app side is
complete and what remains is operational (VAPID keys, Play Console). The work continues the
numbering in `docs/PLAN.md`.

## Context

The technician side already exists as a working offline-first PWA under `src/app/(tech)/m/` — job
list, job sheet, service report with photos, parts and two signatures, a Dexie cache, an outbox with
idempotent client ids, and a Serwist service worker. But it was built for a 390px phone: the shell
caps everything at `max-w-lg` (512px), the manifest locks the install to portrait, there is no
install or update affordance, and the offline story only runs while a page is open. On a 10-inch
tablet it renders as a phone column floating in the middle of the screen.

The owner wants the product shipped as an Android tablet app for technicians, while office staff keep
the desktop website. Confirmed with the owner:

- **Android tablets**, installed with Add to Home Screen (no iOS work).
- Must open full-screen from the home screen, work with no signal, and keep itself up to date.
- Also needed: push notifications, barcode/QR scanning, background upload when signal returns.
- A store listing eventually — a Trusted Web Activity wrapping the same codebase, not a rewrite.

Nothing here changes the office UI or its routes. The manifest, the shell and every new affordance
stay inside `/m/`, so an office login that wanders onto a field route is still bounced to
`/dashboard`.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Tablet layout | Widen the single column (`max-w-lg md:max-w-4xl lg:max-w-6xl`) and let cards form two columns at `md`. **No two-pane list/detail router, no sidebar.** | Two-pane is a router rewrite (parallel routes) for a navigation that already works with a back tap. It can be added later without undoing this. |
| "Full-screen" | `display: 'standalone'` | That is the app-window-without-browser-chrome the owner asked for. `fullscreen` would hide the clock and battery for an eight-hour shift and break the safe-area assumptions. |
| Orientation | `orientation: 'any'` | Landscape is how a crane gets inspected. |
| Icons | Generate PNG 192 / 512 / 512-maskable from the two existing SVGs, commit them. | Chrome accepts SVG, but PNG keeps launcher rendering and the Play/TWA path deterministic. Generated once by a committed script, never at build time. |
| Updates | `skipWaiting: false`; a waiting worker activates when the app closes, or on a banner tap. | With `skipWaiting: true` a new worker takes over silently, and an open page can ask for chunks from a build it never loaded. |
| Install prompt | A dismissible card on `/m/jobs` using `beforeinstallprompt`. | One screen, one decision; the browser's own UI is the fallback. |
| Background upload | Background Sync API on the existing outbox (`sync` event, tag `tech-outbox`). | The outbox is already the queue; only the wake-up is new. |
| Push | `web-push` + a `PushSubscription` table, **technicians only**. | Hand-rolling VAPID/ECDH encryption is hundreds of lines of crypto with no upside. Dispatchers use the website and have no subscription to push to. |
| Scanning | `BarcodeDetector` + `getUserMedia`, no dependency. | Native in Android Chrome, including inside an installed PWA. Parts scanning is a separate later slice. |
| Store listing | Trusted Web Activity via Bubblewrap, last. | Produces a real Android App Bundle from this codebase. |

## Slices

Each slice ends with `npm run verify`. Slices that touch the worker, the manifest or the install
path also need `npm run build` — the dev server never exercises the service worker (Serwist is
disabled in development by design).

### Slice 40 — A tablet-shaped shell and an installable manifest

**Built 31 Oct 2026.** How it landed, and the two things this file did not anticipate, are in
`docs/HISTORY.md` ("Slice 40 — the tablet shell"): `/m/login` had to sit outside the `(tech)` layout
to avoid a redirect loop, and sign-out needed its own action (`techSignOutAction`) because the shared
one lands on `/login`, outside the app's scope. The tablet spec asserts computed grid tracks, not card
geometry — the seed gives this technician one job a day, so a geometry test skipped.

**Goal:** the field app fills a 768–1280px tablet and installs with a proper icon, name and
orientation. Also closes two existing gaps that matter the moment the tablet is shared.

**Files**

- `src/app/(tech)/layout.tsx` — `min-h-dvh`; header inner, main and nav inner all
  `max-w-lg md:max-w-4xl lg:max-w-6xl` with `px-4 md:px-6 lg:px-8`; `pt-[env(safe-area-inset-top)]`
  above the hazard band; main `pb-[calc(6rem+env(safe-area-inset-bottom))]`; add
  `viewportFit: 'cover'` to `viewport` (do not disable zoom); gate redirects an unauthenticated
  session to `/m/login` instead of `/login`.
- `src/components/tech/job-list.tsx` — the day group's `ul.space-y-3` becomes
  `space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0`. Shared by `/m/jobs` and the offline
  shell, so both gain it.
- `src/components/tech/report-form.tsx` — root becomes `space-y-5 pb-24 md:grid md:grid-cols-2
  md:items-start md:gap-5 md:space-y-0`; header and every template section `md:col-span-2`; Photos
  and Signatures `md:col-span-1`; photo grid `grid-cols-3 sm:grid-cols-4`; customer fields
  `grid-cols-1 sm:grid-cols-2`; signature pad `h-32 md:h-40`; submit bar
  `bottom-[calc(4rem+env(safe-area-inset-bottom))]` with the same width scale as the shell.
- `src/components/tech/tech-sign-out.tsx` — **two existing data-exposure/loss gaps**:
  - `clearCache()` clears Dexie only. Also delete every Cache Storage entry, or the next technician
    on a shared tablet can open the previous one's cached `/m/` documents and RSC payloads while
    offline. Do not unregister the worker.
  - If `pendingCount() > 0`, make sign-out two-step: try `flushOutbox()` first, then confirm
    "N reports have not uploaded; sign out and delete them?" — today it silently deletes them.
- `src/app/offline/page.tsx` — same width scale so the offline fallback does not look like a
  different app.
- `src/app/(tech)/m/manifest/route.ts` — `id: '/m/'`, `orientation: 'any'`, `theme_color: '#1f2328'`,
  `background_color: '#f5f6f7'` (the real `--color-anchor` / `--color-sheet`), `lang: 'en-SG'`,
  `categories: ['business', 'productivity']`, `prefer_related_applications: false`, and the PNG icon
  set. Update the comment that currently argues for SVG-only icons.
- `public/icons/tech-192.png`, `tech-512.png`, `tech-maskable-512.png` (new).
- `scripts/make-icons.ts` (new, run once) — renders the two existing SVGs at exact sizes through
  Playwright's Chromium and writes the PNGs. Kept in `scripts/` as the record of how they were made;
  not part of any build. (A `next/og` `ImageResponse` route is the alternative; it trades a committed
  binary for a build-time rendering risk, so it is not the default.)
- `src/app/m/login/page.tsx` (new) — a login screen **inside** the `/m/` scope, reusing
  `signInAction` (`src/app/(auth)/login/actions.ts`, which already accepts a safe `next`) with
  `next=/m/jobs`, and the same `LoginForm` the website uses. In standalone mode a redirect to
  `/login` leaves the app for Chrome.
- `src/offline/use-tech-sync.tsx` — call `navigator.storage.persist()` after the first successful
  sync, not at first paint. Catch `QuotaExceededError` in the photo path and say "This tablet is out
  of storage — sync a report to free space" rather than a generic read failure.

**Tests**

- `tests/e2e/tech.spec.ts` — manifest assertions: `id`, `orientation: 'any'`, PNG `192x192` and
  `512x512`, a `maskable` entry, theme/background colours.
- New `tests/e2e/tech-tablet.spec.ts` — at 800×1280: no horizontal overflow, two-column job cards,
  two-column report form, submit bar clears the bottom nav.
- `playwright.config.ts` — a `tablet` project (`viewport: { width: 800, height: 1280 }`,
  `hasTouch: true`, `testMatch` for the tablet spec). `devices['Galaxy Tab S4 landscape']` is also
  available if a device fingerprint is wanted.

**Risk:** the `md:` breakpoint is 768px, exactly tablet-portrait width — check 768, 1024 and 1280 by
eye, not only in the emulator. Removing `'use client'` from `outbox.ts`/`db.ts` belongs to slice 42.

---

### Slice 41 — Install and update without losing work

**Built 31 Oct 2026.** How it landed, and where this file was wrong, are in `docs/HISTORY.md` ("Slice 41 —
install and update"). Two corrections: the install card renders even when `beforeinstallprompt` never
fires (it points at Chrome's own menu), because a hidden card installs nothing; and the event has to be
captured by an inline script in the tech layout, since it fires before React hydrates.

**Goal:** a technician can install the app from inside it, and a new deploy reaches them without
interrupting a report.

**Files**

- `src/components/tech/install-prompt.tsx` (new, client) — captures `beforeinstallprompt`, stores it,
  renders a card on `/m/jobs` only (never on `/report`); `prompt()` only on tap; hidden when
  `matchMedia('(display-mode: standalone)').matches` or after `appinstalled`; dismissal in
  `localStorage['tech.installPromptDismissedAt']`, shown again after 30 days. If the event never
  fires, fall back to "Chrome menu → Add to Home screen".
- `src/components/tech/app-update.tsx` (new, client) — mounts in the tech layout. Checks
  `registration.update()` on `visibilitychange` and every six hours; when `registration.waiting`
  exists shows a banner. "Update now" posts `{ type: 'SKIP_WAITING' }`, waits for `controllerchange`
  and reloads once. On a `/report` route the banner says "your draft is saved on this tablet" and
  still requires the tap. **Never reload by itself.**
- `src/app/sw.ts` — `skipWaiting: false` (keep `clientsClaim: true`) plus a `message` handler for
  `SKIP_WAITING`. A waiting worker activates naturally once no client is open, so a closed app
  updates on its next cold start.
- `src/components/tech/report-form.tsx` — flush the current draft on `pagehide` and on
  `visibilitychange === 'hidden'`, in addition to the existing 1.5s debounce. This closes the only
  realistic loss window a reload or update banner can open.
- `next.config.ts` — `reloadOnOnline: false` on `withSerwistInit`. Serwist's default reloads when the
  network returns; `SyncProvider` already handles that, and a mid-report reload loses up to 1.5s.
- `src/components/tech/sync-status.tsx` + `src/offline/use-tech-sync.tsx` — when the sync gets a 401,
  the line says "Session ended — sign in again" and links to `/m/login`.
- `src/server/auth/config.ts` — **owner decision:** `maxAge: 24h`, `updateAge: 1h` for a shift-long
  tablet. Safe because `getAuthContext()` re-reads the user from the database on every request, so
  role changes and deactivation still take effect immediately; only the token lifetime changes. If
  the owner prefers, keep 12h — the outbox and drafts survive an expiry, the technician just signs in
  again.

**Tests:** e2e asserts the install card renders on `/m/jobs` in the phone project (a browser context
is not standalone). Unit-test the dismissal rule if it is extracted. Manual update check: build,
start, change a visible string, reload, confirm the banner, update, confirm the draft survived.

**Risk:** both prompts are invisible under `npm run dev` (no worker) and the install card depends on
`beforeinstallprompt`, which Chrome suppresses after repeated dismissals. The card is an affordance,
not the only way in.

---

### Slice 42 — Offline that keeps working, and uploads that finish on their own

**Built 31 Oct 2026.** Landed as written. Two things worth knowing: the retry classifier was extracted
to `isRetryableError` in `outbox.ts` so it is unit-tested rather than living in the worker, and the
existing offline e2e had been skipping itself in production builds too (it navigated before the
sign-in redirect landed) — that is now fixed and runs for real. Details in `docs/HISTORY.md`.

**Goal:** close the real gaps in today's worker, and let a queued report upload after the tablet is
pocketed.

**Files**

- `src/app/sw.ts`
  - Prepend one runtime rule before `defaultCache`: `NetworkOnly` for any same-origin `GET` whose
    pathname starts with neither `/m/` nor `/_next/`. Today the generic `apis` rule caches
    `/api/tech/sync` for 24h — contradicting this file's own comment and risking a stale bundle on a
    "connected" dead network — and the HTML/RSC rules cache office pages.
  - Add a `sync` listener for tag `tech-outbox`: `event.waitUntil(flushOutbox())`. **Reject only
    when the failure is retryable** (network, 5xx, 429) so Chrome backs off and retries. **Resolve**
    on 401/403 (a dead session must not burn retries for days) and post `{ type: 'tech-auth-expired' }`
    to clients; resolve otherwise and post `{ type: 'tech-sync-result', result }`.
  - Import the outbox as `../offline/outbox`, not `@/offline/outbox`, so the worker build does not
    depend on the alias.
- `src/offline/outbox.ts` and `src/offline/db.ts` — remove the `'use client'` directive: neither has
  React or `window`, and a worker must be able to import them.
- `src/offline/outbox.ts` — add a `SyncHttpError` carrying `status`, and `retryable` / `authExpired`
  on `FlushResult`. On 401/403 from `upload-url` or `/api/tech/sync`, abort the run immediately,
  **do not increment `attempts`**, and report `authExpired`. Wrap `run()` in
  `navigator.locks.request('tech-outbox', …)` (feature-detected) so a page flush and a worker flush
  cannot upload the same bytes or race `finish()`; the existing `inFlight` memo only dedupes one
  context.
- `src/offline/background-sync.ts` (new) — `'SyncManager' in window` guard, then
  `(await navigator.serviceWorker.ready).sync.register('tech-outbox')`. Register at outbox enqueue,
  and on `online` while anything is pending.
- `src/components/tech/report-form.tsx` — register the tag immediately after `techDb.outbox.put`.
- `src/offline/use-tech-sync.tsx` — listen for the worker's `tech-sync-result` /
  `tech-auth-expired` messages and refresh `pending` and the error line.
- `src/components/tech/sync-status.tsx` — when queued and the browser supports it, say "will upload
  when signal returns" instead of only "waiting to upload".

**Design:** the outbox is ordered (files first, then the report) and idempotent by client id, so the
worker can run exactly what the page runs. No new queue and no new endpoint — only a wake-up.

**Tests:** unit-test the retry classifier (401/403 vs 5xx/429/network). Keep the existing
`setOffline` report e2e. Manual on a real device: submit offline, close the app, restore the
network, confirm the report lands without reopening. Playwright cannot simulate Chrome's background
scheduling reliably.

**Risk:** Background Sync is Chrome-on-Android and best-effort — Doze or a force-stop can delay it.
The page's `online` handler stays the primary path, and a report is never marked sent until the
server confirms. A permanently rejected report retries a few times before Chrome gives up; it stays
on the device.

---

### Slice 43 — Push when a job is dispatched

**Built 31 Oct 2026.** How it landed is in `docs/HISTORY.md` ("Slice 43 — push when a job is
dispatched"). Two corrections to the plan below: the subscribe/unsubscribe logic lives in
`src/server/notify/push.ts` as `subscribePush` / `unsubscribePush` taking an `AuthContext`, with the
route a thin handler over it (`CLAUDE.md`: logic in the service, so the tests can use a transaction);
and the `WEB_PUSH` notification row is written per tablet actually reached, not per recipient — a
technician with no installed app is not a broken channel. `web-push` is installed and the migration
is applied; the one remaining step is operational — set the three VAPID env vars, without which push
is silently off.

**Goal:** a technician's tablet chimes when the office dispatches a job, even with the app closed.

**Files**

- `prisma/schema.prisma` — `model PushSubscription` (`id`, `userId`, `endpoint @unique`, `p256dh`,
  `auth`, `userAgent?`, `createdAt`, `lastSeenAt`, `failureCount`, `disabledAt?`,
  `@@index([userId])`), `User.pushSubscriptions`, and `WEB_PUSH` on `NotificationChannel`.
  Migration via `npm run db:migrate`; `npm run db:deploy` on the deploy path as usual.
- `package.json` — `web-push` and `@types/web-push` (server-only, Node runtime; fine on Vercel).
- `src/lib/env.ts` — `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, all
  optional. Push is silently off when they are unset, matching the existing `EMAIL_DRIVER` pattern —
  the app must not crash without them. Generate with `npx web-push generate-vapid-keys`.
- `src/app/api/push/subscribe/route.ts` (new) — `POST` upserts by `endpoint`, reassigning it to the
  signed-in user (Zod-validated endpoint + keys); `DELETE` deletes by `endpoint` **and** `userId`.
  Both require a session; a subscription belongs to the caller, never to an id in the body.
- `src/server/notify/push.ts` (new) — VAPID configured once; `sendPushToUsers(userIds, { title, body,
  link })` sends, sets `disabledAt` on 404/410 rather than failing the dispatch, and updates
  `lastSeenAt`/`failureCount`. Best-effort after the transaction, exactly like the email adapter.
- `src/server/schedule/dispatch.ts` — after the IN_APP/EMAIL rows commit, push to the technicians the
  existing loop just notified, and record a `WEB_PUSH` row per recipient.
- `src/app/sw.ts` — `push` (`showNotification` with the body and `data.url`, `tag: jobId` so repeat
  dispatches collapse) and `notificationclick` (validate same-origin and `/m/`, focus an existing
  client or `openWindow`).
- `src/components/tech/push-permission.tsx` (new, client) — a card on `/m/jobs` next to the install
  card, shown only when `Notification.permission === 'default'`, `PushManager` exists and the first
  sync has succeeded. One tap requests permission and subscribes; the public key is read server-side
  in the layout and passed as a prop. Never call `requestPermission()` without a tap.
- `src/components/tech/tech-sign-out.tsx` — `pushManager.getSubscription()?.unsubscribe()` and
  `DELETE /api/push/subscribe`, or the previous technician keeps getting job alerts on a shared
  tablet.

**Design:** one notification path. The dispatch already creates an IN_APP row per technician; push is
the same message on a second channel. P1 alerts stay in-app and email — dispatchers are at a desk and
have no tablet subscription.

**Tests:** integration for the route (auth required, upsert idempotent, delete scoped to caller,
invalid keys rejected); unit for the payload shape and the `/m/` link guard. Real delivery is a manual
device check — DevTools cannot exercise real VAPID end to end.

**Risk:** VAPID keys are a deployment step in Vercel, and the public key is inlined at build. Android 13+
asks for notification permission; an installed PWA is the reliable case, which is why this follows
slice 41.

---

### Slice 44 — Scan a crane QR label

**Built 31 Oct 2026.** Landed mostly as written, with three corrections. `qrValue` alone was not
enough: the scanner needs a *client* parser, and the generator module is server-only (it imports
`node:crypto`), so the token pattern and `craneQrValueFromPayload` moved to `src/lib/cranes/qr.ts`
and the server module re-exports them — no caller changed except the payload parser, which was
added. `craneQrPayload` (`qrPayload` in the plan) is not sent to the phone: the client compares the
parsed token to `qrValue`, so the URL would have been dead weight in the cache. And `job-sheet.tsx`
became a client component — it now renders the scanner and reads Dexie — which changes how it
renders in the offline shell (it still does; both are client trees).

**Goal:** replace typing an asset tag with the camera, using the QR labels already printed.

**Files**

- `src/server/tech/my-jobs.ts` — add `qrValue` to `TechCrane` and the two select/map sites that build
  it (job detail and sync bundle). No Dexie schema change — the cached crane object simply gains a
  field.
- `src/lib/cranes/qr.ts` (new) — `isCraneQrValue`, `craneQrPayload` and `craneQrValueFromPayload`, shared
  by the server generator and the tablet. The payload parser accepts the URL, a bare token (typed off
  a damaged label, any case) and rejects junk, asset tags and paths that are not `/c/<token>`.
- `src/components/tech/qr-scanner.tsx` (new, client) — feature-detects `BarcodeDetector`, streams
  `getUserMedia({ video: { facingMode: 'environment' } })` into a full-screen `<video playsinline
  muted>`, scans on an interval until a match, and always stops every track in `finally`. Manual entry
  remains for a damaged label.
- `src/components/tech/job-sheet.tsx` — a "Scan crane" action in the cranes section: parse the payload
  locally, match against `job.cranes` then the cranes of every job cached on the tablet, and open that
  crane's report or that job. Unmatched says so rather than guessing.
- `src/components/tech/report-form.tsx` — "Verify crane label" in the header (matches / different
  crane). Verification only; do not silently switch crane mid-report.

**Design:** the printed label URL is not changed and `/c/` is not added to the manifest scope — old
labels keep working, and the in-app scanner never needs to navigate there. Part barcodes are
deliberately deferred: `Part.barcode` exists but has no admin UI and is not in the tech bundle.

**Tests:** `tests/unit/crane-validation.test.ts` covers the payload parser (URL, bare token, asset
tag, junk, wrong path) — that is the part that can be wrong. Camera is manual on a device, including
airplane mode.

**Risk:** `getUserMedia` needs HTTPS, so this works on the deployed URL, not `npm run dev:lan`.
`BarcodeDetector` is Chromium/Android only and may depend on Play Services; where it is absent the
button does not render. A crane assigned after the last sync is not scannable offline — the message
says so. A label printed under an old domain still resolves: only the path is read.

---

### Slice 45 — A Play Store listing (Trusted Web Activity)

**Built 31 Oct 2026.** Landed as written with two corrections: a route file may only export HTTP
methods and route config, so the pure builder lives in `src/lib/assetlinks.ts` and the route is a
thin handler; and the fingerprints are checked by hand against `next start` (200/404), since there is
no database-free way to exercise a rewrite in unit tests. Details in `docs/HISTORY.md`. Everything
after the code is Play Console work — see the README runbook.

**Goal:** ship the same app as an Android App Bundle, with no second codebase.

**Files**

- `src/app/api/assetlinks/route.ts` (new) — public, no auth, returns the Digital Asset Links JSON
  from `ANDROID_PACKAGE_NAME` and `ANDROID_SHA256_FINGERPRINTS` (comma-separated), Zod-validated;
  `Cache-Control: public, max-age=300`; 404 when unset. The builder itself is
  `src/lib/assetlinks.ts` (route files cannot export helpers).
- `next.config.ts` — rewrite `/.well-known/assetlinks.json` → `/api/assetlinks` (a route directory
  containing a dot is avoidable).
- `src/lib/env.ts` — the two optional env vars above.
- `twa-manifest.json` (new, committed) — Bubblewrap config: `host` from `APP_BASE_URL`,
  `startUrl: '/m/jobs'`, `scope: '/m/'`, manifest URL `/m/manifest`.
- `README.md` — a "Play Store" runbook: Play Console account, upload key, `bubblewrap init` against
  the deployed `/m/manifest`, `bubblewrap build`, upload the AAB, review.

**Design:** the only app-side code a TWA needs is Digital Asset Links. Everything else is console and
signing work, deliberately kept out of the repo — never commit the keystore or the generated Android
project. Include both the upload-key and the Play App Signing fingerprint (the second only exists after
the first upload).

**Tests:** `GET /.well-known/assetlinks.json` after deploy returns the expected package and
fingerprints, and 404s when unset; Google's Asset Links tester; install the AAB via internal testing
and confirm there is no URL bar.

**Risk:** the only slice with an external dependency (Play Console, a review, a $25 account) and it
can be deferred indefinitely without holding up 40–44. Google rejects "just a wrapped website" apps
that offer no offline or native value — this app's offline mode, push and scanner are the answer, so
the earlier slices must land first. A TWA is still the web app: web changes ship without review, but
the wrapper version itself needs a Play update.

---

## Cross-cutting notes

- **Shared tablet and cached data.** Sign-out must clear Cache Storage as well as Dexie (slice 40).
  An *expired* session cannot do that safely — clearing would delete unsent reports — so an expired
  session leaves cached customer data readable through the offline fallback until someone signs in.
  Accepted for now (devices are assigned to a technician); the two-step sign-out is the guard.
- **Plain HTTP is still unsupported.** Service worker, `getUserMedia` and `crypto.randomUUID` all need
  a secure context. Tablet testing happens against the deployed HTTPS URL or `npm run build && npm
  start` on localhost — never `http://192.168.x.x`. See `KICKOFF.md`.
- **The worker still registers at scope `/`.** Harmless once slice 42 stops it caching office
  documents and API responses; narrowing the scope would orphan the registration on devices that
  already installed the old build.
- **`/m/login` is inside the installed app's scope**, so an expired session no longer leaves the app
  for Chrome. It loses the deep link (login always returns to `/m/jobs`) — acceptable, and easy to
  widen later.
- **Offline deep links** rely on the `/offline` fallback rendering from `window.location`. Verify that
  a client-side RSC navigation made while offline still falls back to a hard navigation; if it does
  not, add an explicit offline handler in `job-list.tsx`.
- **Offline PDF** is not a goal. The brief asks for an on-device customer summary, which the report
  view already gives from Dexie; `@react-pdf/renderer` must never enter the service worker.

## Verification

Per slice: `npm run verify`; `npm run test:integration` for slices 43 and 45; `npm run build` for
anything touching the worker.

**Layout** — `npx playwright test --project=tablet`; the tablet spec asserts 800×1280 with no
horizontal scroll, two-column job cards and report form, and a submit bar clear of the nav.

**Service worker (production build only)** — `npm run build && npm start`, then Chrome DevTools →
Application:

- Manifest: `id`, `start_url`, `scope`, `display`, PNG icons, maskable preview, no warnings.
- Service Workers: one controller; the update banner appears after a redeploy and activates on tap.
- Cache Storage: cleared by sign-out, repopulated on the next online load.
- IndexedDB: `cimmerian-tech` rows, quota estimate, persist flag set.
- Background Services: register `tech-outbox`, go offline, close, restore the network.
- Push: subscribe, dispatch a job, click the notification, confirm the job opens.

**Real Android tablet** — install from Chrome, launch standalone, rotate both ways, run the full
offline drill (job → report → photos → both signatures → submit → kill and reopen), restore the
network with the app closed, let a session expire, sign out with a pending report, and scan a printed
label in airplane mode.

## Docs to update as the work lands

`KICKOFF.md` (where the build stands), `docs/HISTORY.md` (the traps: the `/api/` cache rule,
`reloadOnOnline`, SVG-vs-PNG icons, `skipWaiting`, Web Locks, TWA), `docs/ASSUMPTIONS-LOG.md` (tablet
layout choice, orientation, `/m/login`, update banner, push scope, sign-out cache clearing, TWA),
`docs/PLAN.md` (slice table rows 40–45), `README.md` (install, offline QA, Play Store).
