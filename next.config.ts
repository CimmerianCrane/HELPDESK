import withSerwistInit from '@serwist/next'
import type { NextConfig } from 'next'

const isDev = process.env.NODE_ENV === 'development'

/**
 * Nonce-less on purpose. A per-request nonce forces every page into dynamic rendering, which costs
 * the static `/offline` fallback Serwist precaches. What this still does is the work that matters
 * here: no script from another origin, no framing, no `<base>` hijack, no form posting off-site.
 *
 * Three sources are required, not defensive padding: `img-src data:` for the report form's
 * compressed photo and signature previews, `connect-src data:` because the outbox turns the stored
 * data URL back into a Blob before uploading it (with `fetch`), and
 * `connect-src https://*.supabase.co` because production uploads go browser → Supabase with the
 * signed URL, never through this server.
 */
const CSP = [
  "default-src 'self'",
  isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  isDev
    ? "connect-src 'self' data: ws: https://*.supabase.co"
    : "connect-src 'self' data: https://*.supabase.co",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

// Next 16 puts dev and build in separate output directories itself (`.next/dev` vs `.next`), which is
// what the old `distDir` switch here existed to fake. Nothing to override any more.
const nextConfig: NextConfig = {
  // Off, so the framework version is not advertised on every response.
  poweredByHeader: false,

  // exceljs reaches for Node built-ins (`fs`, `stream`) that webpack cannot resolve; leaving it
  // external is what the importer's server action needs, and it never runs anywhere but the server.
  serverExternalPackages: ['exceljs'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: CSP },
          // Ignored by browsers on plain HTTP, so this is harmless in development and is what makes
          // a first visit over HTTP upgrade itself on the real domain.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Camera is allowed for this origin only — the field app's QR scanner is the sole user.
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
          },
        ],
      },
      // These filenames are not content-hashed, so a day of freshness plus a week of
      // stale-while-revalidate keeps a repainted logo reachable without a hard refresh.
      // `/_next/static` is hashed and already served immutable — deliberately untouched.
      {
        source: '/icons/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/cimmerian-mark.png',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        // This one must stay revalidated. Cached for a year, a new worker would never reach a
        // phone that already has the old build installed.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ]
  },

  async rewrites() {
    return [
      // Digital Asset Links must sit at this exact path; a route directory called `.well-known`
      // would put a dot segment in the app router.
      { source: '/.well-known/assetlinks.json', destination: '/api/assetlinks' },
    ]
  },
}

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  /**
   * Off in development, on purpose. A service worker that survives `npm run dev` serves you the
   * build you were looking at an hour ago while you edit, and the dev overlay cannot tell you that
   * — it is the single most confusing way to lose an afternoon here. Offline behaviour is checked
   * against `npm run build && npm start`.
   */
  disable: process.env.NODE_ENV === 'development',
  /**
   * Serwist reloads the page when the network comes back. `SyncProvider` already reacts to that, and
   * a reload mid-report loses up to the autosave window — and can land on a draft the form has not
   * finished writing.
   */
  reloadOnOnline: false,
  /**
   * The worker is registered at scope `/` on every page, so every entry here is downloaded by every
   * first visit — including the public login. These four groups are never useful offline:
   *
   * - `framework-*` and `main-*` are Pages Router leftovers; this app is App Router only and its
   *   entry file is `main-app-*`. The `main-<hex>` pattern deliberately does not match `main-app-*`.
   * - `polyfills-*` only reaches a `nomodule` tag, and a browser able to install a service worker
   *   never runs that tag.
   * - Only the five latin `.p` faces are selected for this content. The other 17 subset files are
   *   never fetched; the pattern deliberately does not match `-s.p.woff2`.
   * - The office screens are online-only. The field app is the only offline surface, and these
   *   chunks are not part of it.
   *
   * `globIgnores` is advertised by the types but rejected by @serwist/next 9.5.13's strict runtime
   * schema, so the supported `manifestTransforms` hook filters instead. It sees the raw build paths,
   * before the built-in transform rewrites them to `/_next/...`.
   */
  manifestTransforms: [
    (entries) => {
      // Prefix-agnostic on purpose: the webpack plugin hands these transforms either the asset
      // name or the public URL depending on the pipeline stage.
      const ignored = [
        /static\/chunks\/framework-[0-9a-f]+\.js$/,
        /static\/chunks\/main-[0-9a-f]+\.js$/,
        /static\/chunks\/polyfills-[0-9a-f]+\.js$/,
        /static\/media\/.*-s\.woff2$/,
        /static\/chunks\/app\/\(office\)\//,
      ]
      return {
        manifest: entries.filter((entry) => !ignored.some((pattern) => pattern.test(entry.url))),
        warnings: [],
      }
    },
  ],
  /** The offline fallback is a static page, so it is precached rather than discovered at runtime. */
  additionalPrecacheEntries: [{ url: '/offline', revision: null }],
})

export default withSerwist(nextConfig)
