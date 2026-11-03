import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, RuleError, ValidationError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  createLocation,
  listLocations,
  locationOptions,
  updateLocation,
} from '@/server/inventory/locations'
import { createPart, getPart, postStockEntry, transferStock } from '@/server/inventory/parts'
import { inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * Locations and transfers against the real database, inside a transaction that always rolls back
 * (slice 23).
 *
 * The cases a screen cannot show: a retired location that still holds stock being refused, and — the
 * reason the slice exists — that a transfer moves **both** levels and changes the total by nothing.
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

function partInput() {
  return {
    partNumber: `T-${testSuffix()}`.toUpperCase(),
    description: 'Test hook',
    brand: 'Gunnebo',
    compatibleModels: '',
    uom: 'pc',
    cost: '88.00',
    sellPrice: '165.00',
    reorderLevel: '2',
    reorderQty: '4',
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

describe('stock locations', () => {
  it('adds a location and audit-logs it', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const name = `Bay ${testSuffix()}`
      const location = await createLocation(storekeeper, { name, type: 'BIN', isActive: 'on' }, tx)

      expect(location.name).toBe(name)
      expect(location.isActive).toBe(true)

      const audits = await tx.auditLog.findMany({ where: { entityId: location.id } })
      expect(audits).toHaveLength(1)
      expect(audits[0]?.entity).toBe('Location')
      expect(audits[0]?.action).toBe('CREATE')
    })
  })

  it('refuses a second location with the same name', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const name = `Duplicate ${testSuffix()}`
      await createLocation(storekeeper, { name, type: 'VAN', isActive: 'on' }, tx)

      await expect(
        createLocation(storekeeper, { name, type: 'VAN', isActive: 'on' }, tx),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it('lets a bin sit inside a warehouse and refuses anything else inside', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const suffix = testSuffix()
      const warehouse = await createLocation(
        storekeeper,
        { name: `Store ${suffix}`, type: 'WAREHOUSE', isActive: 'on' },
        tx,
      )
      const van = await createLocation(
        storekeeper,
        { name: `Van ${suffix}`, type: 'VAN', isActive: 'on' },
        tx,
      )

      const bin = await createLocation(
        storekeeper,
        { name: `Bin ${suffix}`, type: 'BIN', parentId: warehouse.id, isActive: 'on' },
        tx,
      )
      expect(bin.parentId).toBe(warehouse.id)

      // A van is not a container for a bin.
      await expect(
        createLocation(
          storekeeper,
          { name: `Bin2 ${suffix}`, type: 'BIN', parentId: van.id, isActive: 'on' },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)

      // A warehouse cannot be inside anything.
      await expect(
        createLocation(
          storekeeper,
          { name: `Store2 ${suffix}`, type: 'WAREHOUSE', parentId: warehouse.id, isActive: 'on' },
          tx,
        ),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  /** Retiring a location that still holds stock would strand the quantity where no form reaches it. */
  it('refuses to retire a location that still holds stock, and allows it once empty', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)
      const suffix = testSuffix()
      const store = await createLocation(
        storekeeper,
        { name: `Store ${suffix}`, type: 'WAREHOUSE', isActive: 'on' },
        tx,
      )
      const van = await createLocation(
        storekeeper,
        { name: `Van ${suffix}`, type: 'VAN', isActive: 'on' },
        tx,
      )

      await postStockEntry(storekeeper, part.id, { type: 'RECEIVE', quantity: '5', locationId: store.id }, tx)

      await expect(
        updateLocation(storekeeper, store.id, { name: store.name, type: 'WAREHOUSE', isActive: undefined }, tx),
      ).rejects.toBeInstanceOf(ValidationError)

      await transferStock(
        storekeeper,
        part.id,
        { fromLocationId: store.id, toLocationId: van.id, quantity: '5' },
        tx,
      )

      const retired = await updateLocation(
        storekeeper,
        store.id,
        { name: store.name, type: 'WAREHOUSE', isActive: undefined },
        tx,
      )
      expect(retired.isActive).toBe(false)

      // A retired location is no longer offered to a form.
      const offered = await locationOptions(storekeeper, tx)
      expect(offered.map((row) => row.id)).not.toContain(store.id)
    })
  })

  it('says what each location holds, and refuses a technician the right to add one', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)
      const location = await createLocation(
        storekeeper,
        { name: `Store ${testSuffix()}`, type: 'WAREHOUSE', isActive: 'on' },
        tx,
      )
      await postStockEntry(storekeeper, part.id, { type: 'RECEIVE', quantity: '7', locationId: location.id }, tx)

      const listed = await listLocations(storekeeper, tx)
      const row = listed.find((entry) => entry.id === location.id)
      expect(row).toMatchObject({ partCount: 1, quantity: 7 })

      const technician = contextFor(await makeUser(tx, 'TECHNICIAN'))
      await expect(
        createLocation(technician, { name: `Nope ${testSuffix()}`, type: 'VAN', isActive: 'on' }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})

describe('transfers', () => {
  it('moves stock from one location to another and leaves the total alone', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)
      const suffix = testSuffix()
      const store = await createLocation(
        storekeeper,
        { name: `Store ${suffix}`, type: 'WAREHOUSE', isActive: 'on' },
        tx,
      )
      const van = await createLocation(
        storekeeper,
        { name: `Van ${suffix}`, type: 'VAN', isActive: 'on' },
        tx,
      )

      await postStockEntry(storekeeper, part.id, { type: 'RECEIVE', quantity: '10', locationId: store.id }, tx)
      await transferStock(
        storekeeper,
        part.id,
        { fromLocationId: store.id, toLocationId: van.id, quantity: '4', reasonCode: 'Van load' },
        tx,
      )

      expect(await onHandAt(tx, part.id, store.id)).toBe(6)
      expect(await onHandAt(tx, part.id, van.id)).toBe(4)

      const detail = await getPart(storekeeper, part.id, tx)
      expect(detail.onHand).toBe(10)
      expect(detail.movements[0]?.type).toBe('TRANSFER')
      expect(detail.movements[0]?.fromLocation).toBe(store.name)
      expect(detail.movements[0]?.toLocation).toBe(van.name)
    })
  })

  /** Unlike an issue (a signed field document), a transfer is a store action and is refused. */
  it('refuses a transfer larger than the source holds, naming what it holds', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)
      const suffix = testSuffix()
      const store = await createLocation(
        storekeeper,
        { name: `Store ${suffix}`, type: 'WAREHOUSE', isActive: 'on' },
        tx,
      )
      const van = await createLocation(
        storekeeper,
        { name: `Van ${suffix}`, type: 'VAN', isActive: 'on' },
        tx,
      )

      await postStockEntry(storekeeper, part.id, { type: 'RECEIVE', quantity: '3', locationId: store.id }, tx)

      await expect(
        transferStock(
          storekeeper,
          part.id,
          { fromLocationId: store.id, toLocationId: van.id, quantity: '4' },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)

      // Nothing moved, in the ledger or on the shelf.
      expect(await onHandAt(tx, part.id, store.id)).toBe(3)
      expect(await onHandAt(tx, part.id, van.id)).toBe(0)
      const transfers = await tx.stockMovement.count({ where: { partId: part.id, type: 'TRANSFER' } })
      expect(transfers).toBe(0)
    })
  })

  /**
   * Gated on `stock.move`, the same capability every other stock write uses — a technician holds it
   * because issuing and returning parts is part of the job, and a van-to-bin move is the same kind of
   * act. Finance reads the book and moves nothing.
   */
  it('refuses a role that may read the book but not move stock', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)
      const finance = contextFor(await makeUser(tx, 'FINANCE'))

      await expect(
        transferStock(
          finance,
          part.id,
          { fromLocationId: '00000000-0000-0000-0000-000000000001', toLocationId: '00000000-0000-0000-0000-000000000002', quantity: '1' },
          tx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})
