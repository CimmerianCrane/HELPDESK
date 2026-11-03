import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import {
  ForbiddenError,
  NotFoundError,
  RuleError,
  ValidationError,
} from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  archiveSchedule,
  createSchedule,
  dueLabelFor,
  listSchedules,
  markSchedulesDone,
  scheduleCounts,
  schedulesForCrane,
  schedulesForJobCranes,
  updateSchedule,
} from '@/server/schedules/schedules'
import { transitionJob } from '@/server/jobs/jobs'
import { craneFixtures, inRolledBackTx, jobFixture, technicianFixture, testSuffix, type Tx } from './helpers'

/**
 * Crane schedules against the real database, inside a transaction that always rolls back (slice 12).
 *
 * The cases that matter are the ones a screen cannot show you: that a technician sees the obligations
 * on their own cranes and nobody else's, that every write lands in the audit log, and that completing
 * a job rolls the schedule forward rather than merely recording the status change.
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

/** `YYYY-MM-DD` for a date so many days from today, so a fixture's "overdue" stays true as time passes. */
function dayFromToday(days: number): Date {
  const now = new Date()
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return new Date(day.getTime() + days * 86_400_000)
}

describe('crane schedules', () => {
  it('creates a schedule and audit-logs it', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const { crane } = await craneFixtures(tx)
      const context = contextFor(dispatcher)

      const schedule = await createSchedule(
        context,
        {
          craneId: crane.id,
          scheduleType: 'MONTHLY_SERVICE',
          intervalMonths: '1',
          lastDoneDate: '2026-09-01',
          reminderOffsets: '90, 60, 30',
        },
        tx,
      )

      expect(schedule.crane.id).toBe(crane.id)
      // One month after the last done date, derived rather than typed.
      expect(schedule.nextDueDate?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
      expect(schedule.reminderOffsetsDays).toEqual([90, 60, 30])

      const entry = await tx.auditLog.findFirst({
        where: { entity: 'CraneSchedule', entityId: schedule.id, action: 'CREATE' },
      })
      expect(entry).not.toBeNull()
      expect(entry?.userId).toBe(dispatcher.id)
    })
  })

  it('refuses a second schedule of the same kind on one crane', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const { crane } = await craneFixtures(tx)
      const context = contextFor(dispatcher)
      const input = {
        craneId: crane.id,
        scheduleType: 'LOAD_TEST' as const,
        intervalMonths: '12',
        lastDoneDate: '2026-01-01',
      }

      await createSchedule(context, input, tx)
      await expect(createSchedule(context, input, tx)).rejects.toThrow(RuleError)
    })
  })

  it('requires either an interval or a next due date', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const { crane } = await craneFixtures(tx)

      const error = await createSchedule(
        contextFor(dispatcher),
        { craneId: crane.id, scheduleType: 'OTHER', intervalMonths: '' },
        tx,
      ).catch((thrown: unknown) => thrown)

      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).fields.nextDueDate?.[0]).toContain('Give an interval')
    })
  })

  it('refuses an interval and a typed next due date together, since they would disagree', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const { crane } = await craneFixtures(tx)

      const error = await createSchedule(
        contextFor(dispatcher),
        {
          craneId: crane.id,
          scheduleType: 'OTHER',
          intervalMonths: '6',
          lastDoneDate: '2026-01-01',
          nextDueDate: '2026-07-01',
        },
        tx,
      ).catch((thrown: unknown) => thrown)

      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).fields.nextDueDate?.[0]).toContain(
        'next due date comes from the last done date',
      )
    })
  })

  it('denies a technician the ability to create a schedule', async () => {
    await inRolledBackTx(async (tx) => {
      const { technician } = await technicianFixture(tx)
      const user = await tx.user.findUniqueOrThrow({ where: { id: technician.userId } })
      const { crane } = await craneFixtures(tx)

      await expect(
        createSchedule(
          contextFor(user, { technicianId: technician.id }),
          { craneId: crane.id, scheduleType: 'OTHER', nextDueDate: '2026-12-01' },
          tx,
        ),
      ).rejects.toThrow(ForbiddenError)
    })
  })

  it('scopes a technician to schedules on cranes they are assigned work at', async () => {
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

      const visible = await createSchedule(
        dispatcher,
        {
          craneId: mine.crane.id,
          scheduleType: 'MONTHLY_SERVICE',
          intervalMonths: '1',
          lastDoneDate: '2026-01-01',
        },
        tx,
      )
      const hidden = await createSchedule(
        dispatcher,
        {
          craneId: theirs.crane.id,
          scheduleType: 'MONTHLY_SERVICE',
          intervalMonths: '1',
          lastDoneDate: '2026-01-01',
        },
        tx,
      )

      const rows = await listSchedules(techContext, {}, tx)
      const ids = rows.map((row) => row.id)
      expect(ids).toContain(visible.id)
      expect(ids).not.toContain(hidden.id)

      // And the crane page's own read agrees — one service, so it must.
      expect((await schedulesForCrane(techContext, mine.crane.id, tx)).map((r) => r.id)).toEqual([
        visible.id,
      ])
      await expect(schedulesForCrane(techContext, theirs.crane.id, tx)).resolves.toEqual([])

      // Searching must narrow, never widen: typing another customer's asset tag is exactly how a
      // scoped list gets bypassed.
      expect(await listSchedules(techContext, { q: theirs.crane.assetTag }, tx)).toEqual([])
    })
  })

  it('recomputes the next due date when the interval or last done date is edited', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { crane } = await craneFixtures(tx)

      const schedule = await createSchedule(
        dispatcher,
        {
          craneId: crane.id,
          scheduleType: 'ANNUAL_EXAMINATION',
          intervalMonths: '12',
          lastDoneDate: '2025-06-15',
        },
        tx,
      )
      expect(schedule.nextDueDate?.toISOString()).toBe('2026-06-15T00:00:00.000Z')

      const updated = await updateSchedule(
        dispatcher,
        schedule.id,
        {
          scheduleType: 'ANNUAL_EXAMINATION',
          intervalMonths: '24',
          lastDoneDate: '2025-06-15',
        },
        tx,
      )
      expect(updated.nextDueDate?.toISOString()).toBe('2027-06-15T00:00:00.000Z')

      const entry = await tx.auditLog.findFirst({
        where: { entity: 'CraneSchedule', entityId: schedule.id, action: 'UPDATE' },
      })
      expect(entry).not.toBeNull()
    })
  })

  it('archives by soft delete, so the row and its trail survive', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { crane } = await craneFixtures(tx)
      const schedule = await createSchedule(
        dispatcher,
        {
          craneId: crane.id,
          scheduleType: 'OTHER',
          intervalMonths: '6',
          lastDoneDate: '2026-01-01',
        },
        tx,
      )

      await archiveSchedule(dispatcher, schedule.id, tx)

      expect(await tx.craneSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).toMatchObject({
        deletedAt: expect.any(Date),
      })
      // Scoped to this fixture's crane: the live database has seeded schedules a dispatcher can see.
      expect(await listSchedules(dispatcher, { q: crane.assetTag }, tx)).toEqual([])
      await expect(updateSchedule(dispatcher, schedule.id, {
        scheduleType: 'OTHER',
        nextDueDate: '2026-12-01',
      }, tx)).rejects.toThrow(NotFoundError)
    })
  })

  it('counts overdue and due-soon separately, from the same rows the list reads', async () => {
    await inRolledBackTx(async (tx) => {
      // A technician sees only their own cranes, so the counts are exactly the fixture's two rows —
      // a dispatcher's counts would include the seeded ones and prove nothing about the bucketing.
      const { technician } = await technicianFixture(tx)
      const user = await tx.user.findUniqueOrThrow({ where: { id: technician.userId } })
      const context = contextFor(user, { technicianId: technician.id })
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))

      const fixtures = await craneFixtures(tx)
      const job = await jobFixture(
        tx,
        { customerId: fixtures.customer.id, siteId: fixtures.site.id, jobTypeId: fixtures.jobType.id },
        { suffix: fixtures.suffix, assignTo: technician.id },
      )
      await tx.jobCrane.create({ data: { jobId: job.id, craneId: fixtures.crane.id } })

      await createSchedule(
        dispatcher,
        { craneId: fixtures.crane.id, scheduleType: 'MONTHLY_SERVICE', intervalMonths: '1', lastDoneDate: dayFromToday(-40).toISOString().slice(0, 10) },
        tx,
      )
      await createSchedule(
        dispatcher,
        { craneId: fixtures.crane.id, scheduleType: 'ANNUAL_EXAMINATION', intervalMonths: '1', lastDoneDate: dayFromToday(-15).toISOString().slice(0, 10) },
        tx,
      )

      const counts = await scheduleCounts(context, tx)
      expect(counts.overdue).toBe(1)
      expect(counts.dueWithin30Days).toBe(1)

      // The filtered list the dashboard links to agrees with the tile.
      expect(await listSchedules(context, { due: 'overdue' }, tx)).toHaveLength(1)
      expect(await listSchedules(context, { due: '30' }, tx)).toHaveLength(1)
    })
  })
})

