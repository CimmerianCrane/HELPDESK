import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, RuleError, ValidationError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { createPart, getPart, updatePart } from '@/server/inventory/parts'
import {
  createSupplier,
  listSuppliers,
  supplierOptions,
  updateSupplier,
} from '@/server/inventory/suppliers'
import { inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * The supplier book against the real database, inside a transaction that always rolls back (slice 27).
 *
 * The cases a screen cannot show: that a supplier still named by a part cannot be retired, that a
 * part cannot prefer a retired one, and that the price history is read from the purchase orders
 * themselves rather than a table that could drift from them.
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

function partInput(partNumber: string) {
  return {
    // The catalogue stores part numbers upper-cased, so tests compare against the same form.
    partNumber: partNumber.toUpperCase(),
    description: 'Test hook',
    brand: 'Gunnebo',
    compatibleModels: '',
    uom: 'pc',
    cost: '88.00',
    sellPrice: '165.00',
    reorderLevel: '2',
    reorderQty: '',
    trackSerialOrBatch: '',
  }
}

describe('the supplier book', () => {
  it('adds a supplier, and refuses a second with the same name', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const suffix = testSuffix()
      const name = `Supplier ${suffix}`

      const created = await createSupplier(storekeeper, { name, leadTimeDays: '7', isActive: 'on' }, tx)
      expect(created.name).toBe(name)
      expect(created.leadTimeDays).toBe(7)
      expect(created.isActive).toBe(true)

      await expect(
        createSupplier(storekeeper, { name, isActive: 'on' }, tx),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it('refuses a supplier write to anyone who is not the store', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      await expect(
        createSupplier(dispatcher, { name: `Nope ${testSuffix()}`, isActive: 'on' }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('refuses to retire a supplier that a part still prefers, then allows it once the part moves', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const suffix = testSuffix()
      const first = await createSupplier(storekeeper, { name: `First ${suffix}`, isActive: 'on' }, tx)
      const second = await createSupplier(
        storekeeper,
        { name: `Second ${suffix}`, isActive: 'on' },
        tx,
      )

      const part = await createPart(
        storekeeper,
        { ...partInput(`SP-${suffix}`), preferredSupplierId: first.id },
        tx,
      )
      expect(part.preferredSupplierName).toBe(`First ${suffix}`)

      await expect(
        updateSupplier(storekeeper, first.id, { name: `First ${suffix}`, isActive: false }, tx),
      ).rejects.toBeInstanceOf(ValidationError)

      await updatePart(
        storekeeper,
        part.id,
        { ...partInput(`SP-${suffix}`), preferredSupplierId: second.id },
        tx,
      )

      const retired = await updateSupplier(
        storekeeper,
        first.id,
        { name: `First ${suffix}`, isActive: false },
        tx,
      )
      expect(retired.isActive).toBe(false)
      // Still listed, still named by its past orders; just not offered for new stock.
      expect((await listSuppliers(storekeeper, tx)).some((row) => row.id === first.id)).toBe(true)
      expect((await supplierOptions(storekeeper, tx)).some((row) => row.id === first.id)).toBe(false)
    })
  })

  it('refuses to point a part at a retired supplier', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const suffix = testSuffix()
      const supplier = await createSupplier(
        storekeeper,
        { name: `Gone ${suffix}`, isActive: false },
        tx,
      )

      await expect(
        createPart(
          storekeeper,
          { ...partInput(`RT-${suffix}`), preferredSupplierId: supplier.id },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('reads the price history from the purchase orders raised from it', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const suffix = testSuffix()
      const supplier = await createSupplier(storekeeper, { name: `Hx ${suffix}`, isActive: 'on' }, tx)

      const part = await createPart(storekeeper, partInput(`PX-${suffix}`), tx)
      await tx.part.update({ where: { id: part.id }, data: { preferredSupplierId: supplier.id } })
      await tx.purchaseOrder.create({
        data: {
          number: `PO-${suffix}`,
          supplierId: supplier.id,
          orderedAt: new Date('2026-03-01T00:00:00.000Z'),
          total: '240.00',
          lines: {
            create: { partId: part.id, description: 'Test hook', quantity: '3', unitCost: '80.00' },
          },
        },
      })

      const row = (await listSuppliers(storekeeper, tx)).find((entry) => entry.id === supplier.id)!
      expect(row.parts.map((entry) => entry.partNumber)).toContain(`PX-${suffix}`.toUpperCase())
      expect(row.orders).toHaveLength(1)
      expect(row.orders[0]).toMatchObject({
        number: `PO-${suffix}`,
        status: 'DRAFT',
        total: 240,
      })

      // And the catalogue shows who supplies it, which is what the part screen reads.
      expect((await getPart(storekeeper, part.id, tx)).preferredSupplierName).toBe(`Hx ${suffix}`)
    })
  })
})
