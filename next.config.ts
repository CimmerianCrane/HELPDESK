import withSerwistInit from '@serwist/next'
import type { NextConfig } from 'next'

const isDev = process.env.NODE_ENV === 'development'

/**
 * Nonce-less on purpose. A per-request nonce forces every page into dynamic rendering, which costs
 * the static `/offline` fallback Serwist precaches. What this still does is the work that matters
 * here: no script from another origin, no framing, no `<base>` hijack, no form posting off-site.
 *
 * Two sources are required, not defensive padding: `img-src data:` for the report form's compressed
 * photo and signature previews, and `connect-src https://*.supabase.co` because production uploads
 * go browser → Supabase with the signed URL, never through this server.
 */
const CSP = [
  "default-src 'self'",
  isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  isDev ? "connect-src 'self' ws: https://*.supabase.co" : "connect-src 'self' https://*.supabase.co",
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
  /** The offline fallback is a static page, so it is precached rather than discovered at runtime. */
  additionalPrecacheEntries: [{ url: '/offline', revision: null }],
})

export default withSerwist(nextConfig)
