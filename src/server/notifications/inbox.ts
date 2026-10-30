import type { NotificationChannel, Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { notificationReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'

/**
 * The notification inbox (slice 38).
 *
 * Every alert this app has raised since Phase 1 has written an `IN_APP` row — a P1 to every dispatcher
 * (slice 5), a due-service reminder (slice 15), a dispatch pack to the technician on the job (slice 6)
 * — and until now nothing could read one back. Email was the only channel that reached anybody
 * (`ASSUMPTIONS.md` 96 and 100), and the SMS and WhatsApp rows slice 36 added sat beside rows nobody
 * could see either.
 *
 * This service is a read of rows that already exist plus the one write an inbox needs: marking one
 * read. It adds no table, no column and no new way of raising a notification — `notify.ts` remains the
 * only writer, and the inbox shows what it wrote.
 */

/**
 * What the inbox shows: an in-app row, or any channel whose delivery failed. A sent email or SMS
 * repeats the text of an in-app row already on the screen. Shared by the list and its count so the
 * badge and the rows cannot disagree.
 */
const VISIBLE: Prisma.NotificationWhereInput = {
  OR: [{ channel: 'IN_APP' }, { failedAt: { not: null } }],
}

/** What the badge counts: a row the reader can see and has not marked read. */
const VISIBLE_UNREAD: Prisma.NotificationWhereInput = { AND: [VISIBLE, { readAt: null }] }

export interface InboxItem {
  id: string
  /** `IN_APP` is the row a person sees. A failed delivery is shown so the failure is not silent. */
  channel: NotificationChannel
  title: string
  body: string
  link: string | null
  jobId: string | null
  readAt: Date | null
  sentAt: Date | null
  failedAt: Date | null
  error: string | null
  createdAt: Date
}

export interface InboxCounts {
  unread: number
  failed: number
}

export interface InboxPage {
  items: InboxItem[]
  counts: InboxCounts
}

/**
 * The rows on the caller's own inbox, newest first.
 *
 * `notificationReadWhere` returns the caller's own id and nothing else — there is no "all
 * notifications" capability, because a notification is addressed to one person. An admin reading
 * somebody else's alerts would see the same P1 twice and confuse their own inbox.
 *
 * `unreadOnly` narrows the list; the counts are the whole inbox either way, so the badge does not
 * change size depending on which filter the viewer happens to be on.
 */
export async function listInbox(
  context: AuthContext,
  filters: { unreadOnly?: boolean } = {},
  client: Tx = db,
): Promise<InboxPage> {
  assertCan(context, 'notification.read')

  const mine = notificationReadWhere(context)
  const [items, unread, failed] = await Promise.all([
    client.notification.findMany({
      where: { ...mine, ...VISIBLE, ...(filters.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    // Counts only what the list shows. An email row is written with `readAt: null` and never changes,
    // so counting every null would make one P1 read as two unread alerts.
    client.notification.count({ where: { ...mine, ...VISIBLE_UNREAD } }),
    client.notification.count({ where: { ...mine, failedAt: { not: null } } }),
  ])

  return {
    items: items.map((row) => ({
      id: row.id,
      channel: row.channel,
      title: row.title,
      body: row.body,
      link: row.link,
      jobId: row.jobId,
      readAt: row.readAt,
      sentAt: row.sentAt,
      failedAt: row.failedAt,
      error: row.error,
      createdAt: row.createdAt,
    })),
    counts: { unread, failed },
  }
}

/**
 * Marks one of the caller's own rows read. Read via the scope filter, so a row addressed to somebody
 * else is a `NotFoundError` rather than a `ForbiddenError` — a 403 would confirm the row exists and
 * say which ids are real.
 *
 * Marking an already-read row a second time changes nothing and writes no audit row; `withAudit`
 * skips an update whose before and after are identical.
 */
export async function markNotificationRead(
  context: AuthContext,
  notificationId: string,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'notification.read')

  const existing = await client.notification.findFirst({
    where: { ...notificationReadWhere(context), id: notificationId },
    select: { id: true, readAt: true },
  })
  if (!existing) throw new NotFoundError('No such notification.')

  await withAudit(
    { userId: context.userId, ip: context.ip, userAgent: context.userAgent },
    async (tx, log) => {
      const updated = await tx.notification.update({
        where: { id: existing.id },
        data: { readAt: new Date() },
        select: { id: true, readAt: true },
      })
      await log({
        entity: 'Notification',
        entityId: updated.id,
        action: 'UPDATE',
        before: { readAt: existing.readAt },
        after: { readAt: updated.readAt },
      })
    },
    client,
  )
}

/** Marks every unread row of the caller's read. Returns how many changed. */
export async function markAllNotificationsRead(
  context: AuthContext,
  client: Tx = db,
): Promise<number> {
  assertCan(context, 'notification.read')

  const mine = notificationReadWhere(context)
  const unread = await client.notification.findMany({
    where: { ...mine, ...VISIBLE, readAt: null },
    select: { id: true },
  })
  if (unread.length === 0) return 0

  await withAudit(
    { userId: context.userId, ip: context.ip, userAgent: context.userAgent },
    async (tx, log) => {
      const readAt = new Date()
      await tx.notification.updateMany({
        where: { id: { in: unread.map((row) => row.id) } },
        data: { readAt },
      })
      // One audit row per notification, so "who marked this one read" has an answer for each.
      for (const row of unread) {
        await log({
          entity: 'Notification',
          entityId: row.id,
          action: 'UPDATE',
          before: { readAt: null },
          after: { readAt },
        })
      }
    },
    client,
  )

  return unread.length
}

/** The unread count alone, for a badge. Cheap enough to call from a shell on every render. */
export async function unreadNotificationCount(
  context: AuthContext,
  client: Tx = db,
): Promise<number> {
  assertCan(context, 'notification.read')
  return client.notification.count({
    where: { ...notificationReadWhere(context), ...VISIBLE_UNREAD },
  })
}
