import type { Tx } from '@/lib/db'
import { env } from '@/lib/env'
import { errorMessage, logger } from '@/lib/logger'
import { emailAdapter } from '@/server/email/email'
import { messageAdapter, type MessageChannel } from '@/server/notify/message'

/**
 * Notification fan-out (brief §4.3): a P1 alerts every dispatcher, in-app and by email — and, since
 * slice 36, by SMS and WhatsApp too.
 *
 * One row is written per recipient per channel, because they succeed and fail independently. The
 * in-app row is the one a dispatcher actually sees; email reaches them when they are away from the
 * screen; the two phone channels reach them when they are away from the desk entirely, which is
 * where a dispatcher taking a P1 call actually is. Recording them separately means a dead mail server
 * does not hide the alert from the app, and a failed send is visible as a row with `failedAt` set
 * rather than disappearing into a log.
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
    select: { id: true, email: true, name: true, phone: true },
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
  const appUrl = env().APP_BASE_URL.replace(/\/$/, '')
  const subject = `P1 crane down — ${input.number} ${input.customerName}`
  const text = alertBody(input, link, appUrl)
  await fanOut(tx, {
    subject,
    text,
    // A phone alert is billed per segment, so it carries the first line and the link, not the whole
    // description. The detail is one tap away and the urgent part is in the first nine words.
    phoneText: `P1 ${input.number} ${input.customerName}${input.assetTag ? ` ${input.assetTag}` : ''} ${appUrl}${link}`,
    link,
    jobId: jobId ?? null,
    logKey,
    phoneChannels: true,
  })
}

export interface OfficeMessage {
  title: string
  body: string
  link: string
}

/**
 * A recurring-obligation reminder (slice 15). Same recipients and the same in-app + email fan-out as
 * a P1 — a due service is also a dispatcher's problem to book — but not its phone channels: it is not
 * urgent enough to ring somebody, and the office asked for SMS and WhatsApp on P1s only.
 */
export async function notifyOfficeOfReminder(tx: Tx, message: OfficeMessage): Promise<void> {
  await fanOut(tx, {
    subject: message.title,
    text: message.body,
    link: message.link,
    jobId: null,
    logKey: 'notify.schedule',
    phoneChannels: false,
  })
}

/**
 * Writes one row per recipient per channel, sends each, records each outcome separately.
 *
 * A recipient with no phone gets no phone row: a row against a number nobody holds is a row that can
 * never be sent, and a dispatcher who has not been given a mobile is not a broken channel.
 */
async function fanOut(
  tx: Tx,
  options: {
    subject: string
    text: string
    /** The body the phone channels send. Required when `phoneChannels` is true. */
    phoneText?: string
    link: string
    jobId: string | null
    logKey: string
    phoneChannels: boolean
  },
): Promise<void> {
  const { subject, text, phoneText, link, jobId, logKey, phoneChannels } = options
  const recipients = await alertRecipients(tx)
  if (recipients.length === 0) {
    logger.warn(`${logKey}.no-recipients`, { link })
    return
  }

  const phoneRowsFor = (recipient: (typeof recipients)[number]) =>
    phoneChannels && recipient.phone
      ? (['SMS', 'WHATSAPP'] as const).map((channel) => ({
          userId: recipient.id,
          channel,
          title: subject,
          body: phoneText ?? text,
          jobId: jobId ?? null,
          link,
          sentAt: null,
        }))
      : []

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
      ...phoneRowsFor(recipient),
    ]),
    select: { id: true, userId: true, channel: true },
  })

  // `createManyAndReturn` promises the created rows, not their order. Match by user and channel
  // rather than by position so a recipient can never be sent another recipient's failure.
  const rowFor = new Map(
    notifications.map((row) => [`${row.userId}:${row.channel}`, row.id] as const),
  )
  const email = emailAdapter()

  for (const recipient of recipients) {
    const armed: Array<{ channel: MessageChannel | 'EMAIL'; send: () => Promise<{ ok: boolean; error?: string }> }> = [
      {
        channel: 'EMAIL',
        send: () => email.send({ to: recipient.email, subject, text }),
      },
    ]
    if (phoneChannels && recipient.phone) {
      const to = recipient.phone
      for (const channel of ['SMS', 'WHATSAPP'] as const) {
        const adapter = messageAdapter(channel)
        armed.push({
          channel,
          send: () => adapter.send({ to, text: phoneText ?? text }),
        })
      }
    }

    for (const { channel, send } of armed) {
      const rowId = rowFor.get(`${recipient.id}:${channel}`)
      if (!rowId) continue

      let failure: string | null = null
      try {
        const result = await send()
        if (!result.ok) failure = result.error ?? 'send failed'
      } catch (error) {
        failure = errorMessage(error)
      }

      await tx.notification.update({
        where: { id: rowId },
        data: failure ? { failedAt: new Date(), error: failure } : { sentAt: new Date() },
      })
    }
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
