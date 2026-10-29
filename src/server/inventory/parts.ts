import type { MovementType, Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import {
  createPartSchema,
  locationBalances,
  needsReorder,
  partFilterSchema,
  stockEntrySchema,
  transferSchema,
  updatePartSchema,
} from '@/lib/validation/parts'
import { parseInput } from '@/lib/validation/parse'
import { withAudit, type AuditLogger } from '@/server/audit/audit'
import { NotFoundError, RuleError, ValidationError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { jobReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { assertLocationsExist } from './locations'
import { defaultLocation, issueLocationFor, postMovement } from './stock'
import { assertSupplierActive } from './suppliers'

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
  preferredSupplierId: string | null
  preferredSupplierName: string | null
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
  preferredSupplierId: true,
  preferredSupplier: { select: { name: true } },
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
    preferredSupplierId: row.preferredSupplierId,
    preferredSupplierName: row.preferredSupplier?.name ?? null,
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

/** The catalogue as a dropdown: the part the store is waiting for, chosen on a held job (slice 28). */
export async function partOptions(
  context: AuthContext,
  client: Tx = db,
): Promise<Array<{ id: string; partNumber: string; description: string }>> {
  assertCan(context, 'part.read')
  return client.part.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { partNumber: 'asc' },
    take: 500,
    select: { id: true, partNumber: true, description: true },
  })
}

/**
 * The jobs held waiting for this part (slice 28) — the other half of the link, shown on the part so
 * the store can see which customer is standing still while it is out of stock. Scoped by
 * `jobReadWhere`, so a technician sees only their own.
 */
export async function heldJobsForPart(
  context: AuthContext,
  partId: string,
  client: Tx = db,
): Promise<Array<{ id: string; number: string; customerName: string }>> {
  assertCan(context, 'part.read')

  const rows = await client.job.findMany({
    where: { ...jobReadWhere(context), status: 'ON_HOLD', onHoldPartId: partId },
    orderBy: { number: 'asc' },
    select: {
      id: true,
      number: true,
      customer: { select: { legalName: true, tradingName: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    customerName: row.customer.tradingName ?? row.customer.legalName,
  }))
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

export interface SerialTrace {
  serial: string
  /** Net quantity the ledger still holds under this serial — the rest of the batch. */
  held: number
  whereabouts: Array<{ locationName: string; quantity: number }>
  /** The jobs that took one, each with the cranes it was fitted to. */
  issuedTo: Array<{
    jobId: string
    jobNumber: string
    craneTags: string[]
    quantity: number
    issuedAt: Date
  }>
}

/**
 * Every serial and batch the ledger has ever seen for this part (slice 24, brief §9).
 *
 * The trace is the movements, read one way: a serial's position is the direction table applied to
 * the rows carrying that serial, so what it says and what `StockLevel` says come from the same rule.
 * `held` falling to zero means every piece of that batch has been issued, written off or moved on.
 */
export async function tracePartSerials(
  context: AuthContext,
  partId: string,
  client: Tx = db,
): Promise<SerialTrace[]> {
  assertCan(context, 'part.read')

  // Every serialled movement for one part, not a page of them: a balance computed from part of a
  // serial's history is a wrong answer, and "where is it" is exactly the question this answers.
  // shortcut: unbounded for a part with a decade of issues; add a per-serial window only if a real
  // catalogue line makes this screen slow.
  const movements = await client.stockMovement.findMany({
    where: { partId, serialOrBatch: { not: null } },
    orderBy: [{ movedAt: 'desc' }, { id: 'desc' }],
    select: {
      type: true,
      quantity: true,
      serialOrBatch: true,
      fromLocationId: true,
      toLocationId: true,
      movedAt: true,
      fromLocation: { select: { name: true } },
      toLocation: { select: { name: true } },
      job: {
        select: { id: true, number: true, cranes: { select: { crane: { select: { assetTag: true } } } } },
      },
    },
  })

  const bySerial = new Map<string, Array<Omit<(typeof movements)[number], 'quantity'> & { quantity: number }>>()
  for (const movement of movements) {
    const serial = movement.serialOrBatch!
    const rows = bySerial.get(serial) ?? []
    rows.push({ ...movement, quantity: Number(movement.quantity) })
    bySerial.set(serial, rows)
  }

  const traces: SerialTrace[] = []
  for (const [serial, rows] of bySerial) {
    const balances = locationBalances(rows)
    const nameOf = new Map<string, string>()
    for (const row of rows) {
      if (row.fromLocationId && row.fromLocation) nameOf.set(row.fromLocationId, row.fromLocation.name)
      if (row.toLocationId && row.toLocation) nameOf.set(row.toLocationId, row.toLocation.name)
    }

    const whereabouts = [...balances]
      .filter(([, quantity]) => quantity !== 0)
      .map(([locationId, quantity]) => ({ locationName: nameOf.get(locationId) ?? '', quantity }))
      .sort((a, b) => a.locationName.localeCompare(b.locationName))

    const issuedTo = rows
      .filter((row) => row.type === 'ISSUE' && row.job)
      .map((row) => ({
        jobId: row.job!.id,
        jobNumber: row.job!.number,
        craneTags: row.job!.cranes.map(({ crane }) => crane.assetTag),
        quantity: row.quantity,
        issuedAt: row.movedAt,
      }))

    traces.push({
      serial,
      held: Math.round([...balances.values()].reduce((sum, quantity) => sum + quantity, 0) * 1000) / 1000,
      whereabouts,
      issuedTo,
    })
  }

  // `movements` is newest first, so a Map built in insertion order is already newest serial first.
  return traces
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
  if (input.preferredSupplierId) await assertSupplierActive(client, input.preferredSupplierId)

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
  if (input.preferredSupplierId) await assertSupplierActive(client, input.preferredSupplierId)

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
        await adjustToCounted(
          tx,
          log,
          context,
          part,
          input.quantity,
          locationId,
          input.serialOrBatch,
          input.reasonCode,
        )
        return
      }

      if (!(input.quantity > 0)) {
        throw new ValidationError({ quantity: ['A quantity must be above zero.'] })
      }

      await assertLocationsExist(tx, [locationId])

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
 * Moves stock from one location to another (slice 23).
 *
 * A `TRANSFER` needs both ends named: a movement with no destination is a write-off and one with no
 * source is a receipt, so an unnamed end is a form that meant a different movement, not a transfer.
 * The source must actually hold the quantity — unlike an issue (which is a signed field document, so
 * it is never refused), a transfer is a store action with the shelf in front of the person, and
 * refusing it names the discrepancy right when it is cheapest to fix.
 */
export async function transferStock(
  context: AuthContext,
  partId: string,
  raw: unknown,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'stock.move')
  const input = parseInput(transferSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const part = await tx.part.findFirst({
        where: { id: partId, deletedAt: null },
        select: { id: true, cost: true, uom: true },
      })
      if (!part) throw new NotFoundError('No such part.')

      await assertLocationsExist(tx, [input.fromLocationId, input.toLocationId])

      const level = await tx.stockLevel.findUnique({
        where: { partId_locationId: { partId: part.id, locationId: input.fromLocationId } },
        select: { quantity: true },
      })
      const held = level ? Number(level.quantity) : 0
      if (held < input.quantity) {
        throw new RuleError(
          `That location holds ${round3(held)} ${part.uom}. Transfer no more than it holds, or post a count first.`,
        )
      }

      await postMovement(tx, log, {
        partId: part.id,
        type: 'TRANSFER',
        quantity: input.quantity,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        serialOrBatch: input.serialOrBatch,
        reasonCode: input.reasonCode,
        unitCost: Number(part.cost),
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
 *
 * The serial is carried through when the counter names one, so a correction on a traced part moves
 * the trace as well as the shelf — otherwise the batch would drift out of sight of the level.
 *
 * Exported because an approved stock take posts its differences through this exact function (slice
 * 26): a count is a count, whether it was typed on the part page or approved from a session.
 */
export async function adjustToCounted(
  tx: Tx,
  log: AuditLogger,
  context: AuthContext,
  part: { id: string; cost: Prisma.Decimal },
  counted: number,
  locationId: string,
  serialOrBatch: string | null,
  reasonCode: string | null,
  stockTakeId: string | null = null,
  /** The part page's count box says so out loud; an approval is reconciling to a count and is not. */
  strict = true,
): Promise<boolean> {
  const level = await tx.stockLevel.findUnique({
    where: { partId_locationId: { partId: part.id, locationId } },
    select: { quantity: true },
  })
  const delta = round3(counted - (level ? Number(level.quantity) : 0))

  if (delta === 0) {
    if (strict) throw new ValidationError({ quantity: ['That is already the quantity on hand.'] })
    return false
  }

  await postMovement(tx, log, {
    partId: part.id,
    type: delta > 0 ? 'ADJUST' : 'WRITEOFF',
    quantity: Math.abs(delta),
    ...(delta > 0 ? { toLocationId: locationId } : { fromLocationId: locationId }),
    serialOrBatch,
    reasonCode,
    unitCost: Number(part.cost),
    stockTakeId,
    movedById: context.userId,
  })
  return true
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
    fromLocationId: await issueLocationFor(tx, input.partId, input.serialOrBatch),
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
    preferredSupplierId: row.preferredSupplierId,
  }
}
