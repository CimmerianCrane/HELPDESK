import withSerwistInit from '@serwist/next'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * Dev and build in one `.next` is what made a build a destructive act: it prunes the directory the
   * running dev server is still serving from, so every route 500s and the build dies with
   * `Invariant: no direct app page entry found`. Only dev moves — `next build`/`next start` keep
   * `.next`, because that is the path Vercel's Next.js preset reads. NODE_ENV is the same signal the
   * service-worker switch below uses, and Next sets it before loading this file.
   * shortcut: two concurrent dev servers still share `.next-dev`, add a lock file if that ever matters.
   */
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
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
  /** The offline fallback is a static page, so it is precached rather than discovered at runtime. */
  additionalPrecacheEntries: [{ url: '/offline', revision: null }],
})

export default withSerwist(nextConfig)
