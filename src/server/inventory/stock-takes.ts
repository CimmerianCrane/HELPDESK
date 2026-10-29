import type { StockTakeStatus } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import {
  OPEN_STOCK_TAKE_STATUSES,
  approveStockTakeSchema,
  createStockTakeSchema,
  recordCountsSchema,
  stockTakeStatusFor,
  varianceFor,
} from '@/lib/validation/stock-takes'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError, ValidationError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import type { AuthContext } from '@/server/auth/types'
import { adjustToCounted } from './parts'
import { assertLocationsExist } from './locations'
import { nextDocumentNumber } from '@/server/documents/sequence'

/**
 * Counting the shelf (brief §9, slice 26).
 *
 * A session is opened over one location, snapshots the system quantity of every part in scope, and is
 * counted line by line. Approving it posts **one movement per line that disagrees** through the same
 * `adjustToCounted` the part page's count box uses — an upward difference as `ADJUST`, a downward one
 * as `WRITEOFF` — each carrying `stockTakeId`, so the ledger says which count corrected it.
 *
 * The system quantity is a snapshot: it is what the books said when the session opened, and it is the
 * number a person reviewing variance should be shown. The posting re-reads the live level, so a
 * receipt that landed mid-count is not silently reversed by approving the old figure.
 */

export interface StockTakeLineView {
  id: string
  partId: string
  partNumber: string
  description: string
  uom: string
  locationName: string
  systemQty: number
  countedQty: number | null
  variance: number | null
  needsRecount: boolean
  reasonCode: string | null
}

export interface StockTakeSummary {
  id: string
  reference: string
  status: StockTakeStatus
  blindCount: boolean
  /** The location's name; a session is opened against exactly one. */
  locationName: string | null
  scopeCategory: string | null
  createdAt: Date
  approvedAt: Date | null
  lineCount: number
  countedCount: number
  /** Counted lines whose count disagreed with the books — what approving would post. */
  varianceLines: number
}

/** The words a reference carries: `ST-2026-0001`, from the same sequence as every other document. */

/**
 * Every session, newest first. Not paged: a store opens a handful of counts a year, and a list of
 * them is what makes "did we count the van in March" answerable.
 */
export async function listStockTakes(
  context: AuthContext,
  client: Tx = db,
): Promise<StockTakeSummary[]> {
  assertCan(context, 'part.read')

  const rows = await client.stockTake.findMany({
    orderBy: [{ createdAt: 'desc' }],
    take: 50,
    select: {
      id: true,
      reference: true,
      status: true,
      blindCount: true,
      scopeLocationId: true,
      scopeCategory: true,
      createdAt: true,
      approvedAt: true,
      lines: { select: { countedQty: true, variance: true } },
    },
  })

  const names = await locationNames(
    client,
    rows.flatMap((row) => (row.scopeLocationId ? [row.scopeLocationId] : [])),
  )

  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    status: row.status,
    blindCount: row.blindCount,
    locationName: row.scopeLocationId ? (names.get(row.scopeLocationId) ?? null) : null,
    scopeCategory: row.scopeCategory,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
    lineCount: row.lines.length,
    countedCount: row.lines.filter((line) => line.countedQty !== null).length,
    varianceLines: row.lines.filter((line) => line.variance !== null && Number(line.variance) !== 0)
      .length,
  }))
}

export interface StockTakeDetail extends StockTakeSummary {
  lines: StockTakeLineView[]
}

export async function getStockTake(
  context: AuthContext,
  stockTakeId: string,
  client: Tx = db,
): Promise<StockTakeDetail> {
  assertCan(context, 'part.read')

  const row = await client.stockTake.findUnique({
    where: { id: stockTakeId },
    select: {
      id: true,
      reference: true,
      status: true,
      blindCount: true,
      scopeLocationId: true,
      scopeCategory: true,
      createdAt: true,
      approvedAt: true,
      lines: {
        orderBy: { id: 'asc' },
        select: {
          id: true,
          partId: true,
          locationId: true,
          systemQty: true,
          countedQty: true,
          variance: true,
          needsRecount: true,
          reasonCode: true,
        },
      },
    },
  })
  if (!row) throw new NotFoundError('No such stock take.')

  const partIds = [...new Set(row.lines.map((line) => line.partId))]
  const locationIds = [...new Set(row.lines.map((line) => line.locationId))]

  const [parts, names] = await Promise.all([
    client.part.findMany({
      where: { id: { in: partIds } },
      select: { id: true, partNumber: true, description: true, uom: true },
    }),
    locationNames(client, locationIds),
  ])
  const partById = new Map(parts.map((part) => [part.id, part]))

  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    blindCount: row.blindCount,
    locationName: row.scopeLocationId ? (names.get(row.scopeLocationId) ?? null) : null,
    scopeCategory: row.scopeCategory,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
    lineCount: row.lines.length,
    countedCount: row.lines.filter((line) => line.countedQty !== null).length,
    varianceLines: row.lines.filter((line) => line.variance !== null && Number(line.variance) !== 0)
      .length,
    lines: row.lines.map((line) => {
      const part = partById.get(line.partId)
      return {
        id: line.id,
        partId: line.partId,
        partNumber: part?.partNumber ?? '',
        description: part?.description ?? '',
        uom: part?.uom ?? '',
        locationName: names.get(line.locationId) ?? '',
        systemQty: Number(line.systemQty),
        countedQty: line.countedQty === null ? null : Number(line.countedQty),
        variance: line.variance === null ? null : Number(line.variance),
        needsRecount: line.needsRecount,
        reasonCode: line.reasonCode,
      }
    }),
  }
}

