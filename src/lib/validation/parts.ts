import { z } from 'zod'
import type { MovementType } from '@prisma/client'

/**
 * The parts catalogue and the stock ledger (brief §9, slice 22).
 *
 * Two rules are decided here, as pure data and arithmetic, because they are the ones a screen can
 * get wrong and a test can pin:
 *
 * - **Which way a movement pushes stock.** Derived from the type and the two locations, never from a
 *   signed quantity on the form: an `ISSUE` leaves its source and a `RECEIVE` enters its target, and
 *   a `TRANSFER` does both. The sign is applied once, in `postMovement`.
 * - **Whether a part is under its reorder level.** An on-hand of zero with a level set is below it;
 *   a part with no level set is never "below" because nobody asked to be told.
 */

export const MOVEMENT_TYPES = [
  'RECEIVE',
  'ISSUE',
  'RETURN',
  'TRANSFER',
  'ADJUST',
  'WRITEOFF',
] as const

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  RECEIVE: 'Received',
  ISSUE: 'Issued',
  RETURN: 'Returned',
  TRANSFER: 'Transferred',
  ADJUST: 'Adjusted',
  WRITEOFF: 'Written off',
}

/**
 * Which side of the ledger a movement adds to. `ISSUE` and `WRITEOFF` leave the source location;
 * `RECEIVE` and `RETURN` enter the target; `TRANSFER` and `ADJUST` move a quantity one way between
 * two locations (from the source, or into the target when there is no source).
 */
export function movementSigns(type: MovementType, hasSource: boolean): {
  from: -1 | 0
  to: 1 | 0
} {
  switch (type) {
    case 'ISSUE':
    case 'WRITEOFF':
      return { from: -1, to: 0 }
    case 'RECEIVE':
    case 'RETURN':
      return { from: 0, to: 1 }
    case 'TRANSFER':
    case 'ADJUST':
      return hasSource ? { from: -1, to: 1 } : { from: 0, to: 1 }
  }
}

/**
 * A part is below reorder when a level is set and on hand is strictly under it.
 *
 * Stock is allowed to go **negative** rather than the posting being refused: the report that issues
 * the part is a signed field document, and losing it because the shelf count is one short is worse
 * than a stock figure that is visibly wrong. The parts screen marks a negative line in red, which is
 * the signal to count the shelf and post an `ADJUST`.
 */
export function needsReorder(onHand: number, reorderLevel: number | null): boolean {
  return reorderLevel !== null && onHand < reorderLevel
}

export const partFilterSchema = z.object({
  q: z.string().trim().max(160).optional().default(''),
  brand: z.string().trim().max(80).optional().default(''),
  /** `below` shows only the lines at or under their reorder level; anything else is everything. */
  level: z
    .union([z.literal(''), z.literal('below')])
    .optional()
    .transform((value) => (value === 'below' ? 'below' : null)),
})

const money = (label: string) =>
  z.coerce
    .number()
    .min(0, `${label} cannot be negative.`)
    .max(10_000_000, 'That is not a plausible price.')
    .transform((value) => Math.round(value * 100) / 100)

const optionalQty = (label: string) =>
  z
    .union([z.literal(''), z.undefined(), z.coerce.number().positive(`${label} must be above zero.`)])
    .transform((value) => (value === '' || value === undefined ? null : Math.round(value * 1000) / 1000))

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : null))

/**
 * A part as the office types it. The catalogue is the one place a price is *set*; a report that
 * issues the part copies it at that moment and never changes it afterwards.
 */
export const partFields = {
  partNumber: z
    .string()
    .trim()
    .min(1, 'A part number is required.')
    .max(80, 'Use 80 characters or fewer.')
    .transform((value) => value.toUpperCase()),
  description: z.string().trim().min(1, 'Describe the part.').max(300),
  brand: optionalText(80),
  /** Comma-separated on the form; stored as an array so a model search is one `has` away. */
  compatibleModels: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((model) => model.trim())
        .filter(Boolean)
        .slice(0, 50),
    ),
  uom: z.string().trim().min(1, 'A unit of measure is required.').max(20),
  cost: money('Cost'),
  sellPrice: money('Sell price'),
  reorderLevel: optionalQty('The reorder level'),
  reorderQty: optionalQty('The reorder quantity'),
  /** Critical items are traced by serial or batch (wire rope, hooks, brakes, electrical). */
  trackSerialOrBatch: z
    .union([z.literal('on'), z.literal('true'), z.literal(''), z.undefined()])
    .transform((value) => value === 'on' || value === 'true'),
}

export const createPartSchema = z.object(partFields)
export const updatePartSchema = z.object(partFields)

export type CreatePartInput = z.infer<typeof createPartSchema>
export type UpdatePartInput = z.infer<typeof updatePartSchema>

/**
 * The ways the store adds to the ledger from a screen. `ISSUE` is absent on purpose: stock leaves
 * because a **job** consumed it, and that movement is written where the report is submitted.
 */
export const STOCK_ENTRY_TYPES = ['RECEIVE', 'RETURN', 'ADJUST'] as const

export const stockEntrySchema = z.object({
  type: z.enum(STOCK_ENTRY_TYPES),
  /** For `ADJUST` this is the counted quantity; for the others it is what arrived. */
  quantity: z.coerce
    .number()
    .min(0, 'A quantity cannot be negative.')
    .max(1_000_000, 'That is not a plausible quantity.'),
  locationId: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => (value ? value : null)),
  serialOrBatch: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => (value ? value : null)),
  reasonCode: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((value) => (value ? value : null)),
  unitCost: z
    .union([z.literal(''), z.undefined(), z.coerce.number().min(0).max(10_000_000)])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
})

export type StockEntryInput = z.infer<typeof stockEntrySchema>
