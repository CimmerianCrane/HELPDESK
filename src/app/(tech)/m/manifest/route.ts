/**
 * The installable app manifest for the technician's tablet.
 *
 * It lives under `/m/` rather than at the site root because installing is a field decision: a
 * dispatcher who installs the site should get the office app, not a phone screen with a bottom bar.
 * `scope` matches, so the installed app stays inside the mobile routes.
 *
 * The icons are PNG. Chrome accepts SVG with `sizes: "any"`, but the Play Store path (slice 45)
 * and Android's launcher both want raster icons at exact sizes, and a maskable variant has to be a
 * real square with its own safe zone — so `scripts/make-icons.ts` renders these once from the two
 * SVGs and the results are committed.
 *
 * `display: 'standalone'` is the window without Chrome's bars that was asked for. Not `fullscreen`:
 * that would hide the clock and the battery through an eight-hour shift.
 * `orientation: 'any'` because landscape is how a crane gets inspected.
 *
 * The path is `/m/manifest`, not the conventional `/manifest.webmanifest`: Next reserves that exact
 * filename and a route directory called `manifest.webmanifest` breaks the build outright
 * (`Invariant: no direct app page entry found for /_not-found`). Nothing requires the conventional
 * name — browsers read whatever the page's `<link rel="manifest">` points at.
 */
export const dynamic = 'force-static'

export function GET() {
  return Response.json(
    {
      id: '/m/',
      name: 'Cimmerian Crane — Field',
      short_name: 'Cimmerian',
      description: 'Your jobs, sites and crane records, with or without a signal.',
      start_url: '/m/jobs',
      scope: '/m/',
      display: 'standalone',
      orientation: 'any',
      // The real shell colours from globals.css — a launch screen in the wrong shade flashes white.
      background_color: '#f5f6f7',
      theme_color: '#1f2328',
      lang: 'en-SG',
      categories: ['business', 'productivity'],
      prefer_related_applications: false,
      icons: [
        { src: '/icons/tech-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/tech-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        {
          src: '/icons/tech-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    {
      headers: {
        // A manifest that changes must not be held by a CDN for a week; installed apps re-read it.
        'Content-Type': 'application/manifest+json',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  )
}
