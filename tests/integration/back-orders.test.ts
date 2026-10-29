import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ValidationError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { createPart, heldJobsForPart } from '@/server/inventory/parts'
import { backOrdersForPart, raisePurchaseOrder } from '@/server/inventory/purchase-orders'
import { createJob, getJob, transitionJob } from '@/server/jobs/jobs'
import { craneFixtures, inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * Back-orders and the jobs waiting for them, against the real database (slice 28).
 *
 * The link is one column, so what needs proving is that it is only set on a parts hold, that it is
 * cleared when the job comes off hold, and that "when it lands" really is read from the open purchase
 * order rather than stored anywhere.
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
    ip: '203.0.113.11',
    userAgent: 'vitest',
    ...overrides,
  }
}

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${role.toLowerCase()}-bo-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

/** A dispatcher, a storekeeper, a supplier with one part, and a job ready to go on hold. */
async function fixtures(tx: Tx) {
  const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
  const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
  const suffix = testSuffix()

  const supplier = await tx.supplier.create({ data: { name: `Supplier ${suffix}`, leadTimeDays: 5 } })
  const part = await createPart(
    storekeeper,
    {
      partNumber: `BO-${suffix}`,
      description: 'Hoist brake',
      compatibleModels: '',
      uom: 'pc',
      cost: '120.00',
      sellPrice: '180.00',
      trackSerialOrBatch: '',
    },
    tx,
  )
  await tx.part.update({ where: { id: part.id }, data: { preferredSupplierId: supplier.id } })

  const base = await craneFixtures(tx)
  const job = await createJob(
    dispatcher,
    {
      customerId: base.customer.id,
      siteId: base.site.id,
      jobTypeId: base.jobType.id,
      description: 'Brake replacement.',
      priority: 'P3',
    },
    tx,
  )
  await transitionJob(dispatcher, job.id, { status: 'TRIAGED' }, tx)
  await transitionJob(dispatcher, job.id, { status: 'SCHEDULED' }, tx)

  return { dispatcher, storekeeper, supplier, part, job, suffix }
}

describe('a job on hold awaiting a part', () => {
  it('records which part, audits it, and shows it on both sides', async () => {
    await inRolledBackTx(async (tx) => {
      const { dispatcher, storekeeper, part, job } = await fixtures(tx)

      await transitionJob(
        dispatcher,
        job.id,
        { status: 'ON_HOLD', onHoldReason: 'AWAITING_PARTS', onHoldPartId: part.id },
        tx,
      )

      const held = await getJob(dispatcher, job.id, tx)
      expect(held.onHoldPart).toMatchObject({ id: part.id, partNumber: part.partNumber })

      const audit = await tx.auditLog.findFirstOrThrow({
        where: { entity: 'Job', entityId: job.id, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      })
      expect((audit.after as { onHoldPartId?: string }).onHoldPartId).toBe(part.id)

      const waiting = await heldJobsForPart(storekeeper, part.id, tx)
      expect(waiting.map((row) => row.id)).toContain(job.id)
    })
  })

  it('refuses a part that is not in the catalogue', async () => {
    await inRolledBackTx(async (tx) => {
      const { dispatcher, job } = await fixtures(tx)

      await expect(
        transitionJob(
          dispatcher,
          job.id,
          {
            status: 'ON_HOLD',
            onHoldReason: 'AWAITING_PARTS',
            onHoldPartId: '00000000-0000-0000-0000-000000000000',
          },
          tx,
        ),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it('clears the part when the job comes off hold', async () => {
    await inRolledBackTx(async (tx) => {
      const { dispatcher, part, job } = await fixtures(tx)

      await transitionJob(
        dispatcher,
        job.id,
        { status: 'ON_HOLD', onHoldReason: 'AWAITING_PARTS', onHoldPartId: part.id },
        tx,
      )
      const back = await transitionJob(dispatcher, job.id, { status: 'SCHEDULED' }, tx)
      expect(back.onHoldPart).toBeNull()
    })
  })
})

describe('what a part is on back-order against', () => {
  it('is every open order line that still owes some, and nothing already delivered', async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, supplier, part } = await fixtures(tx)

      const open = await raisePurchaseOrder(
        storekeeper,
        supplier.id,
        { expectedAt: '2026-11-10', lines: [{ partId: part.id, quantity: '4' }] },
        tx,
      )
      const cancelled = await raisePurchaseOrder(
        storekeeper,
        supplier.id,
        { expectedAt: '', lines: [{ partId: part.id, quantity: '2' }] },
        tx,
      )
      await tx.purchaseOrder.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } })

      const lines = await backOrdersForPart(storekeeper, part.id, tx)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatchObject({
        purchaseOrderId: open.id,
        status: 'DRAFT',
        remaining: 4,
      })
      expect(lines[0]?.expectedAt?.toISOString().slice(0, 10)).toBe('2026-11-10')
    })
  })

  it('is nothing once the order is fully received', async () => {
    await inRolledBackTx(async (tx) => {
      const { storekeeper, supplier, part } = await fixtures(tx)
      const order = await raisePurchaseOrder(
        storekeeper,
        supplier.id,
        { expectedAt: '', lines: [{ partId: part.id, quantity: '3' }] },
        tx,
      )
      const line = await tx.purchaseOrderLine.findFirstOrThrow({
        where: { purchaseOrderId: order.id },
      })
      await tx.purchaseOrderLine.update({
        where: { id: line.id },
        data: { receivedQuantity: line.quantity },
      })
      await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: 'RECEIVED' } })

      expect(await backOrdersForPart(storekeeper, part.id, tx)).toHaveLength(0)
    })
  })
})
