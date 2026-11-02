import { timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { internalError } from '@/server/auth/errors'
import { pruneRateLimitBuckets } from '@/server/auth/rate-limit'
import { runScheduleReminders } from '@/server/reminders/reminders'
import { resendUnemailedReports } from '@/server/reports/email-retry'

/**
 * The daily maintenance run, triggered by Vercel Cron (see vercel.json).
 *
 * Vercel has no long-running process, so the plan's `npm run worker` and pg-boss queue are gone.
 * Anything that must happen on a schedule becomes a protected route here and is listed in
 * vercel.json. The report PDF is rendered in the request that approves it, because it takes a second
 * and belongs in that transaction; this run only retries the customer email, which is the one part of
 * approval that deliberately happens after the commit. It also evaluates every crane schedule that has
 * reached one of its reminder offsets (slice 15) — the reminder engine the brief asks for in §8.
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

  // Constant-time, the same way the storage tokens are compared: `===` returns as soon as it finds a
  // difference, which is a usable oracle against a secret of unknown length.
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  if (expected.length !== given.length) return false
  return timingSafeEqual(expected, given)
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const pruned = await pruneRateLimitBuckets()
    const emailed = await resendUnemailedReports()
    // Slice 15: the scan is idempotent per (schedule, threshold, due date), so a Vercel retry of
    // this run cannot email the office twice.
    const reminders = await runScheduleReminders()
    logger.info('cron.daily.completed', {
      prunedRateLimitBuckets: pruned,
      resendAttempts: emailed,
      reminders,
    })
    return Response.json({
      ok: true,
      prunedRateLimitBuckets: pruned,
      resendAttempts: emailed,
      reminders,
    })
  } catch (error) {
    return internalError(error)
  }
}
