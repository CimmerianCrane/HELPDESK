import withSerwistInit from '@serwist/next'
import type { NextConfig } from 'next'

// Next 16 puts dev and build in separate output directories itself (`.next/dev` vs `.next`), which is
// what the old `distDir` switch here existed to fake. Nothing to override any more.
const nextConfig: NextConfig = {}

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
  /** The offline fallback is a static page, so it is precached rather than discovered at runtime. */
  additionalPrecacheEntries: [{ url: '/offline', revision: null }],
})

export default withSerwist(nextConfig)
