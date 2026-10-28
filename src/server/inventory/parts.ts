import type { MovementType, Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import {
  createPartSchema,
  needsReorder,
  partFilterSchema,
  stockEntrySchema,
  updatePartSchema,
} from '@/lib/validation/parts'
import { parseInput } from '@/lib/validation/parse'
import { withAudit, type AuditLogger } from '@/server/audit/audit'
import { NotFoundError, ValidationError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import type { AuthContext } from '@/server/auth/types'
import { defaultLocation, issueLocationFor, postMovement } from './stock'

/**
 * The parts book (brief §9, slice 22).
 *
 * The catalogue is **not tenant data**: a wire rope is the same wire rope whichever customer's crane
 * it goes on, so every role holding `part.read` sees the same book and the store holds `part.write`
 * to maintain it. That is why there is no `partReadWhere` in scope.ts — the capability is the whole
 * check, and the split that matters is read vs write.
 *
 * On-hand is the sum of `StockLevel` across locations, which `postMovement` keeps in step with the
 * ledger. Nothing here writes a level directly, and nothing here writes a movement except through it.
 */

export interface PartSummary {
  id: string
  partNumber: string
  description: string
  brand: string | null
  compatibleModels: string[]
  uom: string
  cost: number
  sellPrice: number
  reorderLevel: number | null
  reorderQty: number | null
  trackSerialOrBatch: boolean
  isActive: boolean
  /** Across every location. Can go negative, and the screen says so — see `needsReorder`. */
  onHand: number
  belowReorder: boolean
}

export interface PartLevel {
  locationId: string
  locationName: string
  locationType: string
  quantity: number
}

export interface PartMovement {
  id: string
  type: MovementType
  quantity: number
  serialOrBatch: string | null
  reasonCode: string | null
  movedAt: Date
  fromLocation: string | null
  toLocation: string | null
  job: { id: string; number: string } | null
}

export interface PartDetail extends PartSummary {
  levels: PartLevel[]
  movements: PartMovement[]
}

const partSelect = {
  id: true,
  partNumber: true,
  description: true,
  brand: true,
  compatibleModels: true,
  uom: true,
  cost: true,
  sellPrice: true,
  reorderLevel: true,
  reorderQty: true,
  trackSerialOrBatch: true,
  isActive: true,
  stockLevels: { select: { quantity: true } },
} satisfies Prisma.PartSelect

type PartRow = Prisma.PartGetPayload<{ select: typeof partSelect }>

/** Three decimals, the ledger's own precision, so a float never reaches a `Decimal(12,3)` column. */
const round3 = (value: number) => Math.round(value * 1000) / 1000

function toSummary(row: PartRow): PartSummary {
  const onHand = round3(row.stockLevels.reduce((sum, level) => sum + Number(level.quantity), 0))
  const reorderLevel = row.reorderLevel === null ? null : Number(row.reorderLevel)

  return {
    id: row.id,
    partNumber: row.partNumber,
    description: row.description,
    brand: row.brand,
    compatibleModels: row.compatibleModels,
    uom: row.uom,
    cost: Number(row.cost),
    sellPrice: Number(row.sellPrice),
    reorderLevel,
    reorderQty: row.reorderQty === null ? null : Number(row.reorderQty),
    trackSerialOrBatch: row.trackSerialOrBatch,
    isActive: row.isActive,
    onHand,
    belowReorder: needsReorder(onHand, reorderLevel),
  }
}

/**
 * The book, with the store's questions: what is this, do we have it, and what is running out.
 *
 * The "below reorder" filter is applied to the fetched rows rather than in the `where` clause:
 * on-hand is the sum of a relation, so the database cannot filter on it without a subquery the
 * catalogue's size does not justify. A few hundred parts, read once, is cheap.
 */
export async function listParts(
  context: AuthContext,
  raw: unknown = {},
  client: Tx = db,
): Promise<{ parts: PartSummary[]; belowCount: number; brands: string[] }> {
  assertCan(context, 'part.read')
  const filters = parseInput(partFilterSchema, raw)

  const rows = await client.part.findMany({
    where: {
      deletedAt: null,
      ...(filters.q
        ? {
            OR: [
              { partNumber: { contains: filters.q, mode: 'insensitive' as const } },
              { description: { contains: filters.q, mode: 'insensitive' as const } },
              // A model search is what a technician actually types ("Konecranes"), so it matches the
              // compatible-model list as well as the text.
              { compatibleModels: { has: filters.q } },
            ],
          }
        : {}),
      ...(filters.brand ? { brand: filters.brand } : {}),
    },
    orderBy: { partNumber: 'asc' },
    take: 1000,
    select: partSelect,
  })

  const all = rows.map(toSummary)
  const brands = [...new Set(all.map((part) => part.brand).filter((b): b is string => Boolean(b)))]

  return {
    parts: filters.level === 'below' ? all.filter((part) => part.belowReorder) : all,
    belowCount: all.filter((part) => part.belowReorder).length,
    brands: brands.sort(),
  }
}

export async function getPart(
  context: AuthContext,
  partId: string,
  client: Tx = db,
): Promise<PartDetail> {
  assertCan(context, 'part.read')

  const row = await client.part.findFirst({
    where: { id: partId, deletedAt: null },
    select: {
      ...partSelect,
      stockLevels: {
        select: { quantity: true, location: { select: { id: true, name: true, type: true } } },
        orderBy: { location: { name: 'asc' } },
      },
    },
  })
  if (!row) throw new NotFoundError('No such part.')

  // A part's own ledger, newest first: enough to answer "where did it all go?" without becoming the
  // stock report. The full history, filtered by entity, is the audit viewer's job.
  const movements = await client.stockMovement.findMany({
    where: { partId },
    orderBy: [{ movedAt: 'desc' }, { id: 'desc' }],
    take: 20,
    select: {
      id: true,
      type: true,
      quantity: true,
      serialOrBatch: true,
      reasonCode: true,
      movedAt: true,
      fromLocation: { select: { name: true } },
      toLocation: { select: { name: true } },
      job: { select: { id: true, number: true } },
    },
  })

  return {
    ...toSummary(row as PartRow),
    levels: row.stockLevels.map((level) => ({
      locationId: level.location.id,
      locationName: level.location.name,
      locationType: level.location.type,
      quantity: Number(level.quantity),
    })),
    movements: movements.map((movement) => ({
      id: movement.id,
      type: movement.type,
      quantity: Number(movement.quantity),
      serialOrBatch: movement.serialOrBatch,
      reasonCode: movement.reasonCode,
      movedAt: movement.movedAt,
      fromLocation: movement.fromLocation?.name ?? null,
      toLocation: movement.toLocation?.name ?? null,
      job: movement.job,
    })),
  }
}

export async function createPart(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<PartSummary> {
  assertCan(context, 'part.write')
  const input = parseInput(createPartSchema, raw)

  const existing = await client.part.findUnique({
    where: { partNumber: input.partNumber },
    select: { deletedAt: true },
  })
  // The column is unique, so an archived row still holds its number. Say which it is rather than let
  // the database's unique violation reach the form as an unreadable error.
  if (existing) {
    throw new ValidationError({
      partNumber: [
        existing.deletedAt
          ? 'That part number belongs to an archived part. Restore it rather than adding a second.'
          : 'That part number is already in the catalogue.',
      ],
    })
  }

  const created = await withAudit(
    context,
    async (tx, log) => {
      const row = await tx.part.create({ data: input, select: partSelect })
      await log({ entity: 'Part', entityId: row.id, action: 'CREATE', after: auditShape(row) })
      return row
    },
    client,
  )

  return toSummary(created)
}

export async function updatePart(
  context: AuthContext,
  partId: string,
  raw: unknown,
  client: Tx = db,
): Promise<PartSummary> {
  assertCan(context, 'part.write')
  const input = parseInput(updatePartSchema, raw)

  const clash = await client.part.findFirst({
    where: { partNumber: input.partNumber, id: { not: partId } },
    select: { id: true },
  })
  if (clash) {
    throw new ValidationError({ partNumber: ['That part number is already in the catalogue.'] })
  }

  const updated = await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.part.findFirst({
        where: { id: partId, deletedAt: null },
        select: partSelect,
      })
      if (!before) throw new NotFoundError('No such part.')

      const row = await tx.part.update({ where: { id: partId }, data: input, select: partSelect })
      await log({
        entity: 'Part',
        entityId: row.id,
        action: 'UPDATE',
        before: auditShape(before),
        after: auditShape(row),
      })
      return row
    },
    client,
  )

  return toSummary(updated)
}

/**
 * Adds stock: a delivery from a supplier, a return from a site, or a count that corrects a level.
 *
 * An `ADJUST` carries the **counted** quantity, not a difference: the person counting says what is on
 * the shelf, and the posting works out what to write. That is why it takes a different path.
 */
export async function postStockEntry(
  context: AuthContext,
  partId: string,
  raw: unknown,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'stock.move')
  const input = parseInput(stockEntrySchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const part = await tx.part.findFirst({
        where: { id: partId, deletedAt: null },
        select: { id: true, cost: true },
      })
      if (!part) throw new NotFoundError('No such part.')

      const locationId = input.locationId ?? (await defaultLocation(tx))

      if (input.type === 'ADJUST') {
        await adjustToCounted(tx, log, context, part, input.quantity, locationId, input.reasonCode)
        return
      }

      if (!(input.quantity > 0)) {
        throw new ValidationError({ quantity: ['A quantity must be above zero.'] })
      }

      await postMovement(tx, log, {
        partId: part.id,
        type: input.type,
        quantity: input.quantity,
        toLocationId: locationId,
        serialOrBatch: input.serialOrBatch,
        reasonCode: input.reasonCode,
        unitCost: input.unitCost ?? Number(part.cost),
        movedById: context.userId,
      })
    },
    client,
  )
}

