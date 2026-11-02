import { env } from '@/lib/env'
import { logger } from '@/lib/logger'

/**
 * The email adapter (CLAUDE.md: `EmailAdapter: console | smtp`).
 *
 * Phase 1 ships the console implementation. It writes the message to the structured log, which is
 * enough to prove the notification path works end to end without anybody's inbox and without a
 * credential. SMTP is the production implementation named in the brief; it arrives when there is a
 * mail server to point it at, and this interface is what it will implement.
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
 * hosting logs — and say nothing about the fact that no mail was sent at all.
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
      return { ok: true }
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
 * Resolves the configured adapter. Unknown driver names cannot occur — `env()` validates the value —
 * but the default is console rather than an exception, because a notification that cannot be sent is
 * not a reason to refuse to record the ticket.
 */
export function emailAdapter(): EmailAdapter {
  const driver = env().EMAIL_DRIVER
  if (driver === 'console') return consoleEmailAdapter
  // SMTP is declared in env.example and not yet implemented. Falling back keeps the notification
  // path working; the log line says plainly that nothing was actually sent.
  logger.warn('email.driver-not-implemented', { driver })
  return consoleEmailAdapter
}
