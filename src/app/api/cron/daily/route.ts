import { env } from '@/lib/env'
import { errorMessage, logger } from '@/lib/logger'
import { pruneRateLimitBuckets } from '@/server/auth/rate-limit'

/**
 * The daily maintenance run, triggered by Vercel Cron (see vercel.json).
 *
 * Vercel has no long-running process, so the plan's `npm run worker` and pg-boss queue are gone.
 * Anything that must happen on a schedule becomes a protected route here and is listed in
 * vercel.json. Slice 5 adds the reminder scan and slice 9 adds a retry pass for report PDFs and
 * email; the per-report render itself stays in the request that approves it, because it takes a
 * second, not a queue.
 *
 * Requests must carry `Authorization: Bearer $CRON_SECRET`. Vercel adds that header automatically
 * when the variable is set. In production a missing secret refuses every request rather than
 * leaving the endpoint open; in development an unset secret is allowed so `curl` works locally.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorised(request: Request): boolean {
  const secret = env().CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const pruned = await pruneRateLimitBuckets()
    logger.info('cron.daily.completed', { prunedRateLimitBuckets: pruned })
    return Response.json({ ok: true, prunedRateLimitBuckets: pruned })
  } catch (error) {
    logger.error('cron.daily.failed', { error: errorMessage(error) })
    return Response.json({ ok: false, error: errorMessage(error) }, { status: 500 })
  }
}
