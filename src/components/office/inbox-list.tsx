import Link from 'next/link'
import type { NotificationChannel } from '@prisma/client'
import { markReadAction } from '@/app/(office)/inbox/actions'
import { MarkReadButton } from '@/components/office/inbox-buttons'
import { cardClass } from '@/components/office/ui'
import { formatDateTime } from '@/lib/format'
import type { InboxItem } from '@/server/notifications/inbox'

/**
 * The inbox list, rendered by both shells (CLAUDE.md: one component, two renderers — never fork a
 * screen, because the phone copy and the office copy drift and the drift is a support call nobody can
 * reproduce).
 *
 * Only in-app rows are listed, plus any channel whose delivery failed. A sent email or SMS repeats the
 * text of an in-app row that is already here, so showing it would say the same thing twice.
 */
const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  IN_APP: 'In app',
  EMAIL: 'Email',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
}

export function InboxList({ items, timeZone }: { items: InboxItem[]; timeZone: string }) {
  const rows = items.filter((item) => item.channel === 'IN_APP' || item.failedAt !== null)

  if (rows.length === 0) {
    return (
      <div className={`${cardClass} text-center`}>
        <p className="text-muted">
          No alerts yet. P1 tickets, due-service reminders and dispatch notifications arrive here.
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {rows.map((item) => {
        const failed = item.failedAt !== null
        return (
          <li
            key={item.id}
            className={`${cardClass} ${item.readAt ? '' : 'border-l-4 border-l-hivis'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  {item.link ? (
                    <Link href={item.link} className="hover:underline">
                      {item.title}
                    </Link>
                  ) : (
                    item.title
                  )}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {formatDateTime(item.createdAt, timeZone)}
                  {item.readAt ? '' : ' · unread'}
                  {failed ? ` · ${CHANNEL_LABELS[item.channel]} failed` : ''}
                </p>
              </div>
              {item.readAt ? null : <MarkReadButton action={markReadAction.bind(null, item.id)} />}
            </div>

            {/* Newline-preserving: a dispatch pack is multi-line, and collapsing it removes the
                point of the pack. */}
            <p className="mt-2 text-sm whitespace-pre-line text-ink">{item.body}</p>

            {failed ? (
              <p className="mt-2 rounded-md border border-neg/40 bg-neg/10 px-3 py-2 text-xs text-neg">
                The {CHANNEL_LABELS[item.channel].toLowerCase()} copy was not delivered
                {item.error ? `: ${item.error}` : '.'} The in-app copy above did reach you.
              </p>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
