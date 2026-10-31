import { assetLinks } from '@/lib/assetlinks'
import { env } from '@/lib/env'

/**
 * Digital Asset Links (slice 45). Public, no auth: Google's verifier fetches it unauthenticated.
 * Served at `/.well-known/assetlinks.json` by a rewrite in `next.config.ts`; a route directory with
 * a dot in its name breaks the App Router.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  const { status, body } = assetLinks({
    packageName: env().ANDROID_PACKAGE_NAME,
    fingerprints: env().ANDROID_SHA256_FINGERPRINTS,
  })
  if (!body) return new Response(null, { status })
  return Response.json(body, {
    status,
    ...(status === 200 && { headers: { 'Cache-Control': 'public, max-age=300' } }),
  })
}
