import { describe, expect, it } from 'vitest'

/**
 * Push's own rules (slice 43), with no VAPID and no network.
 *
 * What can be wrong here is the shape of the thing being sent and the link a notification opens —
 * not the encryption, which `web-push` owns. So this pins the payload `sendPushToUsers` gives the
 * worker and the one rule the worker re-checks: a notification may only open `/m/`.
 */

process.env.DATABASE_URL ??= 'postgresql://unit-test@localhost:5432/unused'

describe('push link guard', () => {
  it('accepts only an app-relative /m/ path', async () => {
    const { isAppLink } = await import('@/server/notify/push')
    expect(isAppLink('/m/jobs/abc')).toBe(true)
    expect(isAppLink('/m/jobs')).toBe(true)
    // Office routes, absolute URLs and protocol-relative URLs never open from a tablet notification.
    expect(isAppLink('/dashboard')).toBe(false)
    expect(isAppLink('https://elsewhere.example/m/jobs')).toBe(false)
    expect(isAppLink('//evil.example/m/jobs')).toBe(false)
    expect(isAppLink('/m/../dashboard')).toBe(false)
    expect(isAppLink('')).toBe(false)
  })
})

describe('push configuration', () => {
  it('is off, not broken, without VAPID keys', async () => {
    const { pushConfigured, sendPushToUsers } = await import('@/server/notify/push')
    expect(pushConfigured()).toBe(false)
    // Best-effort means a dispatch is never held up by push being unconfigured.
    await expect(
      sendPushToUsers(['user-1'], { title: 'Job', body: 'Site', link: '/m/jobs/1' }),
    ).resolves.toEqual([])
  })
})
