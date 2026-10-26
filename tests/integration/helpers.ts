import { PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'

export const db = new PrismaClient()

export type Tx = Prisma.TransactionClient

const ROLLBACK = new Error('__test_rollback__')

/**
 * Runs `fn` inside a transaction that is always rolled back, so tests never leave rows behind in the
 * real database. Returns whatever `fn` returned.
 *
 * If `fn` throws — which is the point when asserting that a constraint rejects bad data — that error
 * propagates. Only our own rollback sentinel is swallowed.
 */
export async function inRolledBackTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let result!: T
  try {
    await db.$transaction(async (tx) => {
      result = await fn(tx)
      throw ROLLBACK
    })
  } catch (error) {
    if (error !== ROLLBACK) throw error
  }
  return result
}

/** The minimum rows a Job needs, so a test can get to the thing it is actually testing. */
export async function jobFixtures(tx: Tx) {
  const suffix = Math.random().toString(36).slice(2, 10)

  const customer = await tx.customer.create({
    data: { legalName: `Test Customer ${suffix}`, status: 'ACTIVE' },
  })
  const site = await tx.site.create({
    data: { customerId: customer.id, name: `Test Site ${suffix}` },
  })
  const jobType = await tx.jobType.create({
    data: { code: `TEST_${suffix}`, name: 'Test job type' },
  })

  return { customer, site, jobType, suffix }
}

export async function craneFixtures(tx: Tx) {
  const base = await jobFixtures(tx)
  const crane = await tx.crane.create({
    data: {
      siteId: base.site.id,
      customerId: base.customer.id,
      assetTag: `TAG-${base.suffix}`,
      qrValue: `QR-${base.suffix}`,
      type: 'OVERHEAD',
      swlKg: 5000,
    },
  })
  return { ...base, crane }
}