/**
 * Opens a session and snapshots what the books say for every part in scope.
 *
 * A location with nothing at it opens an empty session rather than being refused: "we counted the van
 * and there was nothing in it" is a real, useful answer, and the count that finds it is the record of
 * it. A location that already has a session open is refused — two people counting one shelf produce
 * two answers and one argument.
 */
export async function createStockTake(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<{ id: string; reference: string }> {
  assertCan(context, 'stock.move')
  const input = parseInput(createStockTakeSchema, raw)

  return withAudit(
    context,
    async (tx, log) => {
      await assertLocationsExist(tx, [input.scopeLocationId])

      const open = await tx.stockTake.findFirst({
        where: {
          scopeLocationId: input.scopeLocationId,
          status: { in: [...OPEN_STOCK_TAKE_STATUSES] },
        },
        select: { reference: true },
      })
      if (open) {
        throw new RuleError(
          `${open.reference} is already counting that location. Finish or cancel it before opening another.`,
        )
      }

      const levels = await tx.stockLevel.findMany({
        where: {
          locationId: input.scopeLocationId,
          ...(input.scopeCategory
            ? { part: { partNumber: { startsWith: input.scopeCategory, mode: 'insensitive' } } }
            : {}),
        },
        select: { partId: true, quantity: true },
      })

      const reference = await nextDocumentNumber(tx, 'STOCK_TAKE')

      const created = await tx.stockTake.create({
        data: {
          reference,
          scopeLocationId: input.scopeLocationId,
          scopeCategory: input.scopeCategory,
          blindCount: input.blindCount,
          status: stockTakeStatusFor(levels.map(() => ({ countedQty: null }))),
          lines: {
            create: levels.map((level) => ({
              partId: level.partId,
              locationId: input.scopeLocationId,
              systemQty: level.quantity,
            })),
          },
        },
        select: { id: true, reference: true },
      })

      await log({
        entity: 'StockTake',
        entityId: created.id,
        action: 'CREATE',
        after: {
          reference,
          scopeLocationId: input.scopeLocationId,
          scopeCategory: input.scopeCategory,
          blindCount: input.blindCount,
          lines: levels.length,
        },
      })

      return created
    },
    client,
  )
}

/**
 * Saves what the counter typed. A blank line is left uncounted — a zero is an answer, a blank is not.
 *
 * Re-submitting is the recount: the counts can be corrected as many times as the session is open.
 * The variance is recomputed against the **snapshot**, so the review reads the same difference the
 * system quantity was taken against, not one that moved underneath the counter.
 */
export async function recordCounts(
  context: AuthContext,
  stockTakeId: string,
  raw: unknown,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'stock.move')
  const input = parseInput(recordCountsSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const take = await tx.stockTake.findUnique({
        where: { id: stockTakeId },
        select: { id: true, reference: true, status: true },
      })
      if (!take) throw new NotFoundError('No such stock take.')
      if (take.status === 'APPROVED' || take.status === 'CANCELLED') {
        throw new RuleError(
          `${take.reference} is ${take.status.toLowerCase()} and takes no more counts.`,
        )
      }

      const written = input.lines.filter((line) => line.counted !== null)
      if (written.length > 0) {
        const lines = await tx.stockTakeLine.findMany({
          where: { stockTakeId, id: { in: written.map((line) => line.lineId) } },
          select: { id: true, systemQty: true },
        })
        const byId = new Map(lines.map((line) => [line.id, line]))

        for (const entry of written) {
          const line = byId.get(entry.lineId)
          if (!line) {
            throw new RuleError('One of those lines is not on this count. Reload and try again.')
          }
          await tx.stockTakeLine.update({
            where: { id: line.id },
            data: {
              countedQty: entry.counted,
              variance: varianceFor(entry.counted!, Number(line.systemQty)),
              reasonCode: entry.reasonCode,
              countedById: context.userId,
              countedAt: new Date(),
            },
          })
        }
      }

      const after = await tx.stockTakeLine.findMany({
        where: { stockTakeId },
        select: { countedQty: true },
      })
      const status = stockTakeStatusFor(
        after.map((line) => ({
          countedQty: line.countedQty === null ? null : Number(line.countedQty),
        })),
      )
      if (status !== take.status) {
        await tx.stockTake.update({ where: { id: stockTakeId }, data: { status } })
      }

      await log({
        entity: 'StockTake',
        entityId: stockTakeId,
        action: 'UPDATE',
        before: { status: take.status },
        after: { status, counted: after.filter((line) => line.countedQty !== null).length },
      })
    },
    client,
  )
}

