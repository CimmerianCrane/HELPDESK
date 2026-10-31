import { describe, expect, it } from 'vitest'
import { lanAddress } from '../../scripts/dev-lan'

/**
 * Finding the address to hand `next dev --hostname`. Getting this wrong is silent: Next starts fine
 * bound to the wrong interface and the phone simply cannot reach it.
 */

describe('lanAddress', () => {
  it('returns a private IPv4 address the phone could type', () => {
    const address = lanAddress()
    expect(address).toBeDefined()
    expect(address).toMatch(/^(\d{1,3}\.){3}\d{1,3}$/)
  })

  it('never returns a loopback address', () => {
    expect(lanAddress()).not.toMatch(/^127\./)
  })
})
