import { describe, expect, it } from 'vitest'
import { safeNext } from '@/lib/safe-next'

/**
 * The login page and the login action both redirect through this, so a hole here is an open
 * redirect: a link that looks like it belongs to the helpdesk and lands a signed-in user on someone
 * else's sign-in form, primed to collect the password they just typed.
 */
describe('safeNext', () => {
  it('accepts a same-origin path', () => {
    expect(safeNext('/jobs?status=OPEN', '/dashboard')).toBe('/jobs?status=OPEN')
    expect(safeNext('/m/jobs/abc', '/dashboard')).toBe('/m/jobs/abc')
  })

  it('rejects a protocol-relative URL', () => {
    expect(safeNext('//evil.example/login', '/dashboard')).toBe('/dashboard')
  })

  it('rejects a backslash-smuggled host', () => {
    // Browsers normalise `/\evil.example` to `//evil.example` before the request goes out.
    expect(safeNext('/\\evil.example', '/dashboard')).toBe('/dashboard')
  })

  it('rejects an absolute URL', () => {
    expect(safeNext('https://evil.example/', '/dashboard')).toBe('/dashboard')
    expect(safeNext('javascript:alert(1)', '/dashboard')).toBe('/dashboard')
  })

  it('falls back when there is no next at all', () => {
    expect(safeNext(null, '/dashboard')).toBe('/dashboard')
    expect(safeNext(undefined, '/dashboard')).toBe('/dashboard')
    expect(safeNext('', '/dashboard')).toBe('/dashboard')
  })

  it('falls back for a FormData value that is not a string', () => {
    // A file upload in the `next` field must not become a redirect target.
    expect(safeNext(new File(['x'], 'x.txt'), '/dashboard')).toBe('/dashboard')
  })
})
