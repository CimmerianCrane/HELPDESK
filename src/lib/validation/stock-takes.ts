import { z } from 'zod'

/**
 * Counting the shelf (brief §9, slice 26).
 *
 * The one decision here is **what a variance is**: the quantity counted less the quantity the system
 * said, never the other way round. It is computed by one pure function because the screen, the review
 * step and the posted movement all have to agree about which way round it goes — a sign flipped in
 * one of them silently doubles the error it is meant to fix.
 *
 * The second rule is who may approve: counting is `stock.move` (a technician can count a van), but
 * approving the difference so it becomes a real ledger entry is `stocktake.approve`.
 */

export const STOCK_TAKE_STATUS_LABELS = {
  DRAFT: 'Draft',
  COUNTING: 'Counting',
  REVIEW: 'Review',
  APPROVED: 'Approved',
  CANCELLED: 'Cancelled',
} as const

export type StockTakeStatusName = keyof typeof STOCK_TAKE_STATUS_LABELS

/** The statuses a session can still be worked on: no more counting once it is approved or dropped. */
export const OPEN_STOCK_TAKE_STATUSES = ['DRAFT', 'COUNTING', 'REVIEW'] as const

const round3 = (value: number) => Math.round(value * 1000) / 1000

/** Counted less system. Positive is stock found that the books did not have. */
export function varianceFor(counted: number, system: number): number {
  return round3(counted - system)
}

/** A line needs looking at again when the count is off, and nothing has been recounted yet. */
export function needsRecount(line: { variance: number | null; needsRecount: boolean }): boolean {
  return line.needsRecount || (line.variance !== null && line.variance !== 0)
}

/**
 * A session's state, derived from its lines rather than posted by a button.
 *
 * `REVIEW` once every scope line has a counted quantity — including the case of **no** lines, where
 * the books show nothing at that location and there is therefore nothing left to count. A partially
 * counted session stays `COUNTING`.
 */
export function stockTakeStatusFor(
  lines: Array<{ countedQty: number | null }>,
): 'DRAFT' | 'COUNTING' | 'REVIEW' {
  if (lines.every((line) => line.countedQty === null)) {
    return lines.length === 0 ? 'REVIEW' : 'DRAFT'
  }
  return lines.every((line) => line.countedQty !== null) ? 'REVIEW' : 'COUNTING'
}

/** The reason codes the brief asks for (§9), kept as data so a report can group by them later. */
export const STOCK_TAKE_REASON_CODES = [
  'Miscount',
  'Damaged / scrapped',
  'Issued but not recorded',
  'Received but not recorded',
  'Found in another location',
  'Supplier short delivery',
  'Other',
] as const

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : null))

/**
 * Opening a session. The scope is a location — a whole-store count is the warehouse, a van count is
 * the van — plus an optional category narrowing it to lines whose part number starts with it.
 */
export const createStockTakeSchema = z.object({
  scopeLocationId: z.string().trim().min(1, 'Choose the location to count.'),
  scopeCategory: optionalText(80),
  /** Blind: the counter is not shown the system quantity. ON is the safe default the form sends. */
  blindCount: z
    .union([z.literal('on'), z.literal('true'), z.literal(''), z.undefined()])
    .transform((value) => value === 'on' || value === 'true'),
})

export type CreateStockTakeInput = z.infer<typeof createStockTakeSchema>

/**
 * Saving counted quantities. Every scope line is posted with whatever was typed; a blank leaves the
 * line uncounted rather than zero, because a zero is a real answer and a blank is "not yet".
 */
export const recordCountsSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().trim().min(1, 'Choose a line.').max(40),
        counted: z
          .string()
          .trim()
          .max(20)
          .optional()
          .default('')
          .transform((value) => {
            if (value === '') return null
            const number = Number(value)
            return Number.isFinite(number) && number >= 0 ? round3(number) : null
          }),
        /** Why this line disagrees. Optional per line; the approval asks for one once if any is short. */
        reasonCode: optionalText(80),
      }),
    )
    .min(1, 'No lines were on the form.')
    .max(1000),
})

export type RecordCountsInput = z.infer<typeof recordCountsSchema>

/**
 * Approving posts the difference. A reason is required when anything is being written off, because a
 * write-off is stock leaving without a sale and the ledger has to say why.
 */
export const approveStockTakeSchema = z.object({
  reasonCode: optionalText(80),
})

export type ApproveStockTakeInput = z.infer<typeof approveStockTakeSchema>
