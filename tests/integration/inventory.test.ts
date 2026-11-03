import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, ValidationError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  createPart,
  getPart,
  listParts,
  postStockEntry,
  updatePart,
} from '@/server/inventory/parts'
import { inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * The parts book and the stock ledger against the real database, inside a transaction that always
 * rolls back (slice 22).
 *
 * The cases a screen cannot show: the permission split between reading and writing the catalogue, the
 * audit rows, and — the reason this slice exists — that a movement moves the **level** with it, in
 * both directions, and that a count corrects rather than adds.
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

function partInput(overrides: Record<string, unknown> = {}) {
  return {
    partNumber: `T-${testSuffix()}`.toUpperCase(),
    description: 'Test wire rope',
    brand: 'Bridon',
    compatibleModels: 'Konecranes, Demag',
    uom: 'm',
    cost: '5.40',
    sellPrice: '9.80',
    reorderLevel: '10',
    reorderQty: '20',
    trackSerialOrBatch: 'on',
    ...overrides,
  }
}

/** A location to receive into, so a test does not depend on whatever the seed left behind. */
async function store(tx: Tx): Promise<string> {
  const suffix = testSuffix()
  const location = await tx.location.create({
    data: { name: `Store ${suffix}`, type: 'WAREHOUSE' },
  })
  return location.id
}

async function onHand(tx: Tx, partId: string): Promise<number> {
  const levels = await tx.stockLevel.findMany({ where: { partId }, select: { quantity: true } })
  return levels.reduce((sum, level) => sum + Number(level.quantity), 0)
}

describe('the parts catalogue', () => {
  it('adds a part and audit-logs it', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)

      expect(part.onHand).toBe(0)
      expect(part.belowReorder).toBe(true)
      expect(part.compatibleModels).toEqual(['Konecranes', 'Demag'])

      const audits = await tx.auditLog.findMany({ where: { entityId: part.id } })
      expect(audits).toHaveLength(1)
      expect(audits[0]?.entity).toBe('Part')
      expect(audits[0]?.action).toBe('CREATE')
    })
  })

  it('refuses a second part with the same number, naming the field', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const input = partInput()
      await createPart(storekeeper, input, tx)

      await expect(createPart(storekeeper, input, tx)).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it('refuses a technician the right to add a part', async () => {
    await inRolledBackTx(async (tx) => {
      const technician = contextFor(await makeUser(tx, 'TECHNICIAN'))
      await expect(createPart(technician, partInput(), tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('lets a technician read the catalogue but not write it', async () => {
    await inRolledBackTx(async (tx) => {
      const technician = contextFor(await makeUser(tx, 'TECHNICIAN'))
      const list = await listParts(technician, { q: 'WR-13' }, tx)
      expect(Array.isArray(list.parts)).toBe(true)
      await expect(
        updatePart(technician, '00000000-0000-0000-0000-000000000000', partInput(), tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('finds a part by the crane model it fits, and filters the book down to what is short', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput({ compatibleModels: 'Tadano' }), tx)

      const byModel = await listParts(storekeeper, { q: 'Tadano' }, tx)
      expect(byModel.parts.map((row) => row.id)).toContain(part.id)

      const below = await listParts(storekeeper, { level: 'below' }, tx)
      expect(below.parts.map((row) => row.id)).toContain(part.id)
      expect(below.belowCount).toBeGreaterThan(0)
    })
  })

  it('edits a part and records only what changed', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)

      await updatePart(storekeeper, part.id, partInput({ sellPrice: '11.50' }), tx)

      const update = await tx.auditLog.findFirstOrThrow({
        where: { entityId: part.id, action: 'UPDATE' },
      })
      expect(update.after).toMatchObject({ sellPrice: 11.5 })
      expect(update.before).not.toHaveProperty('cost')
    })
  })
})

describe('the stock ledger', () => {
  it('receives stock and moves the level with it', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)
      const locationId = await store(tx)

      await postStockEntry(
        storekeeper,
        part.id,
        { type: 'RECEIVE', quantity: '25', locationId, reasonCode: 'Supplier delivery' },
        tx,
      )

      expect(await onHand(tx, part.id)).toBe(25)
      const detail = await getPart(storekeeper, part.id, tx)
      expect(detail.levels).toEqual([
        expect.objectContaining({ locationId, quantity: 25 }),
      ])
      expect(detail.movements[0]?.type).toBe('RECEIVE')
      expect(detail.movements[0]?.toLocation).toBe(detail.levels[0]?.locationName)
      expect(detail.belowReorder).toBe(false)
    })
  })

  /**
   * The bug this slice exists to fix: issuing on a report used to write the movement and leave the
   * level alone. It now goes through the same writer, so the shelf goes down.
   */
  it('takes stock out when a part is issued, by writing the level', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)
      const locationId = await store(tx)

      await postStockEntry(storekeeper, part.id, { type: 'RECEIVE', quantity: '25', locationId }, tx)

      // An issue is not a stock-screen action, so it is written directly through the one writer the
      // report path uses — same call, same effect.
      const { postMovement } = await import('@/server/inventory/stock')
      const { withAudit } = await import('@/server/audit/audit')
      await withAudit(
        storekeeper,
        async (innerTx, log) => {
          await postMovement(innerTx, log, {
            partId: part.id,
            type: 'ISSUE',
            quantity: 4,
            fromLocationId: locationId,
            movedById: storekeeper.userId,
          })
        },
        tx,
      )

      expect(await onHand(tx, part.id)).toBe(21)
    })
  })

  it('lets a count correct a level up or down, and refuses a count that changes nothing', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)
      const locationId = await store(tx)

      await postStockEntry(storekeeper, part.id, { type: 'RECEIVE', quantity: '10', locationId }, tx)

      await postStockEntry(
        storekeeper,
        part.id,
        { type: 'ADJUST', quantity: '7', locationId, reasonCode: 'Stock count' },
        tx,
      )
      expect(await onHand(tx, part.id)).toBe(7)

      await postStockEntry(
        storekeeper,
        part.id,
        { type: 'ADJUST', quantity: '12', locationId, reasonCode: 'Stock count' },
        tx,
      )
      expect(await onHand(tx, part.id)).toBe(12)

      await expect(
        postStockEntry(storekeeper, part.id, { type: 'ADJUST', quantity: '12', locationId }, tx),
      ).rejects.toBeInstanceOf(ValidationError)

      // Downward corrections are writeoffs in the ledger, not negative adjustments.
      const types = await tx.stockMovement.findMany({
        where: { partId: part.id },
        orderBy: { movedAt: 'asc' },
        select: { type: true },
      })
      expect(types.map((row) => row.type)).toEqual(['RECEIVE', 'WRITEOFF', 'ADJUST'])
    })
  })

  it('refuses a stock movement to a role that may read but not move', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)

      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      await expect(
        postStockEntry(finance, part.id, { type: 'RECEIVE', quantity: '1' }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})