describe('marking schedules done from a completed job', () => {
  it('rolls the schedule forward from the job completion date, in the same transaction', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcherUser = await makeUser(tx, 'DISPATCHER')
      const dispatcher = contextFor(dispatcherUser)
      const fixtures = await craneFixtures(tx)

      const job = await jobFixture(
        tx,
        { customerId: fixtures.customer.id, siteId: fixtures.site.id, jobTypeId: fixtures.jobType.id },
        { suffix: fixtures.suffix },
      )
      await tx.jobCrane.create({ data: { jobId: job.id, craneId: fixtures.crane.id } })

      const schedule = await createSchedule(
        dispatcher,
        {
          craneId: fixtures.crane.id,
          scheduleType: 'MONTHLY_SERVICE',
          intervalMonths: '1',
          lastDoneDate: '2026-01-01',
        },
        tx,
      )

      // Walk the job to In Progress, then complete it with the schedule ticked.
      await transitionJob(dispatcher, job.id, { status: 'TRIAGED' }, tx)
      await transitionJob(dispatcher, job.id, { status: 'APPROVED' }, tx)
      await transitionJob(dispatcher, job.id, { status: 'SCHEDULED' }, tx)
      await transitionJob(dispatcher, job.id, { status: 'DISPATCHED' }, tx)
      await transitionJob(dispatcher, job.id, { status: 'IN_PROGRESS' }, tx)

      const completed = await transitionJob(
        dispatcher,
        job.id,
        { status: 'COMPLETED', scheduleIds: [schedule.id] },
        tx,
      )

      const after = await tx.craneSchedule.findUniqueOrThrow({ where: { id: schedule.id } })
      expect(after.lastDoneDate?.toISOString()).toBe(completed.completedAt?.toISOString())
      // One month on from the completion date, not from the old last-done date.
      expect(after.nextDueDate?.getTime()).toBeGreaterThan(completed.completedAt!.getTime())

      const entry = await tx.auditLog.findFirst({
        where: {
          entity: 'CraneSchedule',
          entityId: schedule.id,
          action: 'UPDATE',
          userId: dispatcherUser.id,
        },
        orderBy: { createdAt: 'desc' },
      })
      expect(entry).not.toBeNull()
      expect(entry?.after).toMatchObject({ viaJob: job.number })
    })
  })

  it('refuses a schedule that is not on the job’s cranes', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const mine = await craneFixtures(tx)
      const theirs = await craneFixtures(tx)

      const job = await jobFixture(
        tx,
        { customerId: mine.customer.id, siteId: mine.site.id, jobTypeId: mine.jobType.id },
        { suffix: mine.suffix },
      )
      await tx.jobCrane.create({ data: { jobId: job.id, craneId: mine.crane.id } })

      const other = await createSchedule(
        dispatcher,
        {
          craneId: theirs.crane.id,
          scheduleType: 'LOAD_TEST',
          intervalMonths: '12',
          lastDoneDate: '2026-01-01',
        },
        tx,
      )

      await expect(
        markSchedulesDone(dispatcher, { jobId: job.id, scheduleIds: [other.id] }, tx),
      ).rejects.toThrow(RuleError)
    })
  })

  it('offers only the schedules on the job’s cranes', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const mine = await craneFixtures(tx)
      const theirs = await craneFixtures(tx)

      const job = await jobFixture(
        tx,
        { customerId: mine.customer.id, siteId: mine.site.id, jobTypeId: mine.jobType.id },
        { suffix: mine.suffix },
      )
      await tx.jobCrane.create({ data: { jobId: job.id, craneId: mine.crane.id } })

      const onThisJob = await createSchedule(
        dispatcher,
        {
          craneId: mine.crane.id,
          scheduleType: 'MONTHLY_SERVICE',
          intervalMonths: '1',
          lastDoneDate: '2026-01-01',
        },
        tx,
      )
      await createSchedule(
        dispatcher,
        {
          craneId: theirs.crane.id,
          scheduleType: 'MONTHLY_SERVICE',
          intervalMonths: '1',
          lastDoneDate: '2026-01-01',
        },
        tx,
      )

      const offered = await schedulesForJobCranes(dispatcher, job.id, tx)
      expect(offered.map((row) => row.id)).toEqual([onThisJob.id])
      expect(dueLabelFor(offered[0]!, 'Asia/Singapore')).toMatch(/overdue|due/)
    })
  })

  it('rejects schedule ids posted against any status other than Completed', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const fixtures = await craneFixtures(tx)
      const job = await jobFixture(
        tx,
        { customerId: fixtures.customer.id, siteId: fixtures.site.id, jobTypeId: fixtures.jobType.id },
        { suffix: fixtures.suffix },
      )

      const error = await transitionJob(
        dispatcher,
        job.id,
        { status: 'TRIAGED', scheduleIds: ['anything'] },
        tx,
      ).catch((thrown: unknown) => thrown)

      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).fields.scheduleIds?.[0]).toContain(
        'only recorded when a job is completed',
      )
    })
  })
})
