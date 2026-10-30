import { env } from '@/lib/env'
import { logger } from '@/lib/logger'

/**
 * The SMS and WhatsApp adapters (slice 36, brief §4.3: "P1 tickets trigger an immediate alert to
 * dispatchers — in-app + email in Phase 1; SMS/WhatsApp via adapter later").
 *
 * Same shape and same rule as `EmailAdapter`: a send returns a result rather than throwing, because a
 * P1 that nobody hears about is the failure this exists to prevent — a dead gateway must not roll
 * back the ticket. Nothing here knows which gateway the company will buy, and that is the point: the
 * seam is the deliverable, and the console driver proves the path end to end without a credential.
 *
 * These are alert channels, not a messaging service. The body is one short line plus a link, because
 * an SMS is billed per 160-character segment and a dispatcher reads it on a lock screen.
 */

export type MessageChannel = 'SMS' | 'WHATSAPP'

export interface Message {
  /** E.164 where possible. Nothing normalises it yet; the gateway's number is what is written. */
  to: string
  text: string
}

export interface MessageResult {
  ok: boolean
  error?: string
}

export interface MessageAdapter {
  readonly name: string
  send(message: Message): Promise<MessageResult>
}

/** Writes to the log. Used in development, and anywhere a gateway is not configured. */
export const consoleMessageAdapter: MessageAdapter = {
  name: 'console',
  async send(message) {
    logger.info('message.console', { to: message.to, text: message.text })
    return { ok: true }
  },
}

/**
 * Resolves the configured adapter for a channel. An unknown driver cannot occur — `env()` validates
 * the value — but a named-but-unbuilt driver falls back to console with a warning, exactly as SMTP
 * does today, so naming `twilio` in a deployment does not silently swallow the alert.
 */
export function messageAdapter(channel: MessageChannel): MessageAdapter {
  const driver = channel === 'SMS' ? env().SMS_DRIVER : env().WHATSAPP_DRIVER
  if (driver === 'console') return consoleMessageAdapter
  logger.warn('message.driver-not-implemented', { channel, driver })
  return consoleMessageAdapter
}
