import type { PurchaseOrderStatus } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { needsReorder } from '@/lib/validation/parts'
import { parseInput } from '@/lib/validation/parse'
import {
  OPEN_PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_STATUS_LABELS,
  purchaseOrderStatusFor,
  raisePurchaseOrderSchema,
  receivePurchaseOrderSchema,
  remainingOnOrder,
  suggestedOrderQuantity,
} from '@/lib/validation/purchase-orders'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError, ValidationError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import type { AuthContext } from '@/server/auth/types'
import { nextDocumentNumber } from '@/server/documents/sequence'
import { assertLocationsExist } from './locations'
import { defaultLocation, postMovement } from './stock'

/**
 * Reorder suggestions and purchase orders (brief §9, slice 25).
 *
 * A part below its reorder level is grouped by the supplier the catalogue prefers, with the quantity
 * the store would order. Raising a PO snapshots the part's description and cost the way an invoice
 * does, so a reprint of the order says what was ordered rather than what the catalogue says today.
 * Receiving posts one `RECEIVE` per line through `postMovement` — the ledger and the PO's running
 * quantity are the same arrival, so the shelf and the paperwork cannot drift (rule 10).
 *
 * A PO is never deleted and its status is derived from what its lines have received.
 */

export interface ReorderLine {
  partId: string
  partNumber: string
  description: string
  uom: string
  onHand: number
  reorderLevel: number | null
  cost: number
  suggestedQuantity: number
}

export interface ReorderGroup {
  /** `null` is the "no preferred supplier" group: shown, but no PO can be raised for it. */
  supplier: { id: string; name: string; leadTimeDays: number | null } | null
  lines: ReorderLine[]
  /** Suggested quantity × catalogue cost, so the store sees the size of the order before raising it. */
  estimatedCost: number
}

const round2 = (value: number) => Math.round(value * 100) / 100
const round3 = (value: number) => Math.round(value * 1000) / 1000

/** Everything below its reorder level, grouped by preferred supplier. */
export async function reorderGroups(
  context: AuthContext,
  client: Tx = db,
): Promise<ReorderGroup[]> {
  assertCan(context, 'part.read')

  const rows = await client.part.findMany({
    where: { deletedAt: null, isActive: true, reorderLevel: { not: null } },
    orderBy: { partNumber: 'asc' },
    select: {
      id: true,
      partNumber: true,
      description: true,
      uom: true,
      cost: true,
      reorderLevel: true,
      reorderQty: true,
      preferredSupplier: { select: { id: true, name: true, leadTimeDays: true } },
      stockLevels: { select: { quantity: true } },
    },
  })

  const groups = new Map<string | null, ReorderGroup>()

  for (const row of rows) {
    const onHand = round3(
      row.stockLevels.reduce((sum, level) => sum + Number(level.quantity), 0),
    )
    const reorderLevel = row.reorderLevel === null ? null : Number(row.reorderLevel)
    if (!needsReorder(onHand, reorderLevel)) continue

    const key = row.preferredSupplier?.id ?? null
    const group = groups.get(key) ?? {
      supplier: row.preferredSupplier ?? null,
      lines: [],
      estimatedCost: 0,
    }

    const suggestedQuantity = suggestedOrderQuantity(
      onHand,
      reorderLevel,
      row.reorderQty === null ? null : Number(row.reorderQty),
    )
    group.lines.push({
      partId: row.id,
      partNumber: row.partNumber,
      description: row.description,
      uom: row.uom,
      onHand,
      reorderLevel,
      cost: Number(row.cost),
      suggestedQuantity,
    })
    group.estimatedCost = round2(group.estimatedCost + suggestedQuantity * Number(row.cost))
    groups.set(key, group)
  }

  // Named suppliers alphabetically, and the unassigned group last: it is the leftover, not a supplier.
  return [...groups.values()].sort((left, right) => {
    if (left.supplier === null) return 1
    if (right.supplier === null) return -1
    return left.supplier.name.localeCompare(right.supplier.name)
  })
}

export interface PurchaseOrderLineView {
  id: string
  partNumber: string | null
  description: string
  uom: string | null
  quantity: number
  unitCost: number
  receivedQuantity: number
  remaining: number
}

