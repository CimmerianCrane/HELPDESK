import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, ValidationError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  calibrationCounts,
  calibrationDueLabel,
  createResource,
  listCalibrations,
  updateResource,
} from '@/server/calibrations/calibrations'
import { inRolledBackTx, jobFixture, jobFixtures, testSuffix, type Tx } from './helpers'

/**
 * The calibration register against the real database, inside a transaction that always rolls back
 * (slice 34). The register is the `Resource` table the scheduler books; these cases cover what a
 * screen cannot show — the audit trail, the file-ownership check, the retirement refusal, and the
 * date windows the register counts.
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

function fields(overrides: Partial<Record<string, string>> = {}) {
  return {
    name: `Load cell ${testSuffix()}`,
    type: 'LOAD_CELL',
    serialNumber: '',
    status: 'AVAILABLE',
    calibrationDueDate: '',
    ...overrides,
  }
}

describe('calibrations', () => {
  it('creates equipment and audit-logs it', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))

      const item = await createResource(
        storekeeper,
        fields({ name: 'Load cell — 10 t', serialNumber: 'LC-10T-11', calibrationDueDate: dayFromToday(45) }),
        tx,
      )

      expect(item.name).toBe('Load cell — 10 t')
      expect(item.dueBucket).toBe('60')
      expect(item.overdue).toBe(false)
      expect(item.file).toBeNull()

      const trail = await tx.auditLog.findMany({
        where: { entity: 'Resource', entityId: item.id },
      })
      expect(trail).toHaveLength(1)
      expect(trail[0]!.action).toBe('CREATE')
      expect(trail[0]!.userId).toBe(storekeeper.userId)
      expect((trail[0]!.after as Record<string, unknown>).name).toBe('Load cell — 10 t')
    })
  })

  it('updates only the changed fields and keeps a certificate when no new file is given', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const item = await createResource(storekeeper, fields({ name: 'Old name' }), tx)

      const file = await tx.file.create({
        data: {
          entity: 'Resource',
          entityId: item.id,
          kind: 'CERTIFICATE',
          filename: 'calibration.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          storageKey: `resources/${item.id}/calibrations/${testSuffix()}.pdf`,
        },
      })

      const withFile = await updateResource(
        storekeeper,
        item.id,
        { ...fields({ name: 'Old name' }), fileId: file.id },
        tx,
      )
      expect(withFile.file?.filename).toBe('calibration.pdf')

      // No `fileId` on the form means "keep what is there", not "remove it".
      const renamed = await updateResource(
        storekeeper,
        item.id,
        fields({ name: 'New name', calibrationDueDate: dayFromToday(10) }),
        tx,
      )
      expect(renamed.name).toBe('New name')
      expect(renamed.file?.filename).toBe('calibration.pdf')

      const update = await tx.auditLog.findFirstOrThrow({
        where: { entity: 'Resource', entityId: item.id, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      })
      const before = update.before as Record<string, unknown>
      const after = update.after as Record<string, unknown>
      expect(before.name).toBe('Old name')
      expect(after.name).toBe('New name')
      // Unchanged fields are dropped from the diff: the log says what moved, not what did not.
      expect(before.type).toBeUndefined()
    })
  })

  it('refuses a file that was not uploaded for this item', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const mine = await createResource(storekeeper, fields(), tx)
      const theirs = await createResource(storekeeper, fields(), tx)

      const file = await tx.file.create({
        data: {
          entity: 'Resource',
          entityId: theirs.id,
          kind: 'CERTIFICATE',
          filename: 'theirs.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          storageKey: `resources/${theirs.id}/calibrations/${testSuffix()}.pdf`,
        },
      })

      await expect(
        updateResource(storekeeper, mine.id, { ...fields(), fileId: file.id }, tx),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it('refuses to retire equipment still booked on an open job', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const fixtures = await jobFixtures(tx)
      const job = await jobFixture(
        tx,
        { customerId: fixtures.customer.id, siteId: fixtures.site.id, jobTypeId: fixtures.jobType.id },
        { suffix: fixtures.suffix },
      )
      const item = await createResource(storekeeper, fields({ status: 'IN_USE' }), tx)
      await tx.jobResource.create({ data: { jobId: job.id, resourceId: item.id } })

      await expect(
        updateResource(storekeeper, item.id, fields({ status: 'RETIRED' }), tx),
      ).rejects.toBeInstanceOf(ValidationError)

      // Closing the job releases it, and retiring keeps the row — history names it forever.
      await tx.job.update({ where: { id: job.id }, data: { status: 'CLOSED' } })
      const retired = await updateResource(storekeeper, item.id, fields({ status: 'RETIRED' }), tx)
      expect(retired.status).toBe('RETIRED')
      expect(await tx.resource.count({ where: { id: item.id } })).toBe(1)
    })
  })

  it('refuses a write from a role without resource.write', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      await expect(createResource(dispatcher, fields(), tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('counts the overdue and 30/90-day windows and filters the list by them', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      const suffix = testSuffix()
      const before = await calibrationCounts(storekeeper, tx)

      const add = (days: number | null) =>
        createResource(
          storekeeper,
          fields({
            name: `Calibration ${suffix} ${days ?? 'none'}`,
            calibrationDueDate: days === null ? '' : dayFromToday(days),
          }),
          tx,
        )

      const lapsed = await add(-5)
      const soon = await add(10)
      const later = await add(45)
      const undated = await add(null)

      const after = await calibrationCounts(storekeeper, tx)
      expect(after.overdue - before.overdue).toBe(1)
      expect(after.dueWithin30Days - before.dueWithin30Days).toBe(1)
      expect(after.dueWithin90 - before.dueWithin90).toBe(2)

      expect(calibrationDueLabel(lapsed)).toBe('lapsed 5 days ago')
      expect(calibrationDueLabel(soon)).toBe('lapses in 10 days')
      expect(calibrationDueLabel(undated)).toBe('no calibration recorded')

      // The search narrows to this test's rows, so the bucket filter proves itself rather than
      // counting whatever else the database holds.
      const mine = await listCalibrations(storekeeper, { q: suffix }, tx)
      expect(mine.map((row) => row.id)).toEqual([lapsed.id, soon.id, later.id, undated.id])
      expect(mine.map((row) => row.dueBucket)).toEqual(['overdue', '30', '60', 'none'])

      const overdueOnly = await listCalibrations(storekeeper, { q: suffix, due: 'overdue' }, tx)
      expect(overdueOnly.map((row) => row.id)).toEqual([lapsed.id])
    })
  })
})
