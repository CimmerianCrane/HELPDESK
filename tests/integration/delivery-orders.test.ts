import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, NotFoundError, RuleError, ValidationError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  createDeliveryOrder,
  deliveryOrdersForJob,
  issuedPartsForJob,
  receiveDeliveryOrder,
  returnDeliveryOrder,
} from '@/server/delivery-orders/delivery-orders'
import { craneFixtures, inRolledBackTx, technicianFixture, testSuffix, type Tx } from './helpers'

/**
 * Delivery orders against the real database, inside a transaction that always rolls back (slice 18).
 *
 * The rules worth proving are the ones that stop stock and paperwork drifting: a DO can only name
 * parts that were actually issued on the job, the same movement cannot go onto two DOs, and the
 * status follows the received quantities rather than a form field.
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

/**
 * A job to deliver on, an assigned technician, and the parts to issue. `StockMovement` rows are the
 * only source of deliverable parts, so the fixture writes them the way the report sync does.
 */
async function deliveryFixtures(tx: Tx, options: { secondJob?: boolean } = {}) {
  const base = await craneFixtures(tx)
  const { user: techUser, technician } = await technicianFixture(tx, base.suffix)

  const job = await tx.job.create({
    data: {
      number: `JOB-${base.suffix}`,
      jobTypeId: base.jobType.id,
      customerId: base.customer.id,
      siteId: base.site.id,
      status: 'IN_PROGRESS',
      priority: 'P3',
    },
  })
  await tx.jobTechnician.create({ data: { jobId: job.id, technicianId: technician.id, isLead: true } })

  const otherJob = options.secondJob
    ? await tx.job.create({
        data: {
          number: `JOB-OTHER-${base.suffix}`,
          jobTypeId: base.jobType.id,
          customerId: base.customer.id,
          siteId: base.site.id,
          status: 'NEW',
          priority: 'P3',
        },
      })
    : null

  const makePart = (partNumber: string) =>
    tx.part.create({
      data: {
        partNumber,
        description: `${partNumber} description`,
        uom: 'EA',
        cost: 10,
        sellPrice: 20,
      },
    })

  const rope = await makePart(`ROPE-${base.suffix}`)
  const hook = await makePart(`HOOK-${base.suffix}`)

  const issue = (partId: string, quantity: number, serialOrBatch: string | null = null) =>
    tx.stockMovement.create({
      data: { partId, jobId: job.id, type: 'ISSUE', quantity, serialOrBatch },
    })

  const ropeMovement = await issue(rope.id, 2, `LOT-${base.suffix}`)
  const hookMovement = await issue(hook.id, 1)

  return {
    ...base,
    techUser,
    technician,
    job,
    otherJob,
    rope,
    hook,
    ropeMovement,
    hookMovement,
  }
}

