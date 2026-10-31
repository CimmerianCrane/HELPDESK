import { describe, expect, it } from 'vitest'
import { ForbiddenError, ValidationError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { subscribePush, unsubscribePush } from '@/server/notify/push'
import { inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * Push subscriptions (slice 43), against the real database.
 *
 * Web Push itself is not exercised — there is no push service and no VAPID here — so what is proven
 * is the half that can lose or leak data: a subscription always belongs to the caller, a
 * re-registration updates rather than duplicating, and a delete cannot reach another tablet.
 *
 * The service takes a `Tx`, so every case rolls back and leaves the shared database untouched.
 */

async function technicianUser(tx: Tx, suffix = testSuffix()) {
  const user = await tx.user.create({
    data: {
      email: `push-${suffix}@example.test`,
      name: `Push Technician ${suffix}`,
      role: 'TECHNICIAN',
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
  const technician = await tx.technician.create({ data: { userId: user.id } })
  const context: AuthContext = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: 'TECHNICIAN',
    technicianId: technician.id,
    customerId: null,
    ip: '203.0.113.9',
    userAgent: 'vitest',
  }
  return { user, technician, context }
}

function subscriptionFor(suffix: string) {
  return {
    endpoint: `https://push.example.test/${suffix}`,
    keys: { p256dh: `p256dh-${suffix}`, auth: `auth-${suffix}` },
  }
}

describe('push subscriptions', () => {
  it('refuses an office login: they have no tablet job list', async () => {
    await inRolledBackTx(async (tx) => {
      const { context } = await technicianUser(tx)
      const office: AuthContext = { ...context, role: 'DISPATCHER', technicianId: null }

      await expect(subscribePush(office, subscriptionFor(testSuffix()), tx)).rejects.toBeInstanceOf(
        ForbiddenError,
      )
    })
  })

  it('rejects a subscription with no keys', async () => {
    await inRolledBackTx(async (tx) => {
      const { context } = await technicianUser(tx)
      const { endpoint } = subscriptionFor(testSuffix())

      await expect(subscribePush(context, { endpoint }, tx)).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it('upserts by endpoint: one row per tablet, keys refreshed, owner reassigned', async () => {
    await inRolledBackTx(async (tx) => {
      const suffix = testSuffix()
      const first = await technicianUser(tx, `a${suffix}`)
      const second = await technicianUser(tx, `b${suffix}`)
      const subscription = subscriptionFor(suffix)

      await subscribePush(first.context, subscription, tx)
      // The same tablet, keys rotated, now signed in as somebody else — a tablet changing hands.
      await subscribePush(
        second.context,
        { ...subscription, keys: { p256dh: 'new-key', auth: 'new-auth' } },
        tx,
      )

      const rows = await tx.pushSubscription.findMany({
        where: { endpoint: subscription.endpoint },
        select: { userId: true, p256dh: true, disabledAt: true },
      })
      expect(rows).toHaveLength(1)
      expect(rows[0].userId).toBe(second.user.id)
      expect(rows[0].p256dh).toBe('new-key')
      expect(rows[0].disabledAt).toBeNull()
    })
  })

  it('deletes only the caller’s own subscription', async () => {
    await inRolledBackTx(async (tx) => {
      const suffix = testSuffix()
      const owner = await technicianUser(tx, `a${suffix}`)
      const other = await technicianUser(tx, `b${suffix}`)
      const subscription = subscriptionFor(suffix)

      await subscribePush(owner.context, subscription, tx)

      // Somebody else holding the endpoint cannot delete it.
      await unsubscribePush(other.context, { endpoint: subscription.endpoint }, tx)
      expect(
        await tx.pushSubscription.count({ where: { endpoint: subscription.endpoint } }),
      ).toBe(1)

      await unsubscribePush(owner.context, { endpoint: subscription.endpoint }, tx)
      expect(
        await tx.pushSubscription.count({ where: { endpoint: subscription.endpoint } }),
      ).toBe(0)
    })
  })
})
