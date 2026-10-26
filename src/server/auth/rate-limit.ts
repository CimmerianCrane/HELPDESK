/**
 * Fixed-window rate limiter for sign-in, held in process memory.
 *
 * Two buckets are checked on every attempt and both must allow it:
 *
 *   - by email, which an attacker cannot forge, so guessing one account's password is bounded no
 *     matter how many addresses they come from;
 *   - by client IP, which catches one source spraying many different accounts.
 *
 * shortcut: state is per-process, so with more than one app instance the effective limit is
 * per-instance. Move to a Postgres or Redis counter when the app runs behind more than one node.
 * The email bucket still bounds single-account guessing either way.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

/** Bounds memory if someone hammers with unique keys. Oldest-inserted go first. */
const MAX_ENTRIES = 10_000

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the window resets. 0 when allowed. */
  retryAfterSeconds: number
}

/**
 * Records one attempt and reports whether it may proceed. `now` is injectable so the test does not
 * have to wait out a real window.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  if (buckets.size >= MAX_ENTRIES) {
    for (const [existing, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(existing)
    }
    // Still full of live windows: drop the oldest, which Map iteration gives us first.
    while (buckets.size >= MAX_ENTRIES) {
      const oldest = buckets.keys().next().value
      if (oldest === undefined) break
      buckets.delete(oldest)
    }
  }

  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  existing.count += 1
  if (existing.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

/**
 * Reports the state of a bucket without consuming an attempt. Lets the sign-in form say "too many
 * attempts, try again in N minutes" instead of the generic wrong-password message, without the
 * attempt being counted twice — `authorize` remains the only place that increments.
 */
export function peekRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) return { allowed: true, retryAfterSeconds: 0 }
  if (bucket.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

/** Called after a successful sign-in, so a few fat-fingered attempts do not count against someone. */
export function resetRateLimit(key: string): void {
  buckets.delete(key)
}

/** Test hook. */
export function clearRateLimits(): void {
  buckets.clear()
}

// ---------------------------------------------------------------------------
// Sign-in policy
// ---------------------------------------------------------------------------

export const LOGIN_LIMITS = {
  perEmail: { limit: 10, windowMs: 15 * 60 * 1000 },
  perIp: { limit: 30, windowMs: 15 * 60 * 1000 },
} as const

export function emailKey(email: string): string {
  return `email:${email.trim().toLowerCase()}`
}

export function ipKey(ip: string): string {
  return `ip:${ip}`
}

/**
 * Best-effort client address. `x-forwarded-for` is client-supplied unless a trusted proxy sets it,
 * so this is a throttle, not an identity — which is why the email bucket exists alongside it.
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
