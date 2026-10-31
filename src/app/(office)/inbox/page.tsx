import type { Metadata } from 'next'
import Link from 'next/link'
import { markAllReadAction } from '@/app/(office)/inbox/actions'
import { InboxList } from '@/components/office/inbox-list'
import { MarkAllReadButton } from '@/components/office/inbox-buttons'
import { requireAuth } from '@/server/auth/context'
import { listInbox } from '@/server/notifications/inbox'
import { getSettings } from '@/server/settings/settings'

export const metadata: Metadata = { title: 'Inbox — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The inbox (slice 38): every in-app alert addressed to the signed-in person — P1s, due-service
 * reminders, dispatch packs — plus any channel whose delivery failed, so a dead mail server is
 * visible rather than only in a log.
 *
 * A read of rows that already exist. Nothing here raises a notification; `notify.ts` does, and this
 * is where what it wrote becomes visible.
 *
 * A technician reaches this same page from the phone shell. It renders the office layout because
 * `/inbox` is one route for everybody — a second phone page would be a second screen to keep in
 * step, which is the drift CLAUDE.md warns about. The list itself is `InboxList`, the one component.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ unread?: string }>
}) {
  const context = await requireAuth()
  const params = await searchParams
  const unreadOnly = params.unread === '1'

  const [inbox, settings] = await Promise.all([
    listInbox(context, { unreadOnly }),
    getSettings(),
  ])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title font-semibold text-ink">Inbox</h1>
          <p className="mt-1 text-muted">
            {inbox.counts.unread === 0
              ? 'Nothing unread.'
              : `${inbox.counts.unread} unread of the last 100.`}
            {inbox.counts.failed > 0 ? ` ${inbox.counts.failed} delivery failed.` : ''}
          </p>
        </div>
        {inbox.counts.unread > 0 ? <MarkAllReadButton action={markAllReadAction} /> : null}
      </div>

      <div className="flex gap-2 text-sm">
        <Link
          href="/inbox"
          className={
            unreadOnly
              ? 'rounded-md px-3 py-1.5 text-muted hover:bg-raised'
              : 'rounded-md bg-accent px-3 py-1.5 font-medium text-white'
          }
        >
          All
        </Link>
        <Link
          href="/inbox?unread=1"
          className={
            unreadOnly
              ? 'rounded-md bg-accent px-3 py-1.5 font-medium text-white'
              : 'rounded-md px-3 py-1.5 text-muted hover:bg-raised'
          }
        >
          Unread
        </Link>
      </div>

      {unreadOnly ? (
        <p className="text-sm text-muted">
          Showing unread only. <Link href="/inbox" className="underline">See all</Link>.
        </p>
      ) : null}

      <InboxList items={inbox.items} timeZone={settings.timezone} />
    </div>
  )
}
