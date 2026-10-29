import { z } from 'zod'

/**
 * Reorder suggestions and purchase orders (brief §9, slice 25).
 *
 * Two decisions live here as pure functions, because a screen can get both wrong and a test can pin
 * them:
 *
 * - **What to order for a part that is short.** The reorder quantity when the store set one, and
 *   otherwise enough to bring the shelf back to its reorder level. The store's own number wins: it is
 *   the one that knows about a supplier's pack size.
 * - **What a receipt makes the PO.** The status is derived from the lines and the quantities received,
 *   never posted by the form — the same rule delivery orders and invoices follow.
 */

export const PURCHASE_ORDER_STATUS_LABELS = {
  DRAFT: 'Draft',
  SENT: 'Sent to supplier',
  PARTIAL: 'Partly received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
} as const

export type PurchaseOrderStatusName = keyof typeof PURCHASE_ORDER_STATUS_LABELS

/** Statuses the reorder screen still shows as "on order". */
export const OPEN_PURCHASE_ORDER_STATUSES = ['DRAFT', 'SENT', 'PARTIAL'] as const

const round3 = (value: number) => Math.round(value * 1000) / 1000

/**
 * How much to order for a part below its reorder level.
 *
 * `reorderQty` is the store's standing order size and beats the arithmetic; without one, order the
 * shortfall that brings the shelf back to the level. Zero means there is nothing to suggest — no
 * level set, or the shelf is already at or above it.
 */
export function suggestedOrderQuantity(
  onHand: number,
  reorderLevel: number | null,
  reorderQty: number | null,
): number {
  if (reorderLevel === null) return 0
  if (reorderQty !== null && reorderQty > 0) return round3(reorderQty)
  return round3(Math.max(reorderLevel - onHand, 0))
}

/** Where a PO stands, from what each line has received. `DRAFT` until something arrives. */
export function purchaseOrderStatusFor(
  lines: Array<{ quantity: number; received: number }>,
): 'DRAFT' | 'PARTIAL' | 'RECEIVED' {
  if (lines.length === 0) return 'DRAFT'
  if (lines.every((line) => line.received <= 0)) return 'DRAFT'
  return lines.every((line) => line.received >= line.quantity) ? 'RECEIVED' : 'PARTIAL'
}

/** What is still owed on a line: ordered less received, never below zero. */
export function remainingOnOrder(quantity: number, received: number): number {
  return round3(Math.max(quantity - received, 0))
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A date input, read as UTC midnight — the same convention schedules and certificates use. */
function isoDayToUtc(value: string): Date | null {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10) === value ? date : null
}

const optionalDay = z
  .union([z.literal(''), z.string().regex(ISO_DAY, 'Use a date like 2026-10-30.')])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value))
  .superRefine((value, ctx) => {
    if (value !== null && isoDayToUtc(value) === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'That is not a real date.' })
    }
  })
  .transform((value) => (value === null ? null : isoDayToUtc(value)))

const quantity = z.coerce
  .number()
  .min(0, 'A quantity cannot be negative.')
  .max(1_000_000, 'That is not a plausible quantity.')
  .transform(round3)

/**
 * Raising a PO from a supplier's reorder group.
 *
 * Every line on the form is offered with its suggested quantity, so the form posts a row per part and
 * the store blanks the ones it does not want. Cost is **not** posted: it is the catalogue's, read
 * again in the service, so a stale page cannot price an order.
 */
export const raisePurchaseOrderSchema = z.object({
  expectedAt: optionalDay,
  lines: z
    .array(
      z.object({
        partId: z.string().trim().min(1, 'Choose a part.').max(40),
        quantity,
      }),
    )
    .min(1, 'No parts were on the form.')
    .max(200),
})

export type RaisePurchaseOrderInput = z.infer<typeof raisePurchaseOrderSchema>

/**
 * Recording a delivery against a PO. One receipt names one location; a delivery arriving split across
 * two shelves is two receipts. The serial rides along for a traced part, the same courtesy the store's
 * own receipt form makes.
 */
export const receivePurchaseOrderSchema = z.object({
  locationId: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => (value ? value : null)),
  lines: z
    .array(
      z.object({
        lineId: z.string().trim().min(1, 'Choose a line.').max(40),
        received: quantity,
        serialOrBatch: z
          .string()
          .trim()
          .max(120)
          .optional()
          .transform((value) => (value ? value : null)),
      }),
    )
    .min(1, 'No lines were on the form.'),
})

export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>
