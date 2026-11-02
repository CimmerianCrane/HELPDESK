# Performance baseline — loading pass

Measured 3 Nov 2026 on `perf/loading-pass`, against a **production build**
(`npm run build && npx next start -p 3001`). The dev server was not used: it compiles on first hit
and its unminified `main-app.js` alone is 3.1 MB.

## Method

- Lighthouse 13.5.0, mobile preset: Slow 4G, 4× CPU throttling, fresh Chrome profile per run.
- Three runs per page; the table reports the **median**.
- `/login` is public. `/dashboard` and `/m/jobs` redirect without a session, so the harness signs in
  with Playwright first and passes the session cookie to Lighthouse via `extraHeaders`
  (`scripts/perf.mjs`).
- `/dashboard` uses the demo admin; `/m/jobs` uses the demo technician, because the field layout
  sends an office login to `/dashboard`.
- **INP is not measured.** Lighthouse lab data cannot produce it; TBT is reported as the proxy.
- **The service-worker precache is not in Lighthouse's `total-byte-weight`.** It is a background
  install, not a page request, so it is measured separately below. That is the number a first-time
  visitor actually pays.

Reproduce:

```bash
npm run build
# `next start` runs as production, and src/lib/Env.ts rejects a localhost APP_BASE_URL and requires
# CRON_SECRET. Throwaway values satisfy the guard; they are not read by the measured pages.
APP_BASE_URL=http://127.0.0.1:3001 CRON_SECRET=local npx next start -p 3001
PERF_BASE_URL=http://localhost:3001 npm run perf -- baseline
# make the change, rebuild, restart, then:
PERF_BASE_URL=http://localhost:3001 npm run perf -- after
```

Raw medians are written to `.lighthouse/<label>.json`.

## Lighthouse — before and after

| Page | LCP | CLS | TBT | FCP | Speed Index | TTFB | Bytes | Score |
|---|---|---|---|---|---|---|---|---|
| `/login` before | 2335 ms | 0.000 | 58 ms | 1368 ms | 1368 ms | 10 ms | 235.6 KB | 98 |
| `/login` after | 2320 ms | 0.000 | 32 ms | 1364 ms | 1364 ms | 11 ms | 235.6 KB | 98 |
| `/dashboard` before | 3163 ms | 0.000 | 116 ms | 1363 ms | 1363 ms | 189 ms | 312.9 KB | 92 |
| `/dashboard` after | 3158 ms | 0.000 | 103 ms | 1363 ms | 1363 ms | 158 ms | 312.9 KB | 93 |
| `/m/jobs` before | 3470 ms | 0.000 | 181 ms | 1364 ms | 1364 ms | 157 ms | 320.4 KB | 88 |
| `/m/jobs` after | 3356 ms | 0.000 | 214 ms | 1367 ms | 1367 ms | 260 ms | 288.8 KB | 88 |

The page metrics barely move, and that is the honest result: these screens were already in the
green. The changes below target the **first-visit install**, which Lighthouse does not count.

## Service-worker precache — the actual first-visit cost

The worker is registered at scope `/` on every page, so its precache is downloaded by every first
visit, including the public login. `@serwist/next` 9.5.13 rejects `globIgnores` at runtime despite
advertising it; the filter is applied through the supported `manifestTransforms` hook in
`next.config.ts`.

| | Entries | Raw | Gzip |
|---|---|---|---|
| Before | 143 | 1,940.0 KB | 854.5 KB |
| After | 74 | 1,068.8 KB | 406.6 KB |
| **Saved** | **−69** | **−871.2 KB (−44.9%)** | **−447.9 KB (−52.4%)** |

Gzip figures are `zlib.gzipSync(level 9)` over the built files; the CDN's `Content-Encoding` may
differ by a few KB.

What was removed, and why it was safe:

| Removed | Raw | Why |
|---|---|---|
| 49 `(office)` route chunks | 164.4 KB | Office screens are online-only. The field app is the only offline surface and does not import them. |
| 17 non-latin `.woff2` files | ~238 KB | The fonts declare `subsets: ['latin']`; only the five `.p.woff2` faces are ever selected. |
| `framework-*.js`, `main-*.js` | ~364 KB | Pages Router leftovers. This app is App Router only; its entry is `main-app-*`, which stays. |
| `polyfills-*.js` | ~110 KB | The tag is `nomodule`; a browser able to install a service worker never runs it. |

Kept on purpose: `main-app-*`, the five latin `.p.woff2` files, the seven `(tech)` chunks, all shared
chunks, the CSS bundle, and the `/offline` fallback.

## Other changes

- `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` on `/cimmerian-mark.png`
  and `/icons/*`. These filenames are not hashed, so `immutable` would strand a repainted logo;
  stale-while-revalidate does not.
- `/sw.js` stays `public, max-age=0, must-revalidate`. A year-long cache there would stop updates
  reaching installed phones.
- Deleted the unreferenced `public/icons/cimmerian-512.png` (127,435 bytes). It was mentioned only
  in `docs/UI-REVIEW.md`.
- Fonts were **not** preloaded. CLS is 0.000 and `display: 'swap'` plus `adjustFontFallback` is
  already the correct pattern; a blind preload competes with the CSS and JS that paint the first
  frame.

## Fixed in passing (pre-existing, not a performance change)

Running the technician/tablet e2e suite exposed an unrelated bug: the CSP's `connect-src` did not
allow `data:`, but the offline outbox uploads a signature by `fetch`ing the data URL stored on the
phone (`src/offline/outbox.ts`). The browser blocked that fetch, so an offline report could be
saved locally but never uploaded. The CSP introduced in `e676779` had this gap; `connect-src` now
allows `data:`, matching the `img-src data:` already needed for the form's previews. The full
technician and tablet suites pass, including the offline report round trip.

## Deliberately not changed

- **Images / formats**: eight public files, all sized, `next/image` already negotiates WebP.
- **Lazy-loading**: there is no heavy below-the-fold media to defer.
- **Third-party scripts**: there are none.
- **Dead-code sweep**: 46 client components, no library bloat; churn without a measured problem.
- **PDF renderer**: already server-only and absent from every client chunk.
- **Auth/data fetching**: every office page is `force-dynamic` and `getAuthContext()` reads the user
  from the database on each request (deliberate, for instant revocation). Caching it is a product
  and security decision, not a bundle tweak. The remaining LCP on `/dashboard` and `/m/jobs` is
  that data path, not bytes.
