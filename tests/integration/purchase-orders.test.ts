import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, RuleError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { createPart } from '@/server/inventory/parts'
import {
  listOpenPurchaseOrders,
  raisePurchaseOrder,
  receivePurchaseOrder,
  reorderGroups,
} from '@/server/inventory/purchase-orders'
import { inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * Reorder and purchase orders against the real database, inside a transaction that always rolls back
 * (slice 25).
 *
 * The cases a screen cannot show: that a receipt moves the shelf through the one writer, that the PO's
 * status is derived from its lines, that a supplier's group is the only thing it can order, and that a
 * delivery larger than the order is refused rather than booked in.
 */

function contextFor(
  user: { id: string; name: string; email: string; role: Role },
  overrides: Partial<AuthContext> = {},
): AuthContext {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    technicianId: null,
    ip: '203.0.113.7',
    userAgent: 'vitest',
    ...overrides,
  }
}

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${role.toLowerCase()}-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

/** A supplier with two short parts, a store to receive into, and the ids the tests need. */
async function fixtures(tx: Tx) {
  const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
  const suffix = testSuffix()
  const supplier = await tx.supplier.create({ data: { name: `Supplier ${suffix}`, leadTimeDays: 5 } })
  const location = await tx.location.create({
    data: { name: `Store ${suffix}`, type: 'WAREHOUSE' },
  })

  const makePart = async (partNumber: string, overrides: Record<string, unknown> = {}) => {
    const part = await createPart(
      storekeeper,
      {
        partNumber,
        description: `Test part ${partNumber}`,
        brand: 'Bridon',
        compatibleModels: '',
        uom: 'pc',
        cost: '40.00',
        sellPrice: '65.00',
        reorderLevel: '10',
        reorderQty: '20',
        trackSerialOrBatch: '',
        ...overrides,
      },
      tx,
    )
    await tx.part.update({
      where: { id: part.id },
      data: { preferredSupplierId: supplier.id },
    })
    return part
  }

  return { storekeeper, supplier, location, makePart, suffix }
}

async function onHand(tx: Tx, partId: string): Promise<number> {
  const levels = await tx.stockLevel.findMany({ where: { partId }, select: { quantity: true } })
  return levels.reduce((sum, level) => sum + Number(level.quantity), 0)
}

describe('the reorder list', () => {
  it("groups a short part under its preferred supplier with the store's order size", async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, supplier, makePart, suffix } = await fixtures(tx)
      const part = await makePart(`RO-${suffix}`)

      const groups = await reorderGroups(storekeeper, tx)
      const group = groups.find((row) => row.supplier?.id === supplier.id)

      expect(group).toBeDefined()
      const line = group?.lines.find((row) => row.partId === part.id)
      expect(line).toMatchObject({ onHand: 0, reorderLevel: 10, suggestedQuantity: 20 })
      expect(group?.estimatedCost).toBeGreaterThanOrEqual(800)
    })
  })

  it('leaves a part that is not short out of the list', async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, makePart, suffix, location } = await fixtures(tx)
      const part = await makePart(`RO-${suffix}`)

      const { postStockEntry } = await import('@/server/inventory/parts')
      await postStockEntry(
        storekeeper,
        part.id,
        { type: 'RECEIVE', quantity: '30', locationId: location.id },
        tx,
      )

      const groups = await reorderGroups(storekeeper, tx)
      expect(groups.flatMap((group) => group.lines.map((line) => line.partId))).not.toContain(
        part.id,
      )
    })
  })
})

