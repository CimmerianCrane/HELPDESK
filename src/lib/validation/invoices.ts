import { z } from 'zod'
import { dayKey } from '@/lib/time'

/**
 * Input rules and status logic for invoices (brief §5, §12, slice 20).
 *
 * An invoice is raised from a job that has been reviewed, and its total is computed here from its
 * lines and the GST rate — never posted by the form, exactly as a quote's is. The rate is the one
 * stored on the invoice, so a reprint shows what the customer was charged.
 *
 * ``amountPaid`` is the sum of the payments recorded against the invoice, and the paid status is a
 * consequence of that sum rather than something a form sets — the same rule the delivery order's
 * status follows. Only `DRAFT → ISSUED` and `→ VOID` are moves a person makes.
 */

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PART_PAID', 'PAID', 'VOID'] as const

export type InvoiceStatusName = (typeof INVOICE_STATUSES)[number]

export const INVOICE_STATUS_LABELS: Record<InvoiceStatusName, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PART_PAID: 'Partly paid',
  PAID: 'Paid',
  VOID: 'Void',
}

/**
 * Where an invoice may go. `PART_PAID` and `PAID` have no exits: an invoice with money against it is
 * not voidable — that is a credit note, which is not part of this slice.
 */
export const ALLOWED_INVOICE_TRANSITIONS: Record<InvoiceStatusName, readonly InvoiceStatusName[]> = {
  DRAFT: ['ISSUED', 'VOID'],
  ISSUED: ['VOID'],
  PART_PAID: [],
  PAID: [],
  VOID: [],
}

export function canMoveInvoice(from: InvoiceStatusName, to: InvoiceStatusName): boolean {
  return ALLOWED_INVOICE_TRANSITIONS[from].includes(to)
}

/** Only a draft is editable. Once issued, the numbers are the ones the customer was charged. */
export function isInvoiceEditable(status: InvoiceStatusName): boolean {
  return status === 'DRAFT'
}

/** Does this invoice take payments? An unissued one is not a bill yet; a void one is not one either. */
export function isInvoicePayable(status: InvoiceStatusName): boolean {
  return status === 'ISSUED' || status === 'PART_PAID'
}

/**
 * The status a payment total produces on an issued invoice.
 *
 * Derived from the money, never posted: the person records what was paid, and the status follows. An
 * invoice with nothing against it is merely `ISSUED`.
 */
export function paidStatusFor(totalCents: number, paidCents: number): InvoiceStatusName {
  if (paidCents <= 0) return 'ISSUED'
  return paidCents >= totalCents ? 'PAID' : 'PART_PAID'
}

/** What is still owed, in cents. Never negative — an overpayment is refused, not netted. */
export function balanceCents(totalCents: number, paidCents: number): number {
  return Math.max(0, totalCents - paidCents)
}

/**
 * Is an unpaid issued invoice past its due date? Computed from the date and the clock, like a quote's
 * expiry: there is no nightly sweep to fall out of step with the calendar.
 */
export function isInvoiceOverdue(
  invoice: { status: InvoiceStatusName; dueDate: Date | null },
  now: Date,
  timeZone: string,
): boolean {
  if (invoice.status !== 'ISSUED' || !invoice.dueDate) return false
  return dayKey(invoice.dueDate, timeZone) < dayKey(now, timeZone)
}

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
 * One line. A labour line and a part line look the same here — the difference is what the office
 * types in the description, which is how a printed invoice reads anyway.
 */
export const invoiceLineSchema = z.object({
  description: requiredText(500, 'Describe what is being charged for.'),
  quantity: z.coerce
    .number()
    .positive('Enter a quantity.')
    .max(1_000_000, 'That is not a plausible quantity.'),
  unitPrice: z.coerce
    .number()
    .min(0, 'A unit price cannot be negative.')
    .max(10_000_000, 'That is not a plausible price.'),
})

export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>

const invoiceLines = z
  .array(invoiceLineSchema)
  .min(1, 'Add at least one line.')
  .max(100, '100 lines is the most one invoice holds.')

/** An invoice is always raised against a job; the customer is the job's customer. */
export const createInvoiceSchema = z.object({
  jobId: requiredText(40, 'Choose the job.'),
  lines: invoiceLines,
})

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>

/** Editing a draft: the lines can be replaced, but the job cannot move. */
export const updateInvoiceSchema = z.object({
  lines: invoiceLines,
})

export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>

/** Voiding is a decision with a reason, never a silent delete (CLAUDE.md rule 4). */
export const voidInvoiceSchema = z.object({
  reason: requiredText(500, 'Say why the invoice is being voided — the audit log keeps it.'),
})

export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>

export const PAYMENT_METHODS = ['CASH', 'PAYNOW', 'BANK_TRANSFER', 'CHEQUE', 'CARD'] as const

export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  CASH: 'Cash',
  PAYNOW: 'PayNow',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  CARD: 'Card',
}

/** A payment recorded against an issued invoice. The amount is the only thing that moves the status. */
export const recordPaymentSchema = z.object({
  amount: z.coerce
    .number()
    .positive('Enter the amount received.')
    .max(10_000_000, 'That is not a plausible amount.'),
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(100),
  paidAt: optionalDay,
})

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>

/** The invoices list's search params. `''` is "everything" for both fields. */
export const invoiceFilterSchema = z.object({
  q: z.string().trim().max(100).optional().default(''),
  status: z
    .union([z.literal(''), z.enum(INVOICE_STATUSES)])
    .optional()
    .default(''),
})

export type InvoiceFilter = z.infer<typeof invoiceFilterSchema>
