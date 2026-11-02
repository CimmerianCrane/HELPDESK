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
    await db.$transaction(
      async (tx) => {
        result = await fn(tx)
        throw ROLLBACK
      },
      // Prisma defaults an interactive transaction to a 5-second timeout. A test that hashes a couple
      // of passwords and makes a dozen round trips to a database in another region exceeds that
      // without anything being wrong, so give it room.
      { timeout: 60_000, maxWait: 15_000 },
    )
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

export function testSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** A technician with their login. `passwordHash` is a placeholder — nothing here signs anyone in. */
export async function technicianFixture(tx: Tx, suffix = testSuffix()) {
  const user = await tx.user.create({
    data: {
      email: `tech-${suffix}@example.test`,
      name: `Technician ${suffix}`,
      role: 'TECHNICIAN',
      passwordHash: 'not-a-real-hash',
    },
  })
  const technician = await tx.technician.create({ data: { userId: user.id } })
  return { user, technician }
}

/** A job, optionally assigned to a technician. */
export async function jobFixture(
  tx: Tx,
  base: { customerId: string; siteId: string; jobTypeId: string },
  options: { suffix: string; assignTo?: string } = { suffix: testSuffix() },
) {
  const job = await tx.job.create({
    data: {
      number: `JOB-${options.suffix}`,
      jobTypeId: base.jobTypeId,
      customerId: base.customerId,
      siteId: base.siteId,
      status: 'NEW',
      priority: 'P3',
    },
  })

  if (options.assignTo) {
    await tx.jobTechnician.create({
      data: { jobId: job.id, technicianId: options.assignTo, isLead: true },
    })
  }

  return job
}

/**
 * Rows created by a service call commit for real — `withAudit` opens its own transaction, so they
 * cannot be rolled back by `inRolledBackTx`. Tests that write through a service use a unique email
 * prefix and call this in `afterAll` to leave the database as they found it.
 */
export async function deleteUsersByEmailPrefix(prefix: string): Promise<void> {
  const users = await db.user.findMany({
    where: { email: { startsWith: prefix } },
    select: { id: true },
  })
  if (users.length === 0) return

  const ids = users.map((user) => user.id)
  // Only the rows this test created, and only the audit entries that point at them.
  await db.auditLog.deleteMany({ where: { entity: 'User', entityId: { in: ids } } })
  await db.technician.deleteMany({ where: { userId: { in: ids } } })
  await db.user.deleteMany({ where: { id: { in: ids } } })
}
