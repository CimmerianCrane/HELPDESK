import { describe, expect, it } from 'vitest'
import { isSafeStorageKey, signUploadToken, verifyUploadToken } from '@/server/storage/storage'

/**
 * The disk driver's upload URL is a bearer token: whoever holds it can write to that key without a
 * session. It therefore has to be forgery-proof and short-lived, which is what these tests pin down.
 */

const SECRET = 'test-secret-not-the-real-one'
const KEY = 'jobs/job-1/11111111-1111-4111-8111-111111111111.jpg'

describe('upload tokens', () => {
  it('round-trips a token it signed', () => {
    const expiresAt = Date.now() + 60_000
    expect(verifyUploadToken(KEY, signUploadToken(KEY, expiresAt, SECRET), SECRET)).toBe(true)
  })

  it('rejects a token signed for a different key', () => {
    const expiresAt = Date.now() + 60_000
    const token = signUploadToken(KEY, expiresAt, SECRET)
    expect(verifyUploadToken('jobs/job-2/other.jpg', token, SECRET)).toBe(false)
  })

  it('rejects a tampered signature and a different secret', () => {
    const expiresAt = Date.now() + 60_000
    const token = signUploadToken(KEY, expiresAt, SECRET)
    const tampered = `${expiresAt}.${'A'.repeat(43)}`
    expect(verifyUploadToken(KEY, tampered, SECRET)).toBe(false)
    expect(verifyUploadToken(KEY, token, 'another-secret')).toBe(false)
  })

  it('rejects an expired token', () => {
    const token = signUploadToken(KEY, Date.now() - 1, SECRET)
    expect(verifyUploadToken(KEY, token, SECRET)).toBe(false)
  })

  it('rejects junk tokens without throwing', () => {
    expect(verifyUploadToken(KEY, '', SECRET)).toBe(false)
    expect(verifyUploadToken(KEY, 'not-a-token', SECRET)).toBe(false)
  })
})

describe('storage keys', () => {
  it('accepts the keys this app generates', () => {
    expect(isSafeStorageKey(KEY)).toBe(true)
    expect(isSafeStorageKey('jobs/job-1/abc.png')).toBe(true)
  })

  it('refuses anything that could escape the storage root', () => {
    expect(isSafeStorageKey('../secrets.txt')).toBe(false)
    expect(isSafeStorageKey('jobs/../../secrets.txt')).toBe(false)
    expect(isSafeStorageKey('/etc/passwd')).toBe(false)
    expect(isSafeStorageKey('jobs/job 1/a.jpg')).toBe(false)
  })
})
