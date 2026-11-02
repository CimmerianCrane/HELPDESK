import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, NotFoundError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  listInbox,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from '@/server/notifications/inbox'
import { inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * The inbox against the real database (slice 38).
 *
 * What can only be checked here is the scoping: the service reads `Notification` rows that `notify.ts`
 * already wrote, and the thing that must not go wrong is one person marking another's alert read. The
 * page renders what this returns.
 */

function contextFor(user: { id: string; name: string; email: string; role: Role }): AuthContext {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    technicianId: null,
    customerId: null,
    ip: '203.0.113.9',
    userAgent: 'vitest',
  }
}

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${role.toLowerCase()}-inbox-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

async function makeNotification(tx: Tx, userId: string, overrides: { title?: string } = {}) {
  return tx.notification.create({
    data: {
      userId,
      channel: 'IN_APP',
      title: overrides.title ?? `P1 raised ${testSuffix()}`,
      body: 'A P1 was raised.',
      link: '/tickets/example',
      sentAt: new Date(),
    },
  })
}

describe('the notification inbox', () => {
  it('lists only the caller’s own notifications', async () => {
    await inRolledBackTx(async (tx) => {
      const alice = await makeUser(tx, 'DISPATCHER')
      const bob = await makeUser(tx, 'DISPATCHER')
      const mine = await makeNotification(tx, alice.id, { title: 'Mine' })
      await makeNotification(tx, bob.id, { title: 'Not mine' })

      const inbox = await listInbox(contextFor(alice), {}, tx)
      expect(inbox.items).toHaveLength(1)
      expect(inbox.items[0].id).toBe(mine.id)
      expect(inbox.items[0].title).toBe('Mine')
    })
  })

  /** The inbox is read through the caller's id — it does not widen to everybody's alerts. */
  it('does not widen an Admin’s inbox to everybody’s alerts', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const technician = await makeUser(tx, 'TECHNICIAN')
      await makeNotification(tx, technician.id)

      const inbox = await listInbox(contextFor(admin), {}, tx)
      expect(inbox.items).toHaveLength(0)
    })
  })

  it('returns newest first', async () => {
    await inRolledBackTx(async (tx) => {
      const user = await makeUser(tx, 'DISPATCHER')
      const first = await makeNotification(tx, user.id, { title: 'Older' })
      // `createdAt` defaults to now(), so stamp the second row later explicitly.
      const second = await makeNotification(tx, user.id, { title: 'Newer' })
      await tx.notification.update({
        where: { id: second.id },
        data: { createdAt: new Date(Date.now() + 1000) },
      })

      const inbox = await listInbox(contextFor(user), {}, tx)
      expect(inbox.items.map((item) => item.title)).toEqual(['Newer', 'Older'])
      void first
    })
  })

  it('counts unread and failed across the whole inbox, not just the filtered list', async () => {
    await inRolledBackTx(async (tx) => {
      const user = await makeUser(tx, 'DISPATCHER')
      const read = await makeNotification(tx, user.id)
      await makeNotification(tx, user.id)
      await tx.notification.update({ where: { id: read.id }, data: { readAt: new Date() } })
      await tx.notification.create({
        data: {
          userId: user.id,
          channel: 'EMAIL',
          title: 'Failed mail',
          body: 'The mail server said no.',
          sentAt: null,
          failedAt: new Date(),
          error: 'connection refused',
        },
      })

      const all = await listInbox(contextFor(user), {}, tx)
      const unreadOnly = await listInbox(contextFor(user), { unreadOnly: true }, tx)

      expect(all.counts).toEqual({ unread: 2, failed: 1 })
      // The counts do not shrink to the filtered list, so the badge does not change with the tab.
      expect(unreadOnly.counts).toEqual({ unread: 2, failed: 1 })
      expect(unreadOnly.items).toHaveLength(2)
    })
  })

  /**
   * The bug this guards: `fanOut` writes an email row beside every in-app one, and an email row's
   * `readAt` is never set. Counting unread rows without narrowing to the channel that a person reads
   * would make one P1 show as "2 unread" beside a single visible row.
   */
  it('does not count an email twin as a second unread alert', async () => {
    await inRolledBackTx(async (tx) => {
      const user = await makeUser(tx, 'DISPATCHER')
      const inApp = await makeNotification(tx, user.id)
      await tx.notification.create({
        data: {
          userId: user.id,
          channel: 'EMAIL',
          title: 'Same alert, by email',
          body: 'Same text.',
          sentAt: new Date(),
        },
      })

      const inbox = await listInbox(contextFor(user), {}, tx)
      expect(inbox.items).toHaveLength(1)
      expect(inbox.items[0].id).toBe(inApp.id)
      expect(inbox.counts.unread).toBe(1)
      expect(await unreadNotificationCount(contextFor(user), tx)).toBe(1)
    })
  })

  it('marks one of the caller’s own rows read and audits it', async () => {
    await inRolledBackTx(async (tx) => {
      const user = await makeUser(tx, 'DISPATCHER')
      const row = await makeNotification(tx, user.id)

      await markNotificationRead(contextFor(user), row.id, tx)

      const updated = await tx.notification.findUniqueOrThrow({ where: { id: row.id } })
      expect(updated.readAt).not.toBeNull()

      const audit = await tx.auditLog.findMany({
        where: { entity: 'Notification', entityId: row.id },
      })
      expect(audit).toHaveLength(1)
      expect(audit[0].action).toBe('UPDATE')
      expect(audit[0].userId).toBe(user.id)
    })
  })

  /** The one failure this slice must not allow: marking somebody else's alert read. */
  it('refuses to mark another user’s notification, as NotFound rather than Forbidden', async () => {
    await inRolledBackTx(async (tx) => {
      const alice = await makeUser(tx, 'DISPATCHER')
      const bob = await makeUser(tx, 'DISPATCHER')
      const bobsRow = await makeNotification(tx, bob.id)

      // A 403 would confirm the row exists; the caller may not even know its id.
      await expect(markNotificationRead(contextFor(alice), bobsRow.id, tx)).rejects.toBeInstanceOf(
        NotFoundError,
      )

      const untouched = await tx.notification.findUniqueOrThrow({ where: { id: bobsRow.id } })
      expect(untouched.readAt).toBeNull()
    })
  })

  it('refuses a role that holds no notification.read', async () => {
    await inRolledBackTx(async (tx) => {
      const customerUser = await makeUser(tx, 'CUSTOMER')
      await expect(listInbox(contextFor(customerUser), {}, tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('marks every unread row read and leaves already-read rows alone', async () => {
    await inRolledBackTx(async (tx) => {
      const user = await makeUser(tx, 'DISPATCHER')
      const other = await makeUser(tx, 'DISPATCHER')
      const alreadyRead = await makeNotification(tx, user.id)
      const readAt = new Date('2026-01-01T00:00:00Z')
      await tx.notification.update({ where: { id: alreadyRead.id }, data: { readAt } })
      await makeNotification(tx, user.id)
      await makeNotification(tx, user.id)
      const othersRow = await makeNotification(tx, other.id)

      const count = await markAllNotificationsRead(contextFor(user), tx)
      expect(count).toBe(2)

      expect(await unreadNotificationCount(contextFor(user), tx)).toBe(0)
      // The other person's row is untouched, and an already-read row keeps its original stamp.
      expect((await tx.notification.findUniqueOrThrow({ where: { id: othersRow.id } })).readAt).toBeNull()
      expect(
        (await tx.notification.findUniqueOrThrow({ where: { id: alreadyRead.id } })).readAt,
      ).toEqual(readAt)
    })
  })

  it('returns zero when there is nothing unread, so the button never errors', async () => {
    await inRolledBackTx(async (tx) => {
      const user = await makeUser(tx, 'DISPATCHER')
      expect(await markAllNotificationsRead(contextFor(user), tx)).toBe(0)
    })
  })
})
