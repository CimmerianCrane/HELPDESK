import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, RuleError, ValidationError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { createLocation } from '@/server/inventory/locations'
import { createPart, getPart, postStockEntry } from '@/server/inventory/parts'
import {
  approveStockTake,
  cancelStockTake,
  createStockTake,
  getStockTake,
  listStockTakes,
  recordCounts,
} from '@/server/inventory/stock-takes'
import { inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * The stock take against the real database, inside a transaction that always rolls back (slice 26).
 *
 * The cases a screen cannot show: that approving posts exactly one movement per differing line and
 * leaves the matching ones alone, that a second approval cannot post them again, and that a count
 * cannot be approved while a line is still uncounted.
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
    customerId: null,
    ip: '203.0.113.9',
    userAgent: 'vitest',
    ...overrides,
  }
}

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${role.toLowerCase()}-st-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

function partInput() {
  return {
    partNumber: `ST-${testSuffix()}`.toUpperCase(),
    description: 'Test brake pad',
    brand: 'ZPMC',
    compatibleModels: '',
    uom: 'pc',
    cost: '12.00',
    sellPrice: '24.00',
    reorderLevel: '2',
    reorderQty: '5',
    trackSerialOrBatch: '',
  }
}

async function onHandAt(tx: Tx, partId: string, locationId: string): Promise<number> {
  const level = await tx.stockLevel.findUnique({
    where: { partId_locationId: { partId, locationId } },
    select: { quantity: true },
  })
  return level ? Number(level.quantity) : 0
}

/** A store with one part received into it: the smallest shelf a count is worth opening on. */
async function shelf(tx: Tx, quantity: string) {
  const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
  const part = await createPart(storekeeper, partInput(), tx)
  const store = await createLocation(
    storekeeper,
    { name: `Count Store ${testSuffix()}`, type: 'WAREHOUSE', isActive: 'on' },
    tx,
  )
  await postStockEntry(storekeeper, part.id, { type: 'RECEIVE', quantity, locationId: store.id }, tx)
  return { storekeeper, part, store }
}