/**
 * Reconciles one location's level to a counted quantity.
 *
 * An upward correction is an `ADJUST` into the location; a downward one is a `WRITEOFF` of the
 * difference, because `WRITEOFF` is the movement type that already means "stock left without a sale"
 * and reusing `ADJUST` in both directions would need a second sign convention for one case.
 */
async function adjustToCounted(
  tx: Tx,
  log: AuditLogger,
  context: AuthContext,
  part: { id: string; cost: Prisma.Decimal },
  counted: number,
  locationId: string,
  reasonCode: string | null,
): Promise<void> {
  const level = await tx.stockLevel.findUnique({
    where: { partId_locationId: { partId: part.id, locationId } },
    select: { quantity: true },
  })
  const delta = round3(counted - (level ? Number(level.quantity) : 0))

  if (delta === 0) {
    throw new ValidationError({ quantity: ['That is already the quantity on hand.'] })
  }

  await postMovement(tx, log, {
    partId: part.id,
    type: delta > 0 ? 'ADJUST' : 'WRITEOFF',
    quantity: Math.abs(delta),
    ...(delta > 0 ? { toLocationId: locationId } : { fromLocationId: locationId }),
    reasonCode,
    unitCost: Number(part.cost),
    movedById: context.userId,
  })
}

/**
 * The movement a report's "parts used" becomes, so the field path and the store's own receipts are
 * written by the same function and neither can move a level the other does not see.
 */
export async function issuePartForReport(
  tx: Tx,
  log: AuditLogger,
  context: AuthContext,
  input: {
    partId: string
    quantity: number
    unitCost: number
    serialOrBatch: string | null
    jobId: string
    reportId: string
  },
): Promise<void> {
  await postMovement(tx, log, {
    partId: input.partId,
    type: 'ISSUE',
    quantity: input.quantity,
    fromLocationId: await issueLocationFor(tx, input.partId),
    unitCost: input.unitCost,
    serialOrBatch: input.serialOrBatch,
    jobId: input.jobId,
    reportId: input.reportId,
    movedById: context.userId,
  })
}

/** What goes in the audit row: the fields a person would ask about, not the whole Prisma payload. */
function auditShape(row: PartRow) {
  return {
    partNumber: row.partNumber,
    description: row.description,
    brand: row.brand,
    uom: row.uom,
    cost: Number(row.cost),
    sellPrice: Number(row.sellPrice),
    reorderLevel: row.reorderLevel === null ? null : Number(row.reorderLevel),
    trackSerialOrBatch: row.trackSerialOrBatch,
    isActive: row.isActive,
  }
}