export interface OpenPurchaseOrderView {
  id: string
  number: string
  status: PurchaseOrderStatus
  supplierName: string
  expectedAt: Date | null
  total: number
  lines: PurchaseOrderLineView[]
}

/** The orders still owed to us: draft, sent and partly received. */
export async function listOpenPurchaseOrders(
  context: AuthContext,
  client: Tx = db,
): Promise<OpenPurchaseOrderView[]> {
  assertCan(context, 'purchaseorder.write')

  const rows = await client.purchaseOrder.findMany({
    where: { status: { in: [...OPEN_PURCHASE_ORDER_STATUSES] } },
    orderBy: [{ createdAt: 'desc' }],
    take: 20,
    select: {
      id: true,
      number: true,
      status: true,
      expectedAt: true,
      total: true,
      supplier: { select: { name: true } },
      lines: {
        orderBy: { id: 'asc' },
        select: {
          id: true,
          partId: true,
          description: true,
          quantity: true,
          unitCost: true,
          receivedQuantity: true,
        },
      },
    },
  })

  // `PurchaseOrderLine.partId` has never been a relation, so the part's number and unit come from one
  // lookup over every part on the page rather than one query per line.
  const parts = await client.part.findMany({
    where: {
      id: {
        in: [...new Set(rows.flatMap((order) => order.lines.map((line) => line.partId)))].filter(
          (id): id is string => Boolean(id),
        ),
      },
    },
    select: { id: true, partNumber: true, uom: true },
  })
  const partById = new Map(parts.map((part) => [part.id, part]))

  return rows.map((order) => ({
    id: order.id,
    number: order.number,
    status: order.status,
    supplierName: order.supplier.name,
    expectedAt: order.expectedAt,
    total: Number(order.total),
    lines: order.lines.map((line) => ({
      id: line.id,
      partNumber: line.partId ? (partById.get(line.partId)?.partNumber ?? null) : null,
      description: line.description,
      uom: line.partId ? (partById.get(line.partId)?.uom ?? null) : null,
      quantity: Number(line.quantity),
      unitCost: Number(line.unitCost),
      receivedQuantity: Number(line.receivedQuantity),
      remaining: remainingOnOrder(Number(line.quantity), Number(line.receivedQuantity)),
    })),
  }))
}

/**
 * Raises one PO for one supplier's reorder group.
 *
 * Quantities come from the form; description and cost are re-read from the catalogue inside the
 * transaction, so a stale page cannot price an order or keep a part that has been re-pointed at
 * another supplier. A line with no quantity is the store saying "not this one".
 */
export async function raisePurchaseOrder(
  context: AuthContext,
  supplierId: string,
  raw: unknown,
  client: Tx = db,
): Promise<{ id: string; number: string }> {
  assertCan(context, 'purchaseorder.write')
  const input = parseInput(raisePurchaseOrderSchema, raw)

  const wanted = input.lines.filter((line) => line.quantity > 0)
  if (wanted.length === 0) {
    throw new ValidationError({ lines: ['Enter a quantity on at least one line.'] })
  }

  return withAudit(
    context,
    async (tx, log) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: supplierId, deletedAt: null },
        select: { id: true },
      })
      if (!supplier) throw new NotFoundError('No such supplier.')

      const parts = await tx.part.findMany({
        where: {
          id: { in: wanted.map((line) => line.partId) },
          deletedAt: null,
          preferredSupplierId: supplierId,
        },
        select: { id: true, description: true, cost: true },
      })
      const byId = new Map(parts.map((part) => [part.id, part]))

      const lines = wanted.flatMap((line) => {
        const part = byId.get(line.partId)
        if (!part) return []
        return [
          {
            partId: part.id,
            description: part.description,
            quantity: line.quantity,
            unitCost: Number(part.cost),
          },
        ]
      })
      if (lines.length === 0) {
        throw new RuleError(
          'None of those parts are supplied by that supplier now. Reload the page and try again.',
        )
      }

      const number = await nextDocumentNumber(tx, 'PURCHASE_ORDER')
      const total = round2(
        lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
      )

      const created = await tx.purchaseOrder.create({
        data: { number, supplierId, expectedAt: input.expectedAt, total, lines: { create: lines } },
        select: { id: true, number: true },
      })

      await log({
        entity: 'PurchaseOrder',
        entityId: created.id,
        action: 'CREATE',
        after: {
          number,
          supplierId,
          expectedAt: input.expectedAt,
          total,
          lines,
        } as unknown as Record<string, unknown>,
      })

      return created
    },
    client,
  )
}

