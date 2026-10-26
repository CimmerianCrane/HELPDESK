import { describe, expect, it } from 'vitest'
import { sessionIsCurrent } from '@/server/auth/session'

/**
 * The rule that makes a password reset mean something: a token issued before the reset stops working.
 * Four lines of comparison, but it decides whether a stolen laptop stays signed in — so it is pinned
 * here rather than left to be noticed in production.
 */

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0)

describe('sessionIsCurrent', () => {
  it('honours a session issued after the password changed', () => {
    expect(sessionIsCurrent(NOW, new Date(NOW - 60_000))).toBe(true)
  })

  it('refuses a session issued before the password changed', () => {
    expect(sessionIsCurrent(NOW - 60_000, new Date(NOW))).toBe(false)
  })

  it('honours a session when the password has never been changed', () => {
    expect(sessionIsCurrent(NOW, null)).toBe(true)
  })

  it('refuses a token it cannot date', () => {
    // Tokens issued before this check shipped carry no sign-in time. One extra sign-in each is the
    // cheap half of the trade; the other half is a session nobody can account for.
    expect(sessionIsCurrent(undefined, null)).toBe(false)
    expect(sessionIsCurrent(undefined, new Date(NOW))).toBe(false)
  })

  it('honours a sign-in that happens in the same millisecond as the reset', () => {
    // The person doing the resetting hands the password straight over. Rounding this the wrong way
    // would sign them out the instant they signed in.
    expect(sessionIsCurrent(NOW, new Date(NOW))).toBe(true)
  })
})
