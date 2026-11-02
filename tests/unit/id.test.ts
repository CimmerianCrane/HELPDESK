import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '@/lib/id'

/**
 * The phone's id generator. A phone opening the dev machine over the LAN is not a secure context, so
 * `crypto.randomUUID` does not exist there — which is what made the report form blank. The fallback
 * must still produce a real v4 id, because the server de-duplicates retries by it.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newId', () => {
  const original = globalThis.crypto

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true })
  })

  it('uses crypto.randomUUID when the browser has it', () => {
    expect(newId()).toMatch(UUID_V4)
  })

  it('builds a v4 id without crypto.randomUUID', () => {
    const getRandomValues = original.getRandomValues.bind(original)
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues },
      configurable: true,
    })

    const ids = Array.from({ length: 200 }, () => newId())
    for (const id of ids) expect(id).toMatch(UUID_V4)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