/**
 * Records a delivery against a PO: one `RECEIVE` per line, at the cost the line was ordered at, into
 * one location.
 *
 * More than remains on the line is refused rather than accepted: an over-delivery goes through the
 * store's own receipt form, because that is a delivery nobody ordered and the paperwork should not
 * pretend otherwise. Receiving the whole order moves the PO to `RECEIVED`; part of it to `PARTIAL`.
 */
export async function receivePurchaseOrder(
  context: AuthContext,
  purchaseOrderId: string,
  raw: unknown,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'purchaseorder.write')
  const input = parseInput(receivePurchaseOrderSchema, raw)

  const arrivals = input.lines.filter((line) => line.received > 0)
  if (arrivals.length === 0) {
    throw new ValidationError({ lines: ['Enter what arrived on at least one line.'] })
  }

  await withAudit(
    context,
    async (tx, log) => {
      const order = await tx.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        select: {
          id: true,
          number: true,
          status: true,
          lines: {
            select: {
              id: true,
              partId: true,
              description: true,
              quantity: true,
              receivedQuantity: true,
              unitCost: true,
            },
          },
        },
      })
      if (!order) throw new NotFoundError('No such purchase order.')
      if (order.status === 'CANCELLED' || order.status === 'RECEIVED') {
        throw new RuleError(
          `Purchase order ${order.number} is ${PURCHASE_ORDER_STATUS_LABELS[order.status].toLowerCase()} and takes no more deliveries.`,
        )
      }

      const locationId = input.locationId ?? (await defaultLocation(tx))
      await assertLocationsExist(tx, [locationId])

      const parts = await tx.part.findMany({
        where: {
          id: {
            in: order.lines.flatMap((line) => (line.partId ? [line.partId] : [])),
          },
        },
        select: { id: true, uom: true },
      })
      const uomById = new Map(parts.map((part) => [part.id, part.uom]))

      const byId = new Map(order.lines.map((line) => [line.id, line]))

      for (const arrival of arrivals) {
        const line = byId.get(arrival.lineId)
        if (!line) {
          throw new RuleError('That line is not on this purchase order. Reload the page and try again.')
        }
        if (!line.partId) {
          throw new RuleError(
            `${line.description} is not linked to a catalogue part, so it cannot be received into stock.`,
          )
        }

        const remaining = remainingOnOrder(Number(line.quantity), Number(line.receivedQuantity))
        if (arrival.received > remaining) {
          throw new RuleError(
            `${line.description}: only ${remaining}${uomById.has(line.partId) ? ` ${uomById.get(line.partId)}` : ''} is still on order. Receive the extra as a separate stock entry.`,
          )
        }

        await postMovement(tx, log, {
          partId: line.partId,
          type: 'RECEIVE',
          quantity: arrival.received,
          toLocationId: locationId,
          serialOrBatch: arrival.serialOrBatch,
          unitCost: Number(line.unitCost),
          purchaseOrderId: order.id,
          movedById: context.userId,
          reasonCode: `Received on ${order.number}`,
        })

        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { receivedQuantity: { increment: arrival.received } },
        })
      }

      const after = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: order.id },
        select: { quantity: true, receivedQuantity: true },
      })
      const status = purchaseOrderStatusFor(
        after.map((line) => ({
          quantity: Number(line.quantity),
          received: Number(line.receivedQuantity),
        })),
      )

      await tx.purchaseOrder.update({ where: { id: order.id }, data: { status } })
      await log({
        entity: 'PurchaseOrder',
        entityId: order.id,
        action: 'UPDATE',
        before: { status: order.status },
        after: { status },
      })
    },
    client,
  )
}
