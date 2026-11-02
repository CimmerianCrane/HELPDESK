import { db, type Tx } from '@/lib/db'

/**
 * Fixed-window rate limiter for sign-in, held in Postgres.
 *
 * Two buckets are checked on every attempt and both must allow it:
 *
 *   - by email, which an attacker cannot forge, so guessing one account's password is bounded no
 *     matter how many addresses they come from;
 *   - by client IP, which catches one source spraying many different accounts.
 *
 * The counter is a database row rather than a `Map` because this app is deployed on Vercel: every
 * request may land on a different, short-lived function instance, so a per-process counter would
 * give an attacker a fresh allowance per instance. The insert-or-increment below is a single
 * statement, so concurrent instances increment the same row atomically.
 *
 * Losing the database means losing sign-in anyway, so this adds no new failure mode.
 */

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the window resets. 0 when allowed. */
  retryAfterSeconds: number
}

function toResult(count: number, resetAt: Date, limit: number, now: number): RateLimitResult {
  if (count <= limit) return { allowed: true, retryAfterSeconds: 0 }
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((resetAt.getTime() - now) / 1000)) }
}

/**
 * Records one attempt and reports whether it may proceed. The first attempt in a window creates the
 * row; later attempts increment it; an expired window starts again at one. All of that happens in
 * the database in one round trip, so two instances cannot both think they are the first.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  client: Tx = db,
): Promise<RateLimitResult> {
  const rows = await client.$queryRaw<Array<{ count: number; resetAt: Date }>>`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "updatedAt")
    VALUES (${key}, 1, now() + make_interval(secs => ${windowMs / 1000}), now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitBucket"."resetAt" <= now() THEN 1
        ELSE "RateLimitBucket"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "RateLimitBucket"."resetAt" <= now() THEN now() + make_interval(secs => ${windowMs / 1000})
        ELSE "RateLimitBucket"."resetAt"
      END,
      "updatedAt" = now()
    RETURNING "count", "resetAt"
  `

  const row = rows[0]
  if (!row) return { allowed: true, retryAfterSeconds: 0 }
  return toResult(row.count, row.resetAt, limit, Date.now())
}

/**
 * Reports the state of a bucket without consuming an attempt. Lets the sign-in form say "too many
 * attempts, try again in N minutes" instead of the generic wrong-password message, without the
 * attempt being counted twice — `authorize` remains the only place that increments.
 */
export async function peekRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  client: Tx = db,
): Promise<RateLimitResult> {
  // `windowMs` is part of the signature so callers can pass the same policy object they consume
  // with; the stored `resetAt` already encodes it.
  void windowMs

  const row = await client.rateLimitBucket.findUnique({ where: { key } })
  if (!row) return { allowed: true, retryAfterSeconds: 0 }

  const now = Date.now()
  if (row.resetAt.getTime() <= now) return { allowed: true, retryAfterSeconds: 0 }
  return toResult(row.count, row.resetAt, limit, now)
}

/** Called after a successful sign-in, so a few fat-fingered attempts do not count against someone. */
export async function resetRateLimit(key: string, client: Tx = db): Promise<void> {
  await client.rateLimitBucket.deleteMany({ where: { key } })
}

/**
 * Drops windows that have already expired. Called by the daily Vercel cron; without it the table
 * would keep one row per email/address ever seen. Safe to run at any time — a row only disappears
 * once its window is over, at which point it would be reset on next use anyway.
 */
export async function pruneRateLimitBuckets(): Promise<number> {
  const result = await db.rateLimitBucket.deleteMany({
    where: { resetAt: { lte: new Date() } },
  })
  return result.count
}

// ---------------------------------------------------------------------------
// Sign-in policy
// ---------------------------------------------------------------------------

export const LOGIN_LIMITS = {
  perEmail: { limit: 10, windowMs: 15 * 60 * 1000 },
  perIp: { limit: 30, windowMs: 15 * 60 * 1000 },
} as const

interface Policy {
  limit: number
  windowMs: number
}

/**
 * The write endpoints a signed-in caller can call repeatedly. Keyed by user id rather than by address:
 * the id cannot be forged, so a shared site office behind one NAT is not throttled as one.
 *
 * Generous on purpose — a technician syncing a 20-line report with photos should never meet these.
 * They bound a runaway loop or a stolen session, which is the threat.
 */
export const API_LIMITS = {
  uploadUrl: { limit: 200, windowMs: 5 * 60 * 1000 },
  techSync: { limit: 60, windowMs: 5 * 60 * 1000 },
  pushSubscribe: { limit: 20, windowMs: 5 * 60 * 1000 },
} as const satisfies Record<string, Policy>

/**
 * Consumes one attempt for a signed-in caller and returns the `429` to send if they are over, or
 * `null` to carry on. The route handlers answer dozens of calls; they should not each repeat the
 * status, the body and the header.
 */
export async function throttle(
  context: { userId: string },
  policy: Policy,
): Promise<Response | null> {
  const result = await rateLimit(`user:${context.userId}`, policy.limit, policy.windowMs)
  if (result.allowed) return null
  return Response.json(
    { error: 'That is too many requests. Wait a moment and try again.' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
  )
}

export function emailKey(email: string): string {
  return `email:${email.trim().toLowerCase()}`
}

export function ipKey(ip: string): string {
  return `ip:${ip}`
}

/**
 * Best-effort client address. `x-forwarded-for` is client-supplied unless a trusted proxy sets it,
 * so this is a throttle, not an identity — which is why the email bucket exists alongside it.
 * Vercel sets `x-forwarded-for`, and `x-real-ip` is the fallback for other hosts.
 *
 * Takes the minimal shape rather than `Headers` so it accepts Next's read-only headers too.
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')?.trim() || 'unknown'
}
