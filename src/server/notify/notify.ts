import type { Tx } from '@/lib/db'
import { env } from '@/lib/env'
import { errorMessage, logger } from '@/lib/logger'
import { emailAdapter } from '@/server/email/email'

/**
 * Notification fan-out (brief §4.3): a P1 alerts every dispatcher, in-app and by email.
 *
 * Two rows are written per recipient, one per channel, because they succeed and fail independently.
 * The in-app row is the one a dispatcher actually sees; the email is the one that reaches them when
 * they are nowhere near the screen. Recording them separately means a dead mail server does not hide
 * the alert from the app, and a failed send is visible as a row with `failedAt` set rather than
 * disappearing into a log.
 *
 * Called inside the caller's transaction, so the alert cannot survive a rollback of the ticket or job
 * it is about — and so a test can roll the whole thing back. The email itself is sent after the rows
 * are written; if the surrounding transaction rolls back, a mail may already have gone out. That is
 * the deliberate direction of the trade: an alert about a record that then failed to save is noise,
 * but a P1 nobody hears about is the failure this exists to prevent.
 */

export interface P1AlertInput {
  number: string
  customerName: string
  assetTag: string | null
  description: string
}

/** Dispatchers and administrators: the roles that can put a technician on the road. */
async function alertRecipients(tx: Tx) {
  return tx.user.findMany({
    where: { isActive: true, deletedAt: null, role: { in: ['DISPATCHER', 'ADMIN'] } },
    select: { id: true, email: true, name: true },
  })
}

function alertBody(input: P1AlertInput, link: string, baseUrl: string): string {
  const machine = input.assetTag ? ` on crane ${input.assetTag}` : ''
  return [
    `P1 raised: ${input.number} — ${input.customerName}${machine}`,
    '',
    input.description,
    '',
    `Open it: ${baseUrl}${link}`,
  ].join('\n')
}

async function notifyDispatchers(
  tx: Tx,
  input: P1AlertInput,
  options: { link: string; jobId?: string; logKey: string },
): Promise<void> {
  const { link, jobId, logKey } = options
  const recipients = await alertRecipients(tx)
  if (recipients.length === 0) {
    logger.warn(`${logKey}.no-recipients`, { link })
    return
  }

  const appUrl = env().APP_BASE_URL.replace(/\/$/, '')
  const subject = `P1 crane down — ${input.number} ${input.customerName}`
  const text = alertBody(input, link, appUrl)

  const notifications = await tx.notification.createManyAndReturn({
    data: recipients.flatMap((recipient) => [
      {
        userId: recipient.id,
        channel: 'IN_APP' as const,
        title: subject,
        body: text,
        jobId: jobId ?? null,
        link,
        sentAt: new Date(),
      },
      {
        userId: recipient.id,
        channel: 'EMAIL' as const,
        title: subject,
        body: text,
        jobId: jobId ?? null,
        link,
        sentAt: null,
      },
    ]),
    select: { id: true, userId: true, channel: true },
  })

  const adapter = emailAdapter()
  // `createManyAndReturn` promises the created rows, not their order. Match by user rather than by
  // position so a recipient can never be sent another recipient's failure.
  const emailRowFor = new Map(
    notifications.filter((row) => row.channel === 'EMAIL').map((row) => [row.userId, row]),
  )

  for (const recipient of recipients) {
    const row = emailRowFor.get(recipient.id)
    if (!row) continue

    let failure: string | null = null
    try {
      const result = await adapter.send({ to: recipient.email, subject, text })
      if (!result.ok) failure = result.error ?? 'send failed'
    } catch (error) {
      failure = errorMessage(error)
    }

    await tx.notification.update({
      where: { id: row.id },
      data: failure ? { failedAt: new Date(), error: failure } : { sentAt: new Date() },
    })
  }
}

export async function notifyDispatchersOfP1(tx: Tx, input: P1AlertInput & { ticketId: string }) {
  await notifyDispatchers(tx, input, {
    link: `/tickets/${input.ticketId}`,
    logKey: 'notify.p1.ticket',
  })
}

/**
 * A P1 job raised directly (rather than through a ticket) alerts the same people. A ticket that
 * spawns a job has already alerted them, so conversion does not send a second one.
 */
export async function notifyDispatchersOfJobP1(tx: Tx, input: P1AlertInput & { jobId: string }) {
  await notifyDispatchers(tx, input, {
    link: `/jobs/${input.jobId}`,
    jobId: input.jobId,
    logKey: 'notify.p1.job',
  })
}
