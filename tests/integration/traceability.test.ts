import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import type { AuthContext } from '@/server/auth/types'
import { createPart, postStockEntry, tracePartSerials, transferStock } from '@/server/inventory/parts'
import { postMovement } from '@/server/inventory/stock'
import { withAudit } from '@/server/audit/audit'
import { craneFixtures, inRolledBackTx, jobFixture, testSuffix, type Tx } from './helpers'

/**
 * Serial and batch traceability against the real database, inside a transaction that always rolls
 * back (slice 24).
 *
 * The point of the slice is the question a recall asks: which crane did this rope go on, and where is
 * the rest of the batch? Both answers come from the movements, never from a column somebody has to
 * keep in step.
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

function partInput() {
  return {
    partNumber: `ROPE-${testSuffix()}`.toUpperCase(),
    description: 'Wire rope 13 mm',
    uom: 'm',
    cost: '5.40',
    sellPrice: '9.80',
    trackSerialOrBatch: 'on',
  }
}

async function store(tx: Tx, name = `Store ${testSuffix()}`): Promise<string> {
  const location = await tx.location.create({ data: { name, type: 'WAREHOUSE' } })
  return location.id
}

async function van(tx: Tx): Promise<string> {
  const location = await tx.location.create({ data: { name: `Van ${testSuffix()}`, type: 'VAN' } })
  return location.id
}

describe('tracing a serial', () => {
  it('says where the batch is and which job took part of it', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)
      const storeId = await store(tx)
      const batch = `LOT-${testSuffix()}`

      await postStockEntry(
        storekeeper,
        part.id,
        { type: 'RECEIVE', quantity: '40', locationId: storeId, serialOrBatch: batch },
        tx,
      )

      // A field issue is written by the report path's own writer, not a stock screen.
      const base = await craneFixtures(tx)
      const job = await jobFixture(tx, {
        customerId: base.customer.id,
        siteId: base.site.id,
        jobTypeId: base.jobType.id,
      })
      await tx.jobCrane.create({ data: { jobId: job.id, craneId: base.crane.id } })
      await withAudit(
        storekeeper,
        async (innerTx, log) => {
          await postMovement(innerTx, log, {
            partId: part.id,
            type: 'ISSUE',
            quantity: 12,
            fromLocationId: storeId,
            serialOrBatch: batch,
            jobId: job.id,
            movedById: storekeeper.userId,
          })
        },
        tx,
      )

      const [trace] = await tracePartSerials(storekeeper, part.id, tx)
      expect(trace?.serial).toBe(batch)
      expect(trace?.held).toBe(28)
      expect(trace?.whereabouts).toEqual([expect.objectContaining({ locationName: expect.any(String) })])
      expect(trace?.whereabouts.reduce((sum, where) => sum + where.quantity, 0)).toBe(28)
      expect(trace?.issuedTo).toEqual([
        expect.objectContaining({
          jobId: job.id,
          jobNumber: job.number,
          craneTags: [base.crane.assetTag],
          quantity: 12,
        }),
      ])
    })
  })

  it('follows a transfer instead of counting the batch twice', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)
      const storeId = await store(tx)
      const vanId = await van(tx)
      const batch = `LOT-${testSuffix()}`

      await postStockEntry(
        storekeeper,
        part.id,
        { type: 'RECEIVE', quantity: '10', locationId: storeId, serialOrBatch: batch },
        tx,
      )
      await transferStock(
        storekeeper,
        part.id,
        {
          fromLocationId: storeId,
          toLocationId: vanId,
          quantity: '10',
          serialOrBatch: batch,
        },
        tx,
      )

      const [trace] = await tracePartSerials(storekeeper, part.id, tx)
      expect(trace?.held).toBe(10)
      expect(trace?.whereabouts).toHaveLength(1)
      expect(trace?.whereabouts[0]?.quantity).toBe(10)
      expect(trace?.issuedTo).toEqual([])
    })
  })

  it('shows nothing left held once the whole batch has been issued', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)
      const storeId = await store(tx)
      const batch = `LOT-${testSuffix()}`

      await postStockEntry(
        storekeeper,
        part.id,
        { type: 'RECEIVE', quantity: '2', locationId: storeId, serialOrBatch: batch },
        tx,
      )
      await withAudit(
        storekeeper,
        async (innerTx, log) => {
          await postMovement(innerTx, log, {
            partId: part.id,
            type: 'ISSUE',
            quantity: 2,
            fromLocationId: storeId,
            serialOrBatch: batch,
            movedById: storekeeper.userId,
          })
        },
        tx,
      )

      const [trace] = await tracePartSerials(storekeeper, part.id, tx)
      expect(trace?.held).toBe(0)
      expect(trace?.whereabouts).toEqual([])
    })
  })

  it('is empty for a part nobody has traced', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)
      const storeId = await store(tx)

      await postStockEntry(
        storekeeper,
        part.id,
        { type: 'RECEIVE', quantity: '3', locationId: storeId },
        tx,
      )

      expect(await tracePartSerials(storekeeper, part.id, tx)).toEqual([])
    })
  })

  it('is readable by every role holding part.read, not just the store', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const part = await createPart(storekeeper, partInput(), tx)

      const technician = contextFor(await makeUser(tx, 'TECHNICIAN'))
      expect(await tracePartSerials(technician, part.id, tx)).toEqual([])

      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      expect(await tracePartSerials(finance, part.id, tx)).toEqual([])
    })
  })
})