describe('raising a purchase order', () => {
  it('numbers it, snapshots the catalogue cost, and audits it', async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, supplier, makePart, suffix } = await fixtures(tx)
      const part = await makePart(`PO-${suffix}`)

      const order = await raisePurchaseOrder(
        storekeeper,
        supplier.id,
        {
          expectedAt: '',
          lines: [
            { partId: part.id, quantity: '5' },
            // A blank quantity is the store saying "not this one".
            { partId: '00000000-0000-0000-0000-000000000000', quantity: '0' },
          ],
        },
        tx,
      )

      expect(order.number).toMatch(/^PO-\d{4}-\d{4}$/)

      const row = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: order.id },
        select: { total: true, status: true, lines: true, supplierId: true },
      })
      expect(row.status).toBe('DRAFT')
      expect(row.supplierId).toBe(supplier.id)
      expect(Number(row.total)).toBe(200)
      expect(row.lines).toHaveLength(1)
      expect(Number(row.lines[0]?.unitCost)).toBe(40)

      const audit = await tx.auditLog.findFirstOrThrow({ where: { entityId: order.id } })
      expect(audit.entity).toBe('PurchaseOrder')
      expect(audit.action).toBe('CREATE')
    })
  })

  it("refuses to order another supplier's part", async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, supplier, makePart, suffix } = await fixtures(tx)
      const otherSupplier = await tx.supplier.create({ data: { name: `Other ${suffix}` } })
      const part = await makePart(`PO-${suffix}`)

      await expect(
        raisePurchaseOrder(
          storekeeper,
          otherSupplier.id,
          { expectedAt: '', lines: [{ partId: part.id, quantity: '2' }] },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)

      expect(await tx.purchaseOrder.count({ where: { supplierId: supplier.id } })).toBe(0)
    })
  })

  it('refuses a dispatcher, who does not buy stock', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      await expect(
        raisePurchaseOrder(
          dispatcher,
          '00000000-0000-0000-0000-000000000000',
          { expectedAt: '', lines: [{ partId: 'p', quantity: '1' }] },
          tx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})

describe('receiving against a purchase order', () => {
  async function raisedOrder(tx: Tx) {
    const base = await fixtures(tx)
    const part = await base.makePart(`RC-${base.suffix}`)
    const order = await raisePurchaseOrder(
      base.storekeeper,
      base.supplier.id,
      { expectedAt: '', lines: [{ partId: part.id, quantity: '5' }] },
      tx,
    )
    const line = await tx.purchaseOrderLine.findFirstOrThrow({
      where: { purchaseOrderId: order.id },
    })
    return { ...base, part, order, line }
  }

  it('posts a stock movement per line, moves the shelf, and derives the status', async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, order, line, part, location } = await raisedOrder(tx)

      await receivePurchaseOrder(
        storekeeper,
        order.id,
        { locationId: location.id, lines: [{ lineId: line.id, received: '2', serialOrBatch: '' }] },
        tx,
      )

      expect(await onHand(tx, part.id)).toBe(2)
      let row = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })
      expect(row.status).toBe('PARTIAL')

      const movement = await tx.stockMovement.findFirstOrThrow({
        where: { partId: part.id, type: 'RECEIVE' },
      })
      expect(movement.purchaseOrderId).toBe(order.id)
      expect(Number(movement.unitCost)).toBe(40)
      expect(movement.toLocationId).toBe(location.id)

      await receivePurchaseOrder(
        storekeeper,
        order.id,
        { locationId: location.id, lines: [{ lineId: line.id, received: '3', serialOrBatch: '' }] },
        tx,
      )

      expect(await onHand(tx, part.id)).toBe(5)
      row = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })
      expect(row.status).toBe('RECEIVED')
    })
  })

  it('keeps the serial when one is named, so a traced part stays traceable', async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, order, line, part, location } = await raisedOrder(tx)

      await receivePurchaseOrder(
        storekeeper,
        order.id,
        {
          locationId: location.id,
          lines: [{ lineId: line.id, received: '5', serialOrBatch: 'BATCH-42' }],
        },
        tx,
      )

      const movement = await tx.stockMovement.findFirstOrThrow({
        where: { partId: part.id, type: 'RECEIVE' },
      })
      expect(movement.serialOrBatch).toBe('BATCH-42')
    })
  })

  it('refuses more than the line still owes, naming the remainder', async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, order, line, part, location } = await raisedOrder(tx)

      await expect(
        receivePurchaseOrder(
          storekeeper,
          order.id,
          { locationId: location.id, lines: [{ lineId: line.id, received: '6', serialOrBatch: '' }] },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)

      expect(await onHand(tx, part.id)).toBe(0)
    })
  })

  it('takes no more deliveries once the order is whole', async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, order, line, location } = await raisedOrder(tx)

      await receivePurchaseOrder(
        storekeeper,
        order.id,
        { locationId: location.id, lines: [{ lineId: line.id, received: '5', serialOrBatch: '' }] },
        tx,
      )

      await expect(
        receivePurchaseOrder(
          storekeeper,
          order.id,
          { locationId: location.id, lines: [{ lineId: line.id, received: '1', serialOrBatch: '' }] },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('lists only the orders still owed, and refuses a role that cannot read them', async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, order, line, location } = await raisedOrder(tx)

      const open = await listOpenPurchaseOrders(storekeeper, tx)
      expect(open.map((row) => row.id)).toContain(order.id)
      expect(open.find((row) => row.id === order.id)?.lines[0]).toMatchObject({
        quantity: 5,
        receivedQuantity: 0,
        remaining: 5,
      })

      await receivePurchaseOrder(
        storekeeper,
        order.id,
        { locationId: location.id, lines: [{ lineId: line.id, received: '5', serialOrBatch: '' }] },
        tx,
      )
      const after = await listOpenPurchaseOrders(storekeeper, tx)
      expect(after.map((row) => row.id)).not.toContain(order.id)

      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      await expect(listOpenPurchaseOrders(finance, tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})
