import nodemailer from 'nodemailer'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'

/**
 * The email adapter (CLAUDE.md: `EmailAdapter: console | smtp`).
 *
 * Phase 1 ships the console implementation. It writes the message to the structured log, which is
 * enough to prove the notification path works end to end without anybody's inbox and without a
 * credential. SMTP is the production implementation named in the brief; it is the real one.
 *
 * A failure to send is never allowed to fail the business operation that asked for it. A P1 ticket
 * must still be created if the mail server is down; the notification row records the failure and the
 * daily cron retries it (slice 9). So every send returns a result rather than throwing.
 */

export interface EmailMessage {
  to: string
  subject: string
  /** Plain text. A template engine is a later problem; today this is a sentence or two. */
  text: string
}

export interface EmailResult {
  ok: boolean
  error?: string
}

export interface EmailAdapter {
  readonly name: string
  send(message: EmailMessage): Promise<EmailResult>
}

/**
 * Writes to the log. Used in development, and anywhere email is not configured.
 *
 * In production it never writes the body. `EMAIL_DRIVER` defaults to this adapter, so a deploy that
 * forgot the variable would otherwise copy customer names, addresses and fault descriptions into the
 * hosting logs. In production it also reports `ok: false`: it did not send, so nothing may be marked
 * as emailed, and the daily retry keeps the report in the "approved but not told" queue until a real
 * driver is configured.
 */
export const consoleEmailAdapter: EmailAdapter = {
  name: 'console',
  async send(message) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('email.not-sent', {
        to: message.to,
        subject: message.subject,
        chars: message.text.length,
      })
      return { ok: false, error: 'Email is not configured (EMAIL_DRIVER is console).' }
    }

    logger.info('email.console', {
      to: message.to,
      from: env().EMAIL_FROM,
      subject: message.subject,
      text: message.text,
    })
    return { ok: true }
  },
}

/**
 * The real one: an SMTP relay via nodemailer. Connection details come from env; nothing is
 * hard-coded. A failed send returns `ok: false` with the reason and is never thrown — the
 * notification row records it and the daily cron retries (slice 9).
 *
 * `SMTP_HOST` unset means SMTP is not configured. That is a failed send, not a crash: the ticket is
 * still recorded, and the report stays queued for the daily retry until a relay is set.
 */
function smtpAdapter(): EmailAdapter {
  const e = env()
  let transport: ReturnType<typeof nodemailer.createTransport> | undefined

  return {
    name: 'smtp',
    async send(message) {
      if (!e.SMTP_HOST) {
        logger.warn('email.smtp-not-configured', { to: message.to })
        return { ok: false, error: 'SMTP_HOST is not set' }
      }

      // Built once per process; nodemailer pools connections when `pool` is on.
      transport ??= nodemailer.createTransport({
        host: e.SMTP_HOST,
        port: e.SMTP_PORT,
        secure: e.SMTP_PORT === 465,
        auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
      })

      try {
        await transport.sendMail({
          from: e.EMAIL_FROM,
          to: message.to,
          subject: message.subject,
          text: message.text,
        })
        return { ok: true }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.error('email.send-failed', { to: message.to, error: reason })
        return { ok: false, error: reason }
      }
    },
  }
}

let cached: EmailAdapter | undefined

/**
 * Resolves the configured adapter. Unknown driver names cannot occur — `env()` validates the value —
 * but the default is console rather than an exception, because a notification that cannot be sent is
 * not a reason to refuse to record the ticket.
 */
export function emailAdapter(): EmailAdapter {
  if (cached) return cached
  cached = env().EMAIL_DRIVER === 'smtp' ? smtpAdapter() : consoleEmailAdapter
  return cached
}
