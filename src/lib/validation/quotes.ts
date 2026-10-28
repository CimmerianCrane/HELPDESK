import { z } from 'zod'
import { dayKey } from '@/lib/time'
import { documentTotals, type DocumentTotals } from './money'

/**
 * Input rules and money arithmetic for quotes (brief §4.2, §12, slice 19).
 *
 * A quote is a priced offer to a customer: lines with a quantity and a unit price, a variation flag
 * for extra work on top of the agreed scope, GST on the subtotal, and an expiry date. The totals are
 * computed here — from the lines and the rate, in integer cents — and never taken from the form, so a
 * client cannot post a total that disagrees with its own lines.
 *
 * Expiry is **derived**, never stored: a `SENT` quote past `validUntil` reads as `EXPIRED` and cannot
 * be accepted. That is the same rule the product already applies to overdue schedules and certificates
 * — a date is the truth, a nightly sweep that may not have run is not.
 */

export const QUOTE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const

export type QuoteStatusName = (typeof QUOTE_STATUSES)[number]

export const QUOTE_STATUS_LABELS: Record<QuoteStatusName, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
}

/**
 * Where a quote may go. `EXPIRED` is absent as a target: the service derives it from the date, so no
 * form and no caller can post it.
 */
export const ALLOWED_QUOTE_TRANSITIONS: Record<QuoteStatusName, readonly QuoteStatusName[]> = {
  DRAFT: ['SENT'],
  SENT: ['ACCEPTED', 'DECLINED'],
  ACCEPTED: [],
  DECLINED: [],
  EXPIRED: [],
}

export function canMoveQuote(from: QuoteStatusName, to: QuoteStatusName): boolean {
  return ALLOWED_QUOTE_TRANSITIONS[from].includes(to)
}

/**
 * What the quote reads as today. A sent quote stops being live at the end of its `validUntil` day, in
 * the operating timezone — the same day-boundary rule schedules and certificates use.
 */
export function effectiveQuoteStatus(
  quote: { status: QuoteStatusName; validUntil: Date | null },
  now: Date,
  timeZone: string,
): QuoteStatusName {
  if (quote.status !== 'SENT' || !quote.validUntil) return quote.status
  return dayKey(quote.validUntil, timeZone) < dayKey(now, timeZone) ? 'EXPIRED' : quote.status
}

export type QuoteTotals = DocumentTotals

/** A quote's arithmetic — the same rule an invoice follows, so re-exported from one place. */
export const quoteTotals = documentTotals

export { centsToDecimalString } from './money'

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : null))

const requiredText = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max, `Use ${max} characters or fewer.`)

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A date input, read as UTC midnight — the convention schedules and certificates use. */
function isoDayToUtc(value: string): Date | null {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10) === value ? date : null
}

const optionalDay = z
  .union([z.literal(''), z.string().regex(ISO_DAY, 'Use a date like 2026-10-28.')])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value))
  .superRefine((value, ctx) => {
    if (value !== null && isoDayToUtc(value) === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'That is not a real date.' })
    }
  })
  .transform((value) => (value === null ? null : isoDayToUtc(value)))

/**
 * The variation flag is a checkbox in the UI and a select on the form, so it arrives as `'yes'`,
 * `'no'` or a boolean depending on the caller. Everything except an explicit yes is false.
 */
const variationFlag = z
  .union([z.boolean(), z.literal('yes'), z.literal('no')])
  .optional()
  .transform((value) => value === true || value === 'yes')

export const quoteLineSchema = z.object({
  description: requiredText(500, 'Describe what is being quoted.'),
  quantity: z.coerce
    .number()
    .positive('Enter a quantity.')
    .max(1_000_000, 'That is not a plausible quantity.'),
  unitPrice: z.coerce
    .number()
    .min(0, 'A unit price cannot be negative.')
    .max(10_000_000, 'That is not a plausible price.'),
  isVariation: variationFlag,
})

export type QuoteLineInput = z.infer<typeof quoteLineSchema>

const quoteLines = z
  .array(quoteLineSchema)
  .min(1, 'Add at least one line.')
  .max(100, '100 lines is the most one quote holds.')

/** A quote is always raised against a job; the customer is the job's customer. */
export const createQuoteSchema = z.object({
  jobId: requiredText(40, 'Choose the job.'),
  validUntil: optionalDay,
  notes: optionalText(2000),
  lines: quoteLines,
})

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>

/** Editing a draft: the lines can be replaced, but the job cannot move. */
export const updateQuoteSchema = z.object({
  validUntil: optionalDay,
  notes: optionalText(2000),
  lines: quoteLines,
})

export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>

/** Send, accept or decline. `EXPIRED` is never posted — see `effectiveQuoteStatus`. */
export const quoteTransitionSchema = z.object({
  status: z.enum(['SENT', 'ACCEPTED', 'DECLINED']),
  note: optionalText(500),
})

export type QuoteTransitionInput = z.infer<typeof quoteTransitionSchema>

/** The quotes list's search params. `''` is "everything" for both fields. */
export const quoteFilterSchema = z.object({
  q: z.string().trim().max(100).optional().default(''),
  status: z
    .union([z.literal(''), z.enum(QUOTE_STATUSES)])
    .optional()
    .default(''),
})

export type QuoteFilter = z.infer<typeof quoteFilterSchema>
