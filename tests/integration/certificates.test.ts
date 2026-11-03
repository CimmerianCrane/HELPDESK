import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, ValidationError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  archiveCertificate,
  certificateCounts,
  certificatesForCrane,
  createCertificate,
  listCertificates,
  updateCertificate,
} from '@/server/certificates/certificates'
import {
  craneFixtures,
  inRolledBackTx,
  jobFixture,
  technicianFixture,
  testSuffix,
  type Tx,
} from './helpers'

/**
 * The certificate register against the real database, inside a transaction that always rolls back
 * (slice 13). The cases a screen cannot show: technician scoping, the audit row, soft delete, and the
 * date buckets that the dashboard tile and the `/certificates` list both read.
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

/** `YYYY-MM-DD` for a date so many days from today, so a fixture's bucket stays true as time passes. */
function dayFromToday(days: number): string {
  const now = new Date()
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return new Date(day.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

describe('certificates', () => {
  it('creates a certificate and audit-logs it', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { crane } = await craneFixtures(tx)

      const certificate = await createCertificate(
        dispatcher,
        {
          craneId: crane.id,
          type: 'STATUTORY_TEST_EXAMINATION',
          certificateNumber: 'AE-2026-001',
          issuer: 'Example Authorised Examiner',
          issueDate: dayFromToday(-30),
          expiryDate: dayFromToday(335),
          statedSwlKg: '5000',
        },
        tx,
      )

      expect(certificate.statutory).toBe(true)
      expect(certificate.statedSwlKg).toBe(5000)
      expect(certificate.dueBucket).toBe('later')

      const trail = await tx.auditLog.findMany({
        where: { entity: 'Certificate', entityId: certificate.id },
      })
      expect(trail).toHaveLength(1)
      expect(trail[0]!.action).toBe('CREATE')
      expect(trail[0]!.userId).toBe(dispatcher.userId)
    })
  })

  it('scopes a technician to certificates on cranes they are assigned work at', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { technician } = await technicianFixture(tx)
      const techUser = await tx.user.findUniqueOrThrow({ where: { id: technician.userId } })
      const techContext = contextFor(techUser, { technicianId: technician.id })

      const mine = await craneFixtures(tx)
      const theirs = await craneFixtures(tx)

      const assignedJob = await jobFixture(
        tx,
        { customerId: mine.customer.id, siteId: mine.site.id, jobTypeId: mine.jobType.id },
        { suffix: mine.suffix, assignTo: technician.id },
      )
      await tx.jobCrane.create({ data: { jobId: assignedJob.id, craneId: mine.crane.id } })

      const visible = await createCertificate(
        dispatcher,
        { craneId: mine.crane.id, type: 'LOAD_TEST', expiryDate: dayFromToday(30) },
        tx,
      )
      await createCertificate(
        dispatcher,
        { craneId: theirs.crane.id, type: 'LOAD_TEST', expiryDate: dayFromToday(30) },
        tx,
      )

      const ids = (await listCertificates(techContext, {}, tx)).map((row) => row.id)
      expect(ids).toContain(visible.id)
      expect(ids).toHaveLength(1)

      // The crane page's own read agrees — one service, so it must.
      expect((await certificatesForCrane(techContext, mine.crane.id, tx)).map((r) => r.id)).toEqual([
        visible.id,
      ])
    })
  })

  it('soft-deletes an archived certificate and keeps the row', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { crane } = await craneFixtures(tx)

      const certificate = await createCertificate(
        dispatcher,
        { craneId: crane.id, type: 'REGISTRATION', expiryDate: dayFromToday(60) },
        tx,
      )
      await archiveCertificate(dispatcher, certificate.id, tx)

      expect(await listCertificates(dispatcher, {}, tx)).toHaveLength(0)

      const row = await tx.certificate.findUniqueOrThrow({ where: { id: certificate.id } })
      expect(row.deletedAt).not.toBeNull()

      const trail = await tx.auditLog.findMany({
        where: { entity: 'Certificate', entityId: certificate.id },
        orderBy: { createdAt: 'asc' },
      })
      expect(trail.map((entry) => entry.action)).toEqual(['CREATE', 'DELETE'])
    })
  })

  it('updates a certificate and records only the changed fields', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { crane } = await craneFixtures(tx)

      const certificate = await createCertificate(
        dispatcher,
        { craneId: crane.id, type: 'CALIBRATION', issuer: 'Old lab', expiryDate: dayFromToday(90) },
        tx,
      )
      await updateCertificate(
        dispatcher,
        certificate.id,
        { type: 'CALIBRATION', issuer: 'New lab', expiryDate: dayFromToday(30) },
        tx,
      )

      const update = await tx.auditLog.findFirstOrThrow({
        where: { entity: 'Certificate', entityId: certificate.id, action: 'UPDATE' },
      })
      const before = update.before as Record<string, unknown>
      const after = update.after as Record<string, unknown>
      expect(before.issuer).toBe('Old lab')
      expect(after.issuer).toBe('New lab')
      // Unchanged fields are dropped from the diff: the log says what moved, not what did not.
      expect(before.type).toBeUndefined()
    })
  })

  it('counts overdue and the 30/90-day windows from the certificate dates', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { technician } = await technicianFixture(tx)
      const techUser = await tx.user.findUniqueOrThrow({ where: { id: technician.userId } })
      const techContext = contextFor(techUser, { technicianId: technician.id })

      const fixtures = await craneFixtures(tx)
      const job = await jobFixture(
        tx,
        {
          customerId: fixtures.customer.id,
          siteId: fixtures.site.id,
          jobTypeId: fixtures.jobType.id,
        },
        { suffix: fixtures.suffix, assignTo: technician.id },
      )
      await tx.jobCrane.create({ data: { jobId: job.id, craneId: fixtures.crane.id } })

      const add = (expiryDate: string | null, nextDueDate: string | null = null) =>
        createCertificate(
          dispatcher,
          {
            craneId: fixtures.crane.id,
            type: 'LOAD_TEST',
            expiryDate: expiryDate ?? '',
            nextDueDate: nextDueDate ?? '',
          },
          tx,
        )

      await add(dayFromToday(-5))
      await add(dayFromToday(10))
      await add(dayFromToday(45))
      await add(null)

      // A technician's scope is exactly this crane's four rows, so the counts prove the bucketing
      // rather than counting whatever else happens to be in the database.
      expect(await certificateCounts(techContext, tx)).toEqual({
        overdue: 1,
        dueWithin30Days: 1,
        dueWithin90: 2,
      })
    })
  })

  it('refuses a write from a role without certificate.write', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const { crane } = await craneFixtures(tx)

      await expect(
        createCertificate(finance, { craneId: crane.id, type: 'LOAD_TEST' }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('rejects a linked job that does not cover the crane', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const fixtures = await craneFixtures(tx)
      const other = await jobFixture(tx, {
        customerId: fixtures.customer.id,
        siteId: fixtures.site.id,
        jobTypeId: fixtures.jobType.id,
      })

      await expect(
        createCertificate(
          dispatcher,
          { craneId: fixtures.crane.id, type: 'LOAD_TEST', jobNumber: other.number },
          tx,
        ),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })
})
