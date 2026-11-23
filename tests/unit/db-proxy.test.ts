import { describe, expect, it, vi } from 'vitest'

/**
 * The Cloudflare context, mocked. `db.ts` asks for it on every property access, so this is the one
 * point where a test can drive it between "no Worker" (Node fallback) and two different Worker
 * requests — which is the behaviour that must not regress.
 */
const state = vi.hoisted(() => ({ context: undefined as unknown }))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => {
    if (state.context === undefined) throw new Error('getCloudflareContext called outside a request')
    return state.context
  },
}))

// A Node-side client is constructed lazily, never connected, so a bogus URL is enough here.
process.env.DATABASE_URL ??= 'postgres://user:pass@127.0.0.1:5432/none'
const { db } = await import('@/lib/db')

/**
 * `db` is a Proxy so the 55 importing files never changed. What has to hold:
 *
 * 1. Outside a Worker it behaves as the ordinary Node client.
 * 2. On a Worker each request gets its **own** client — a pooled socket may not cross requests, and a
 *    shared one is the exact bug that hangs the next request.
 * 3. Functions like `$transaction` keep the client as `this`.
 */
describe('the db Proxy', () => {
  it('falls back to a Node client when there is no Cloudflare context', () => {
    state.context = undefined
    expect(typeof db.invoice.findMany).toBe('function')
    expect(typeof db.invoice.findFirst).toBe('function')
  })

  it('returns one client for the life of one request', () => {
    state.context = { env: { HYPERDRIVE: { connectionString: 'postgres://a' } }, ctx: {} }
    expect(db.invoice).toBe(db.invoice)
  })

  it('gives a different client to a different request', () => {
    state.context = { env: { HYPERDRIVE: { connectionString: 'postgres://a' } }, ctx: {} }
    const firstRequest = db.invoice
    state.context = { env: { HYPERDRIVE: { connectionString: 'postgres://a' } }, ctx: {} }
    expect(db.invoice).not.toBe(firstRequest)
  })

  it('keeps $transaction bound to the client', () => {
    // If the Proxy returned an unbound function this would be a TypeError about `this`, not a method.
    expect(typeof db.$transaction).toBe('function')
    expect(db.$transaction.name).not.toBe('')
  })
})
