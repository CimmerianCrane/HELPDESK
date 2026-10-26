/**
 * The installable app manifest for the technician's phone.
 *
 * It lives under `/m/` rather than at the site root because installing is a field decision: a
 * dispatcher who installs the site should get the office app, not a phone screen with a bottom bar.
 * `scope` matches, so the installed app stays inside the mobile routes.
 *
 * The icon is SVG. Chrome accepts `sizes: "any"` for vector icons and both Android and iOS render
 * it; generating a PNG ladder would mean shipping a binary nobody can edit, for a logo that is a
 * wordmark here anyway.
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
      name: 'Cimmerian Crane — Field',
      short_name: 'Cimmerian',
      description: 'Your jobs, sites and crane records, with or without a signal.',
      start_url: '/m/jobs',
      scope: '/m/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#f8fafc',
      theme_color: '#0f172a',
      icons: [
        { src: '/icons/tech-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: '/icons/tech-icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
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
