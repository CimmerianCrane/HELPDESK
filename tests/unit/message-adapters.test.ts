import { describe, expect, it, vi } from 'vitest'

/**
 * The SMS and WhatsApp seam (slice 36).
 *
 * Nothing here sends anywhere: the drivers are the console one, and the production drivers are
 * named in env and not yet written. What is worth pinning is the fallback — a deployment that names
 * `twilio` or `meta` must still deliver through the log rather than dropping the alert, because the
 * alert is a P1 and the failure would be silent.
 */

// The unit suite runs with no `.env`, and `env()` is lazy — set the one required variable here rather
// than teaching the fast gate to need a database.
process.env.DATABASE_URL ??= 'postgresql://unit-test@localhost:5432/unused'

/** `env()` caches on first call, so each case reloads the modules to read the variables it set. */
async function adapterFor(channel: 'SMS' | 'WHATSAPP') {
  vi.resetModules()
  const { messageAdapter } = await import('@/server/notify/message')
  return messageAdapter(channel)
}

describe('message adapters', () => {
  it('resolves a sending adapter per channel with the default configuration', async () => {
    for (const channel of ['SMS', 'WHATSAPP'] as const) {
      expect((await adapterFor(channel)).name).toBe('console')
    }
  })

  it('falls back to console rather than refusing when a driver is named but unbuilt', async () => {
    process.env.SMS_DRIVER = 'twilio'
    try {
      const adapter = await adapterFor('SMS')
      expect(adapter.name).toBe('console')
      await expect(adapter.send({ to: '+6590000001', text: 'P1 raised' })).resolves.toEqual({
        ok: true,
      })
    } finally {
      delete process.env.SMS_DRIVER
    }
  })

  it('never throws on a send, so a dead gateway cannot roll back the ticket', async () => {
    const result = await (await adapterFor('WHATSAPP')).send({ to: '+6590000001', text: 'P1 raised' })
    expect(result.ok).toBe(true)
  })
})