describe('stock takes', () => {
  it('snapshots the shelf, records a count and derives the variance', async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, part, store } = await shelf(tx, '10')

      const created = await createStockTake(
        storekeeper,
        { scopeLocationId: store.id, blindCount: 'on' },
        tx,
      )
      expect(created.reference).toMatch(/^ST-\d{4}-\d{4}$/)

      const opened = await getStockTake(storekeeper, created.id, tx)
      expect(opened.status).toBe('DRAFT')
      expect(opened.lines).toHaveLength(1)
      expect(opened.lines[0]?.partId).toBe(part.id)
      expect(opened.lines[0]?.systemQty).toBe(10)

      await recordCounts(
        storekeeper,
        created.id,
        { lines: [{ lineId: opened.lines[0]!.id, counted: '7' }] },
        tx,
      )

      const counted = await getStockTake(storekeeper, created.id, tx)
      expect(counted.status).toBe('REVIEW')
      expect(counted.lines[0]?.countedQty).toBe(7)
      expect(counted.lines[0]?.variance).toBe(-3)
    })
  })

  it('posts one correction per differing line on approval, and leaves the matches alone', async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, part, store } = await shelf(tx, '5')

      const created = await createStockTake(storekeeper, { scopeLocationId: store.id }, tx)
      const opened = await getStockTake(storekeeper, created.id, tx)
      await recordCounts(
        storekeeper,
        created.id,
        { lines: [{ lineId: opened.lines[0]!.id, counted: '2' }] },
        tx,
      )

      // A downward difference needs a reason said out loud before it is written off.
      await expect(approveStockTake(storekeeper, created.id, {}, tx)).rejects.toBeInstanceOf(
        ValidationError,
      )

      const result = await approveStockTake(storekeeper, created.id, { reasonCode: 'Miscount' }, tx)
      expect(result.posted).toBe(1)

      expect(await onHandAt(tx, part.id, store.id)).toBe(2)

      const movements = await tx.stockMovement.findMany({
        where: { partId: part.id, stockTakeId: created.id },
        select: { type: true, quantity: true, reasonCode: true },
      })
      expect(movements).toHaveLength(1)
      expect(movements[0]).toMatchObject({ type: 'WRITEOFF', reasonCode: 'Miscount' })
      expect(Number(movements[0]?.quantity)).toBe(3)

      const approved = await getStockTake(storekeeper, created.id, tx)
      expect(approved.status).toBe('APPROVED')
      expect(approved.approvedAt).not.toBeNull()
    })
  })

  it('posts an upward difference as an ADJUST with no reason needed', async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, part, store } = await shelf(tx, '1')

      const created = await createStockTake(storekeeper, { scopeLocationId: store.id }, tx)
      const opened = await getStockTake(storekeeper, created.id, tx)
      await recordCounts(
        storekeeper,
        created.id,
        { lines: [{ lineId: opened.lines[0]!.id, counted: '4' }] },
        tx,
      )

      const result = await approveStockTake(storekeeper, created.id, {}, tx)
      expect(result.posted).toBe(1)
      expect(await onHandAt(tx, part.id, store.id)).toBe(4)

      const movement = await tx.stockMovement.findFirst({
        where: { partId: part.id, stockTakeId: created.id },
        select: { type: true, quantity: true },
      })
      expect(movement).toMatchObject({ type: 'ADJUST' })
      expect(Number(movement?.quantity)).toBe(3)
    })
  })

  /** The correction is posted once. A second approval would double it, so it is refused outright. */
  it('refuses a second approval and refuses to approve a half-counted session', async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, part, store } = await shelf(tx, '4')

      const created = await createStockTake(storekeeper, { scopeLocationId: store.id }, tx)

      // Approving with the single line uncounted is refused: nobody has looked at it yet.
      await expect(approveStockTake(storekeeper, created.id, { reasonCode: 'x' }, tx)).rejects.toBeInstanceOf(
        RuleError,
      )

      const opened = await getStockTake(storekeeper, created.id, tx)
      await recordCounts(
        storekeeper,
        created.id,
        { lines: [{ lineId: opened.lines[0]!.id, counted: '3' }] },
        tx,
      )
      await approveStockTake(storekeeper, created.id, { reasonCode: 'Miscount' }, tx)

      await expect(
        approveStockTake(storekeeper, created.id, { reasonCode: 'Miscount' }, tx),
      ).rejects.toBeInstanceOf(RuleError)

      // The shelf is where the first approval left it.
      expect(await onHandAt(tx, part.id, store.id)).toBe(3)
      const detail = await getPart(storekeeper, part.id, tx)
      expect(detail.movements.filter((movement) => movement.type === 'WRITEOFF')).toHaveLength(1)
    })
  })

  it('refuses a second open session over the same location, and lets a cancelled one be replaced', async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, store } = await shelf(tx, '2')

      const first = await createStockTake(storekeeper, { scopeLocationId: store.id }, tx)
      await expect(
        createStockTake(storekeeper, { scopeLocationId: store.id }, tx),
      ).rejects.toBeInstanceOf(RuleError)

      await cancelStockTake(storekeeper, first.id, tx)
      const second = await createStockTake(storekeeper, { scopeLocationId: store.id }, tx)
      expect(second.id).not.toBe(first.id)

      const listed = await listStockTakes(storekeeper, tx)
      const cancelled = listed.find((take) => take.id === first.id)
      expect(cancelled?.status).toBe('CANCELLED')
    })
  })

  it('posts nothing when cancelled, and refuses to approve one that was', async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, part, store } = await shelf(tx, '6')

      const created = await createStockTake(storekeeper, { scopeLocationId: store.id }, tx)
      const opened = await getStockTake(storekeeper, created.id, tx)
      await recordCounts(
        storekeeper,
        created.id,
        { lines: [{ lineId: opened.lines[0]!.id, counted: '1' }] },
        tx,
      )
      await cancelStockTake(storekeeper, created.id, tx)

      await expect(
        approveStockTake(storekeeper, created.id, { reasonCode: 'Miscount' }, tx),
      ).rejects.toBeInstanceOf(RuleError)

      expect(await onHandAt(tx, part.id, store.id)).toBe(6)
      const posts = await tx.stockMovement.count({ where: { partId: part.id, stockTakeId: created.id } })
      expect(posts).toBe(0)
    })
  })

  /**
   * Counting is `stock.move` — a technician counts a van. Approving writes stock off, which is
   * `stocktake.approve`: the storekeeper and Admin. Finance reads the book and does neither.
   */
  it('lets a technician count but not approve, and refuses finance either', async () => {
    await inRolledBackTx(async (tx) => {
      const { store } = await shelf(tx, '3')
      const technician = contextFor(await makeUser(tx, 'TECHNICIAN'))
      const finance = contextFor(await makeUser(tx, 'FINANCE'))

      await expect(
        createStockTake(finance, { scopeLocationId: store.id }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)

      const created = await createStockTake(technician, { scopeLocationId: store.id }, tx)
      const opened = await getStockTake(technician, created.id, tx)
      await recordCounts(
        technician,
        created.id,
        { lines: [{ lineId: opened.lines[0]!.id, counted: '3' }] },
        tx,
      )
      expect((await getStockTake(technician, created.id, tx)).status).toBe('REVIEW')

      await expect(
        approveStockTake(technician, created.id, { reasonCode: 'x' }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  /** Nothing to count is a real session: approving it posts nothing and closes it. */
  it('opens an empty session over an empty location and approves it without posting', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const empty = await createLocation(
        storekeeper,
        { name: `Empty ${testSuffix()}`, type: 'VAN', isActive: 'on' },
        tx,
      )

      const created = await createStockTake(storekeeper, { scopeLocationId: empty.id }, tx)
      const opened = await getStockTake(storekeeper, created.id, tx)
      expect(opened.lines).toHaveLength(0)
      expect(opened.status).toBe('REVIEW')

      const result = await approveStockTake(storekeeper, created.id, {}, tx)
      expect(result.posted).toBe(0)
      expect((await getStockTake(storekeeper, created.id, tx)).status).toBe('APPROVED')
    })
  })
})
