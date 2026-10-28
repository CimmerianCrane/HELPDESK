import { z } from 'zod'
import { MAX_UPLOAD_BYTES } from './reports'

/**
 * Input rules for delivery orders (brief §6.5, slice 18).
 *
 * A DO is paperwork for parts that were **already issued on a job**. It never invents a line: every
 * line names the `StockMovement` of type `ISSUE` that took the part out of the store, and raising the
 * DO sets `StockMovement.deliveryOrderId` on that row. One movement, one line, one document — which
 * is what stops the stock ledger and the paperwork describing different amounts (CLAUDE.md rule 10).
 */

export const DELIVERY_CHARGE_TYPES = ['CHARGEABLE', 'WARRANTY', 'LOAN'] as const

export type DeliveryChargeType = (typeof DELIVERY_CHARGE_TYPES)[number]

export const DELIVERY_CHARGE_TYPE_LABELS: Record<DeliveryChargeType, string> = {
  CHARGEABLE: 'Chargeable',
  WARRANTY: 'Warranty',
  LOAN: 'Loan — to be returned',
}

export const DELIVERY_STATUS_LABELS = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PARTIAL: 'Partly delivered',
  DELIVERED: 'Delivered',
  RETURNED: 'Returned',
} as const

export type DeliveryStatusName = keyof typeof DELIVERY_STATUS_LABELS

/**
 * The status a receipt produces, from what each line has received.
 *
 * Derived, never posted by the form: the person at the gate says what they took; the status is a
 * consequence. `PARTIAL` is the ordinary case — a van brings three of five items and the rest follow.
 */
export function deliveryStatusFor(
  lines: Array<{ quantity: number; received: number }>,
): 'DELIVERED' | 'PARTIAL' {
  return lines.every((line) => line.received >= line.quantity) ? 'DELIVERED' : 'PARTIAL'
}

/** A loan line still expected back. Anything chargeable or under warranty stays with the customer. */
export function isOutstandingLoan(line: {
  chargeType: DeliveryChargeType
  quantity: number
  returned: number
}): boolean {
  return line.chargeType === 'LOAN' && line.returned < line.quantity
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

/** A date input, read as UTC midnight — the same convention schedules and certificates use. */
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

/** One issued part on the delivery. `movementId` is the stock movement being put on paperwork. */
export const deliveryLineSchema = z.object({
  movementId: requiredText(40, 'Choose an issued part.'),
  chargeType: z.enum(DELIVERY_CHARGE_TYPES).default('CHARGEABLE'),
  condition: optionalText(200),
  expectedReturnDate: optionalDay,
})

export const createDeliveryOrderSchema = z.object({
  jobId: requiredText(40, 'Choose the job.'),
  lines: z
    .array(deliveryLineSchema)
    .min(1, 'Choose at least one part to put on the delivery order.')
    .max(100),
})

export type CreateDeliveryOrderInput = z.infer<typeof createDeliveryOrderSchema>
export type DeliveryLineInput = z.infer<typeof deliveryLineSchema>

/**
 * Recording that the customer's representative took the parts.
 *
 * `received` is the running total recorded for the line, not this handover's share, so a second
 * delivery fills in the remainder and a repeat of the same count changes nothing. The service refuses
 * a total above what was ordered and names the line.
 */
export const receiveDeliveryOrderSchema = z.object({
  receiverName: requiredText(200, 'Record who received the parts.'),
  signatureFileId: z.string().uuid('A signature is required when the parts are handed over.'),
  lines: z
    .array(
      z.object({
        lineId: requiredText(40, 'Choose a line.'),
        received: z.coerce
          .number()
          .min(0, 'A received quantity cannot be negative.')
          .max(1_000_000, 'That is not a plausible quantity.'),
      }),
    )
    .min(1),
})

export type ReceiveDeliveryOrderInput = z.infer<typeof receiveDeliveryOrderSchema>

/** Loan equipment coming back. Same running-total rule as a receipt. */
export const returnDeliveryOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: requiredText(40, 'Choose a line.'),
        returned: z.coerce
          .number()
          .min(0, 'A returned quantity cannot be negative.')
          .max(1_000_000, 'That is not a plausible quantity.'),
      }),
    )
    .min(1),
  note: optionalText(500),
})

export type ReturnDeliveryOrderInput = z.infer<typeof returnDeliveryOrderSchema>

/**
 * The receiver's signature, uploaded through the same signed-URL route the phone uses. It belongs to
 * the delivery order, not the job: it is evidence of that handover.
 */
export const deliverySignatureUploadSchema = z.object({
  id: z.string().uuid(),
  deliveryOrderId: requiredText(40, 'Choose the delivery order.'),
  kind: z.literal('DELIVERY_SIGNATURE'),
  filename: z.string().trim().min(1).max(200),
  mimeType: z.literal('image/png'),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES, 'Files must be 5 MB or smaller.'),
})

export type DeliverySignatureUploadInput = z.infer<typeof deliverySignatureUploadSchema>
