import { describe, expect, it } from 'vitest'
import { rateLimit, resetRateLimit, peekRateLimit, API_LIMITS } from '@/server/auth/rate-limit'
import { inRolledBackTx } from './helpers'

/**
 * The window is counted in the database, so this runs against the real one — passed in as the test's
 * transaction, which rolls back. What matters here is the boundary: the attempt at the limit still
 * passes, the one after it does not, and an expired window starts over.
 */
describe('the fixed window', () => {
  it('allows exactly `limit` attempts, then refuses', async () => {
    await inRolledBackTx(async (tx) => {
      const key = `test-${Math.random().toString(36).slice(2, 10)}`
      for (let i = 1; i <= 5; i += 1) {
        const result = await rateLimit(key, 5, 60_000, tx)
        expect(result.allowed, `attempt ${i} should pass`).toBe(true)
      }

      const over = await rateLimit(key, 5, 60_000, tx)
      expect(over.allowed).toBe(false)
      expect(over.retryAfterSeconds).toBeGreaterThan(0)
    })
  })

  it('does not consume an attempt when only peeking', async () => {
    await inRolledBackTx(async (tx) => {
      const key = `test-${Math.random().toString(36).slice(2, 10)}`
      await rateLimit(key, 2, 60_000, tx)

      for (let i = 0; i < 5; i += 1) {
        expect((await peekRateLimit(key, 2, 60_000, tx)).allowed).toBe(true)
      }
      // Peeking did not count, so one more consumed attempt is still the second of two.
      expect((await rateLimit(key, 2, 60_000, tx)).allowed).toBe(true)
    })
  })

  it('starts a fresh window once the old one has expired', async () => {
    await inRolledBackTx(async (tx) => {
      const key = `test-${Math.random().toString(36).slice(2, 10)}`
      await rateLimit(key, 1, 60_000, tx)
      expect((await rateLimit(key, 1, 60_000, tx)).allowed).toBe(false)

      // `now()` is the transaction's start time, so the window cannot be waited out from in here.
      // Expiring the row by hand is the same state the next request after the window would see.
      await tx.rateLimitBucket.update({
        where: { key },
        data: { resetAt: new Date(Date.now() - 60_000) },
      })

      expect((await rateLimit(key, 1, 60_000, tx)).allowed).toBe(true)
    })
  })

  it('forgets a bucket when reset', async () => {
    await inRolledBackTx(async (tx) => {
      const key = `test-${Math.random().toString(36).slice(2, 10)}`
      await rateLimit(key, 1, 60_000, tx)
      expect((await rateLimit(key, 1, 60_000, tx)).allowed).toBe(false)

      await resetRateLimit(key, tx)
      expect((await rateLimit(key, 1, 60_000, tx)).allowed).toBe(true)
    })
  })
})

describe('the API policies', () => {
  it('are generous enough for a real report with photos, and finite', () => {
    for (const [name, policy] of Object.entries(API_LIMITS)) {
      expect(policy.limit, `${name} must bound something`).toBeGreaterThan(0)
      expect(policy.limit, `${name} must not be effectively unlimited`).toBeLessThan(10_000)
      expect(policy.windowMs, `${name} must be a real window`).toBeGreaterThan(0)
    }
  })
})