describe('raising a delivery order', () => {
  it('numbers it, snapshots the issued parts, and claims the movements', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const f = await deliveryFixtures(tx)

      const order = await createDeliveryOrder(
        contextFor(storekeeper),
        {
          jobId: f.job.id,
          lines: [
            { movementId: f.ropeMovement.id, chargeType: 'LOAN', expectedReturnDate: '2026-12-01' },
            { movementId: f.hookMovement.id, chargeType: 'CHARGEABLE' },
          ],
        },
        tx,
      )

      expect(order.number).toMatch(/^DO-\d{4}-\d{4,}$/)
      expect(order.status).toBe('ISSUED')
      expect(order.job?.id).toBe(f.job.id)
      expect(order.lines).toHaveLength(2)
      // Snapshot, not a live join: the description survives a part rename.
      expect(order.lines[0]!.description).toContain(f.rope.partNumber)
      expect(order.lines[0]!.serialOrBatch).toBe(`LOT-${f.suffix}`)
      // A loan with nothing back yet is outstanding; the chargeable line is not.
      expect(order.lines[0]!.outstanding).toBe(true)
      expect(order.lines[1]!.outstanding).toBe(false)

      // The ledger now names the document, so the same part cannot go onto a second DO.
      const claimed = await tx.stockMovement.findMany({
        where: { deliveryOrderId: order.id },
        select: { id: true },
      })
      expect(claimed.map((row) => row.id).sort()).toEqual(
        [f.ropeMovement.id, f.hookMovement.id].sort(),
      )

      const audit = await tx.auditLog.findFirst({
        where: { entity: 'DeliveryOrder', entityId: order.id, action: 'CREATE' },
      })
      expect(audit).not.toBeNull()
    })
  })

  it('offers only the issued parts that no delivery order has claimed', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const f = await deliveryFixtures(tx)
      const context = contextFor(storekeeper)

      expect((await issuedPartsForJob(context, f.job.id, tx)).map((p) => p.movementId)).toEqual([
        f.ropeMovement.id,
        f.hookMovement.id,
      ])

      await createDeliveryOrder(context, { jobId: f.job.id, lines: [{ movementId: f.ropeMovement.id }] }, tx)

      expect((await issuedPartsForJob(context, f.job.id, tx)).map((p) => p.movementId)).toEqual([
        f.hookMovement.id,
      ])
    })
  })

  it('refuses a part that was not issued on the job', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const f = await deliveryFixtures(tx, { secondJob: true })

      const foreign = await tx.stockMovement.create({
        data: { partId: f.hook.id, jobId: f.otherJob!.id, type: 'ISSUE', quantity: 1 },
      })

      await expect(
        createDeliveryOrder(
          contextFor(storekeeper),
          { jobId: f.job.id, lines: [{ movementId: foreign.id }] },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('refuses a movement that never left the store', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const f = await deliveryFixtures(tx)

      const receipt = await tx.stockMovement.create({
        data: { partId: f.hook.id, jobId: f.job.id, type: 'RECEIVE', quantity: 5 },
      })

      await expect(
        createDeliveryOrder(
          contextFor(storekeeper),
          { jobId: f.job.id, lines: [{ movementId: receipt.id }] },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('refuses to put the same part on a second delivery order', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const f = await deliveryFixtures(tx)
      const context = contextFor(storekeeper)

      await createDeliveryOrder(context, { jobId: f.job.id, lines: [{ movementId: f.ropeMovement.id }] }, tx)

      await expect(
        createDeliveryOrder(context, { jobId: f.job.id, lines: [{ movementId: f.ropeMovement.id }] }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('refuses a technician, who raises no paperwork for parts they issue', async () => {
    await inRolledBackTx(async (tx) => {
      const f = await deliveryFixtures(tx)
      const context = contextFor(f.techUser, { technicianId: f.technician.id })

      // They can read the parts they issued, but not raise a DO from them.
      expect(await issuedPartsForJob(context, f.job.id, tx)).toHaveLength(2)
      await expect(
        createDeliveryOrder(context, { jobId: f.job.id, lines: [{ movementId: f.ropeMovement.id }] }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('does not show a technician a delivery order on somebody else\'s job', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const f = await deliveryFixtures(tx)
      await createDeliveryOrder(contextFor(storekeeper), { jobId: f.job.id, lines: [{ movementId: f.ropeMovement.id }] }, tx)

      const otherTech = await technicianFixture(tx, testSuffix())
      const context = contextFor(otherTech.user, { technicianId: otherTech.technician.id })

      expect(await deliveryOrdersForJob(context, f.job.id, tx)).toEqual([])
      // NotFound, not Forbidden: a 403 would confirm the job exists.
      await expect(issuedPartsForJob(context, f.job.id, tx)).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})

describe('receiving a delivery order', () => {
  /** A signature file belonging to the DO, made the way the upload route makes one. */
  async function signatureFor(tx: Tx, deliveryOrderId: string) {
    return tx.file.create({
      data: {
        storageKey: `delivery-orders/${deliveryOrderId}/signatures/test.png`,
        filename: 'receiver-signature.png',
        mimeType: 'image/png',
        sizeBytes: 1024,
        kind: 'SIGNATURE',
        entity: 'DeliveryOrder',
        entityId: deliveryOrderId,
      },
      select: { id: true },
    })
  }

  it('stays PARTIAL until every line is whole, then becomes DELIVERED', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const f = await deliveryFixtures(tx)
      const context = contextFor(storekeeper)

      const order = await createDeliveryOrder(
        context,
        { jobId: f.job.id, lines: [{ movementId: f.ropeMovement.id }, { movementId: f.hookMovement.id }] },
        tx,
      )
      const signature = await signatureFor(tx, order.id)
      const [ropeLine, hookLine] = order.lines

      const partial = await receiveDeliveryOrder(
        context,
        order.id,
        {
          receiverName: 'Site foreman',
          signatureFileId: signature.id,
          lines: [
            { lineId: ropeLine!.id, received: '2' },
            { lineId: hookLine!.id, received: '0' },
          ],
        },
        tx,
      )

      expect(partial.status).toBe('PARTIAL')
      expect(partial.receiverName).toBe('Site foreman')
      expect(partial.receivedAt).not.toBeNull()

      // A second handover fills in the remainder.
      const complete = await receiveDeliveryOrder(
        context,
        order.id,
        {
          receiverName: 'Site foreman',
          signatureFileId: signature.id,
          lines: [
            { lineId: ropeLine!.id, received: '2' },
            { lineId: hookLine!.id, received: '1' },
          ],
        },
        tx,
      )
      expect(complete.status).toBe('DELIVERED')
    })
  })

  it('refuses more than was ordered, naming the line', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const f = await deliveryFixtures(tx)
      const context = contextFor(storekeeper)

      const order = await createDeliveryOrder(context, { jobId: f.job.id, lines: [{ movementId: f.ropeMovement.id }] }, tx)
      const signature = await signatureFor(tx, order.id)

      await expect(
        receiveDeliveryOrder(
          context,
          order.id,
          {
            receiverName: 'Site foreman',
            signatureFileId: signature.id,
            lines: [{ lineId: order.lines[0]!.id, received: '5' }],
          },
          tx,
        ),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it('refuses a signature that belongs to another delivery order', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const f = await deliveryFixtures(tx)
      const context = contextFor(storekeeper)

      const order = await createDeliveryOrder(context, { jobId: f.job.id, lines: [{ movementId: f.ropeMovement.id }] }, tx)
      const otherOrder = await createDeliveryOrder(context, { jobId: f.job.id, lines: [{ movementId: f.hookMovement.id }] }, tx)
      const foreignSignature = await signatureFor(tx, otherOrder.id)

      await expect(
        receiveDeliveryOrder(
          context,
          order.id,
          {
            receiverName: 'Site foreman',
            signatureFileId: foreignSignature.id,
            lines: [{ lineId: order.lines[0]!.id, received: '2' }],
          },
          tx,
        ),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it('needs the write capability', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const f = await deliveryFixtures(tx)
      const order = await createDeliveryOrder(
        contextFor(dispatcher),
        { jobId: f.job.id, lines: [{ movementId: f.ropeMovement.id }] },
        tx,
      )
      const signature = await signatureFor(tx, order.id)

      const finance = await makeUser(tx, 'FINANCE')
      await expect(
        receiveDeliveryOrder(
          contextFor(finance),
          order.id,
          {
            receiverName: 'Site foreman',
            signatureFileId: signature.id,
            lines: [{ lineId: order.lines[0]!.id, received: '2' }],
          },
          tx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})

describe('returning loan kit', () => {
  it('closes the delivery order once every loan line is back', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const f = await deliveryFixtures(tx)
      const context = contextFor(storekeeper)

      const order = await createDeliveryOrder(
        context,
        { jobId: f.job.id, lines: [{ movementId: f.ropeMovement.id, chargeType: 'LOAN' }] },
        tx,
      )

      const partial = await returnDeliveryOrder(
        context,
        order.id,
        { lines: [{ lineId: order.lines[0]!.id, returned: '1' }] },
        tx,
      )
      expect(partial.status).toBe('ISSUED')
      expect(partial.lines[0]!.outstanding).toBe(true)

      const closed = await returnDeliveryOrder(
        context,
        order.id,
        { lines: [{ lineId: order.lines[0]!.id, returned: '2' }], note: 'Back in the store, good condition' },
        tx,
      )
      expect(closed.status).toBe('RETURNED')
      expect(closed.lines[0]!.outstanding).toBe(false)
    })
  })

  it('refuses to return a chargeable part, which is the customer\'s now', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const f = await deliveryFixtures(tx)
      const context = contextFor(storekeeper)

      const order = await createDeliveryOrder(
        context,
        { jobId: f.job.id, lines: [{ movementId: f.hookMovement.id, chargeType: 'CHARGEABLE' }] },
        tx,
      )

      await expect(
        returnDeliveryOrder(context, order.id, { lines: [{ lineId: order.lines[0]!.id, returned: '1' }] }, tx),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })
})