/**
 * Approves the count: posts one correction per line that disagrees, and closes the session.
 *
 * Refused while any line is uncounted — approving a half-count would write off the lines nobody
 * looked at. The session's `systemQty` is a snapshot and the posting re-reads the live level (in
 * `adjustToCounted`), so stock that moved during the count is reconciled to what was actually counted
 * rather than to the figure from before the delivery.
 */
export async function approveStockTake(
  context: AuthContext,
  stockTakeId: string,
  raw: unknown = {},
  client: Tx = db,
): Promise<{ posted: number }> {
  assertCan(context, 'stocktake.approve')
  const input = parseInput(approveStockTakeSchema, raw)

  return withAudit(
    context,
    async (tx, log) => {
      const take = await tx.stockTake.findUnique({
        where: { id: stockTakeId },
        select: {
          id: true,
          reference: true,
          status: true,
          lines: {
            select: {
              id: true,
              partId: true,
              locationId: true,
              countedQty: true,
              variance: true,
              reasonCode: true,
            },
          },
        },
      })
      if (!take) throw new NotFoundError('No such stock take.')
      if (take.status === 'APPROVED' || take.status === 'CANCELLED') {
        throw new RuleError(`${take.reference} is already ${take.status.toLowerCase()}.`)
      }

      const uncounted = take.lines.filter((line) => line.countedQty === null)
      if (uncounted.length > 0) {
        throw new RuleError(
          `${uncounted.length} line${uncounted.length === 1 ? ' has' : 's have'} not been counted yet. Count every line, or cancel the session.`,
        )
      }

      const differing = take.lines.filter((line) => Number(line.variance) !== 0)
      if (differing.some((line) => Number(line.variance) < 0) && !input.reasonCode) {
        throw new ValidationError({
          reasonCode: ['Say why stock is missing before writing it off.'],
        })
      }

      const parts = await tx.part.findMany({
        where: { id: { in: [...new Set(differing.map((line) => line.partId))] } },
        select: { id: true, cost: true },
      })
      const partById = new Map(parts.map((part) => [part.id, part]))

      let posted = 0
      for (const line of differing) {
        const part = partById.get(line.partId)
        if (!part) throw new RuleError('A counted part is no longer in the catalogue.')

        const wrote = await adjustToCounted(
          tx,
          log,
          context,
          part,
          Number(line.countedQty),
          line.locationId,
          null,
          line.reasonCode ?? input.reasonCode,
          take.id,
          // A delivery that landed during the count may already match the count exactly. Skipping it
          // is the right answer, not a refused approval.
          false,
        )
        if (wrote) posted += 1
      }

      const approvedAt = new Date()
      await tx.stockTake.update({
        where: { id: take.id },
        data: {
          status: 'APPROVED',
          approvedById: context.userId,
          approvedAt,
        },
      })
      await log({
        entity: 'StockTake',
        entityId: take.id,
        action: 'UPDATE',
        before: { status: take.status },
        after: { status: 'APPROVED', posted, approvedAt },
      })

      return { posted }
    },
    client,
  )
}

/** Drops a session. Nothing was posted, so nothing is unwound — an approved count cannot be cancelled. */
export async function cancelStockTake(
  context: AuthContext,
  stockTakeId: string,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'stocktake.approve')

  await withAudit(
    context,
    async (tx, log) => {
      const take = await tx.stockTake.findUnique({
        where: { id: stockTakeId },
        select: { id: true, reference: true, status: true },
      })
      if (!take) throw new NotFoundError('No such stock take.')
      if (take.status === 'APPROVED') {
        throw new RuleError(
          `${take.reference} is approved and has posted its corrections. Count again rather than cancelling it.`,
        )
      }
      if (take.status === 'CANCELLED') return

      await tx.stockTake.update({ where: { id: take.id }, data: { status: 'CANCELLED' } })
      await log({
        entity: 'StockTake',
        entityId: take.id,
        action: 'UPDATE',
        before: { status: take.status },
        after: { status: 'CANCELLED' },
      })
    },
    client,
  )
}

async function locationNames(client: Tx, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter(Boolean))]
  if (wanted.length === 0) return new Map()
  const rows = await client.location.findMany({
    where: { id: { in: wanted } },
    select: { id: true, name: true },
  })
  return new Map(rows.map((row) => [row.id, row.name]))
}
