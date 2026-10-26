import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '@/server/auth/password'

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery stapl', stored)).toBe(false)
    expect(await verifyPassword('', stored)).toBe(false)
    expect(await verifyPassword('CORRECT HORSE BATTERY STAPLE', stored)).toBe(false)
  })

  it('salts each hash, so the same password never produces the same stored value', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toBe(b)
    // Both still verify — the salt is embedded, not looked up.
    expect(await verifyPassword('same-password', a)).toBe(true)
    expect(await verifyPassword('same-password', b)).toBe(true)
  })

  it('records its own parameters, so they can be raised without invalidating existing hashes', async () => {
    const stored = await hashPassword('x')
    const parts = stored.split('$')
    expect(parts).toHaveLength(6)
    expect(parts[0]).toBe('scrypt')
    expect(Number(parts[1])).toBeGreaterThanOrEqual(16384)
  })

  /**
   * A corrupt or unrecognised hash must deny the login, not throw. An exception here would surface
   * as a 500 on the sign-in route and leak that the account exists.
   */
  it('returns false rather than throwing on a malformed stored value', async () => {
    const malformed = [
      '',
      'not-a-hash',
      'scrypt$16384$8$1$onlyfourparts',
      'bcrypt$16384$8$1$c2FsdA$aGFzaA',
      'scrypt$notanumber$8$1$c2FsdA$aGFzaA',
      'scrypt$1$8$1$c2FsdA$aGFzaA',
      'scrypt$0$8$1$c2FsdA$aGFzaA',
      'scrypt$16384$8$1$$',
      'scrypt$99999999$8$1$c2FsdA$aGFzaA',
    ]
    for (const stored of malformed) {
      await expect(
        verifyPassword('anything', stored),
        `expected ${JSON.stringify(stored)} to fail closed`,
      ).resolves.toBe(false)
    }
  })

  it('treats differently-encoded but equivalent unicode as the same password', async () => {
    // "café" with a composed é versus a combining acute accent.
    const composed = 'café-2026'
    const decomposed = 'café-2026'
    expect(composed).not.toBe(decomposed)

    const stored = await hashPassword(composed)
    expect(await verifyPassword(decomposed, stored)).toBe(true)
  })

  it('handles a long password without failing', async () => {
    const long = 'a'.repeat(1000)
    const stored = await hashPassword(long)
    expect(await verifyPassword(long, stored)).toBe(true)
    expect(await verifyPassword('a'.repeat(999), stored)).toBe(false)
  })
})
