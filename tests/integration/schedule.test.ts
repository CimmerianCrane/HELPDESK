import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, NotFoundError, RuleError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  assignTechnician,
  bumpScheduledJob,
  moveJobCard,
  rescheduleJob,
  scheduleBoard,
  unassignTechnician,
} from '@/server/schedule/scheduling'
import {
  bookResource,
  createOnCallShift,
  createUnavailability,
  deleteUnavailability,
  listTechnicians,
} from '@/server/schedule/roster'
import { dispatchJob, dispatchPack } from '@/server/schedule/dispatch'
import { getSetting, setSetting } from '@/server/settings/settings'
import { wallTimeToUtc, zonedParts } from '@/lib/time'
import { craneFixtures, inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * Scheduling against the real database.
 *
 * The pure rules are covered in `tests/unit/schedule.test.ts`; what can only be checked here is that
 * the service applies them — that a blocked competency actually stops the write, that a warning needs
 * an override to proceed, that a bump leaves both the `ScheduleBump` row and the audit entry, and that
 * a dispatch carries the site's access notes and the lead technician's identity.
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
    ip: '203.0.113.9',
    userAgent: 'vitest',
    ...overrides,
  }
}

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${role.toLowerCase()}-sched-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

/**
 * Runs `fn` with the competency-blocking setting at `value`, then puts it back.
 *
 * `setSetting` writes through the global client, not the test's transaction, so the change is real
 * and would leak into every later test — including the production behaviour the setting controls.
 * Restoring in a `finally` is the only safe way to flip it. This is also why the setting lives in a
 * table: it is edited by the office at runtime, so no amount of test discipline can assume a value.
 */
async function withCompetencyBlocking<T>(value: boolean, fn: () => Promise<T>): Promise<T> {
  const previous = await getSetting('blockAssignmentOnExpiredCompetency')
  await setSetting('blockAssignmentOnExpiredCompetency', value)
  try {
    return await fn()
  } finally {
    await setSetting('blockAssignmentOnExpiredCompetency', previous)
  }
}

async function makeTechnician(tx: Tx, name = `Tech ${testSuffix()}`) {
  const suffix = testSuffix()
  const user = await tx.user.create({
    data: {
      email: `tech-sched-${suffix}@example.test`,
      name,
      role: 'TECHNICIAN',
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
  const technician = await tx.technician.create({
    data: { userId: user.id, employeeNo: `E-${suffix}` },
  })
  return { user, technician }
}

/** The shape `craneFixtures` returns, which is what most tests here start from. */
type Fixtures = {
  customer: { id: string }
  site: { id: string }
  jobType: { id: string }
}

/** A job with a date and the given technicians, in a status a board would show. */
async function scheduledJob(
  tx: Tx,
  base: Fixtures,
  options: {
    technicianIds?: string[]
    start?: Date
    end?: Date
    priority?: 'P1' | 'P2' | 'P3' | 'P4'
    status?: 'TRIAGED' | 'SCHEDULED' | 'APPROVED'
  } = {},
) {
  const suffix = testSuffix()
  const job = await tx.job.create({
    data: {
      number: `JOB-SCHED-${suffix}`,
      jobTypeId: base.jobType.id,
      customerId: base.customer.id,
      siteId: base.site.id,
      status: options.status ?? 'SCHEDULED',
      priority: options.priority ?? 'P3',
      scheduledStart: options.start ?? new Date('2026-10-26T00:00:00Z'),
      scheduledEnd: options.end ?? new Date('2026-10-26T02:00:00Z'),
    },
  })

  for (const [index, technicianId] of (options.technicianIds ?? []).entries()) {
    await tx.jobTechnician.create({
      data: { jobId: job.id, technicianId, isLead: index === 0 },
    })
  }

  return job
}

describe('the schedule board', () => {
  it('places a visit in the window and leaves out the finished ones', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)

      const scheduled = await scheduledJob(tx, base, { technicianIds: [technician.id] })
      const finished = await scheduledJob(tx, base, { technicianIds: [technician.id] })
      await tx.job.update({ where: { id: finished.id }, data: { status: 'CLOSED' } })

      const board = await scheduleBoard(
        contextFor(dispatcher),
        { date: '2026-10-26', view: 'day' },
        tx,
        new Date('2026-10-26T00:00:00Z'),
      )

      const ids = board.jobs.map((card) => card.id)
      expect(ids).toContain(scheduled.id)
      expect(ids).not.toContain(finished.id)
    })
  })

  it('separates work that has a date and nobody on it from work with nobody and no date', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      const dated = await scheduledJob(tx, base)
      const undated = await tx.job.create({
        data: {
          number: `JOB-UNDATED-${testSuffix()}`,
          jobTypeId: base.jobType.id,
          customerId: base.customer.id,
          siteId: base.site.id,
          status: 'SCHEDULED',
          priority: 'P3',
        },
      })

      const board = await scheduleBoard(
        contextFor(dispatcher),
        { date: '2026-10-26' },
        tx,
        new Date('2026-10-26T00:00:00Z'),
      )

      expect(board.unassigned.map((card) => card.id)).toContain(dated.id)
      expect(board.undated.map((card) => card.id)).toContain(undated.id)
    })
  })

  it('refuses a role without job.schedule', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = await makeUser(tx, 'FINANCE')
      await expect(
        scheduleBoard(contextFor(finance), {}, tx, new Date('2026-10-26T00:00:00Z')),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})

describe('assigning a technician', () => {
  it('records the assignment, makes the first person lead, and moves a triaged job on', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)
      const job = await scheduledJob(tx, base, { status: 'TRIAGED' })

      const result = await assignTechnician(
        contextFor(dispatcher),
        job.id,
        { technicianId: technician.id },
        tx,
      )

      expect(result.warnings).toEqual([])

      const assigned = await tx.jobTechnician.findUniqueOrThrow({
        where: { jobId_technicianId: { jobId: job.id, technicianId: technician.id } },
        select: { isLead: true, assignedById: true },
      })
      expect(assigned.isLead).toBe(true)
      expect(assigned.assignedById).toBe(dispatcher.id)

      const after = await tx.job.findUniqueOrThrow({
        where: { id: job.id },
        select: { status: true },
      })
      expect(after.status).toBe('SCHEDULED')

      const history = await tx.jobStatusHistory.findFirst({
        where: { jobId: job.id, toStatus: 'SCHEDULED' },
        select: { fromStatus: true, changedById: true },
      })
      expect(history?.fromStatus).toBe('TRIAGED')
      expect(history?.changedById).toBe(dispatcher.id)

      const logs = await tx.auditLog.findMany({ where: { entity: 'Job', entityId: job.id } })
      expect(logs).toHaveLength(1)
    })
  })

  it('blocks an assignment the competency setting marks as blocked', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)

      await tx.jobType.update({
        where: { id: base.jobType.id },
        data: { requiredCompetencies: ['Rigging'] },
      })
      const job = await scheduledJob(tx, base)

      await withCompetencyBlocking(true, async () => {
        await expect(
          assignTechnician(contextFor(dispatcher), job.id, { technicianId: technician.id }, tx),
        ).rejects.toBeInstanceOf(RuleError)

        // Nothing was written.
        expect(
          await tx.jobTechnician.count({ where: { jobId: job.id, technicianId: technician.id } }),
        ).toBe(0)
      })
    })
  })

  it('treats an expired competency as a gap when the setting blocks, and as fine when it does not', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)

      await tx.competency.create({
        data: {
          technicianId: technician.id,
          name: 'Rigging',
          expiryDate: new Date('2026-01-01T00:00:00Z'),
        },
      })
      await tx.jobType.update({
        where: { id: base.jobType.id },
        data: { requiredCompetencies: ['rigging'] },
      })
      const job = await scheduledJob(tx, base)

      await withCompetencyBlocking(true, async () => {
        // The message names the competency the way the *office* typed it in the requirement — the
        // case-insensitive match is for comparison, not for rewriting what was asked for.
        await expect(
          assignTechnician(contextFor(dispatcher), job.id, { technicianId: technician.id }, tx),
        ).rejects.toThrow(/rigging/)
      })

      await withCompetencyBlocking(false, async () => {
        const result = await assignTechnician(
          contextFor(dispatcher),
          job.id,
          { technicianId: technician.id },
          tx,
        )
        expect(result.competency.expired).toEqual(['rigging'])
        expect(result.competency.blocked).toBe(false)
      })
    })
  })

  it('warns about a double booking and refuses without an override', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)

      const first = await scheduledJob(tx, base)
      const second = await scheduledJob(tx, base)

      await assignTechnician(contextFor(dispatcher), first.id, { technicianId: technician.id }, tx)

      await expect(
        assignTechnician(contextFor(dispatcher), second.id, { technicianId: technician.id }, tx),
      ).rejects.toBeInstanceOf(RuleError)

      const overridden = await assignTechnician(
        contextFor(dispatcher),
        second.id,
        {
          technicianId: technician.id,
          override: true,
          overrideReason: 'P1 cover; the first visit will be moved.',
        },
        tx,
      )
      expect(overridden.warnings.join(' ')).toContain(first.number)

      const logs = await tx.auditLog.findMany({
        where: { entity: 'Job', entityId: second.id },
        orderBy: { createdAt: 'asc' },
      })
      // One row for the override decision, one for the assignment itself.
      expect(logs).toHaveLength(2)
      expect(logs[0]?.after).toMatchObject({ assignmentOverride: true })
    })
  })

  it('requires a reason when overriding', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)

      const job = await scheduledJob(tx, base)
      await tx.unavailability.create({
        data: {
          technicianId: technician.id,
          startAt: new Date('2026-10-26T00:00:00Z'),
          endAt: new Date('2026-10-27T00:00:00Z'),
          reason: 'Annual leave',
        },
      })

      await expect(
        assignTechnician(
          contextFor(dispatcher),
          job.id,
          { technicianId: technician.id, override: true },
          tx,
        ),
      ).rejects.toThrow(/why/i)
    })
  })

  it('refuses an inactive technician', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { user, technician } = await makeTechnician(tx)
      await tx.user.update({ where: { id: user.id }, data: { isActive: false } })
      const job = await scheduledJob(tx, base)

      await expect(
        assignTechnician(contextFor(dispatcher), job.id, { technicianId: technician.id }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('refuses a role without job.assign', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = await makeUser(tx, 'FINANCE')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)
      const job = await scheduledJob(tx, base)

      await expect(
        assignTechnician(contextFor(finance), job.id, { technicianId: technician.id }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})

describe('unassigning', () => {
  it('promotes the next technician when the lead comes off', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const lead = await makeTechnician(tx, 'Lead')
      const second = await makeTechnician(tx, 'Second')
      const job = await scheduledJob(tx, base, {
        technicianIds: [lead.technician.id, second.technician.id],
      })

      await unassignTechnician(
        contextFor(dispatcher),
        job.id,
        { technicianId: lead.technician.id },
        tx,
      )

      const remaining = await tx.jobTechnician.findUniqueOrThrow({
        where: { jobId_technicianId: { jobId: job.id, technicianId: second.technician.id } },
        select: { isLead: true },
      })
      expect(remaining.isLead).toBe(true)
    })
  })

  it('refuses to pull somebody off a job they have started', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)
      const job = await scheduledJob(tx, base, { technicianIds: [technician.id] })
      await tx.job.update({ where: { id: job.id }, data: { status: 'IN_PROGRESS' } })

      await expect(
        unassignTechnician(contextFor(dispatcher), job.id, { technicianId: technician.id }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })
})

describe('rescheduling', () => {
  it('moves the visit, records the previous span, and warns about a clash', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)

      // Both spans are seeded as instants; the reschedule takes wall time in Singapore (UTC+8), so
      // 07:00 local is 23:00Z the previous day and would slide under `fixed` without clashing. The
      // clash is therefore written in local terms: 14:00–16:00 Singapore, which is 06:00–08:00Z —
      // exactly where `fixed` sits.
      const fixed = await scheduledJob(tx, base, {
        technicianIds: [technician.id],
        start: new Date('2026-10-26T06:00:00Z'),
        end: new Date('2026-10-26T08:00:00Z'),
      })
      const moving = await scheduledJob(tx, base, {
        technicianIds: [technician.id],
        start: new Date('2026-10-26T00:00:00Z'),
        end: new Date('2026-10-26T02:00:00Z'),
      })

      const clash = { scheduledStart: '2026-10-26T14:00', scheduledEnd: '2026-10-26T16:00' }

      await expect(
        rescheduleJob(contextFor(dispatcher), moving.id, clash, tx),
      ).rejects.toBeInstanceOf(RuleError)

      const result = await rescheduleJob(
        contextFor(dispatcher),
        moving.id,
        { ...clash, confirm: true },
        tx,
      )
      expect(result.warnings.join(' ')).toContain(fixed.number)

      const moved = await tx.job.findUniqueOrThrow({
        where: { id: moving.id },
        select: { scheduledStart: true, scheduledEnd: true },
      })
      expect(moved.scheduledStart?.toISOString()).toBe('2026-10-26T06:00:00.000Z')

      const log = await tx.auditLog.findFirst({
        where: { entity: 'Job', entityId: moving.id },
        orderBy: { createdAt: 'desc' },
      })
      expect(log?.before).toMatchObject({ scheduledStart: expect.any(String) })
    })
  })

  it('refuses to move a visit that has started', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const job = await scheduledJob(tx, base)
      await tx.job.update({ where: { id: job.id }, data: { status: 'IN_PROGRESS' } })

      await expect(
        rescheduleJob(
          contextFor(dispatcher),
          job.id,
          { scheduledStart: '2026-10-27T08:00', scheduledEnd: '2026-10-27T10:00' },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })
})

describe('priority bumps', () => {
  it('clears the displaced slot, writes a ScheduleBump row and audits both changes', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      const displaced = await scheduledJob(tx, base)
      const incoming = await scheduledJob(tx, base, { priority: 'P1' })

      const result = await bumpScheduledJob(
        contextFor(dispatcher),
        displaced.id,
        { incomingJobId: incoming.id, reason: 'Crane down at the same site.' },
        tx,
      )

      expect(result.displacedJobNumber).toBe(displaced.number)

      const after = await tx.job.findUniqueOrThrow({
        where: { id: displaced.id },
        select: { status: true, scheduledStart: true, scheduledEnd: true },
      })
      expect(after.status).toBe('APPROVED')
      expect(after.scheduledStart).toBeNull()

      const bump = await tx.scheduleBump.findFirst({
        where: { displacedJobId: displaced.id },
        select: {
          incomingJobId: true,
          reason: true,
          previousStart: true,
          bumpedById: true,
        },
      })
      expect(bump?.incomingJobId).toBe(incoming.id)
      expect(bump?.reason).toBe('Crane down at the same site.')
      expect(bump?.previousStart?.toISOString()).toBe('2026-10-26T00:00:00.000Z')
      expect(bump?.bumpedById).toBe(dispatcher.id)

      const history = await tx.jobStatusHistory.findFirst({
        where: { jobId: displaced.id, toStatus: 'APPROVED' },
        select: { reason: true, fromStatus: true },
      })
      expect(history?.reason).toContain(incoming.number)

      const log = await tx.auditLog.findFirst({
        where: { entity: 'Job', entityId: displaced.id },
      })
      expect(log?.after).toMatchObject({ bumpedFor: incoming.number })
    })
  })

  it('refuses to bump a job onto itself, or one that is not scheduled', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const scheduled = await scheduledJob(tx, base)
      const undated = await scheduledJob(tx, base)
      await tx.job.update({
        where: { id: undated.id },
        data: { scheduledStart: null, scheduledEnd: null },
      })

      await expect(
        bumpScheduledJob(
          contextFor(dispatcher),
          scheduled.id,
          { incomingJobId: scheduled.id, reason: 'Mistake.' },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)

      await expect(
        bumpScheduledJob(
          contextFor(dispatcher),
          undated.id,
          { incomingJobId: scheduled.id, reason: 'Mistake.' },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('requires a reason', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const displaced = await scheduledJob(tx, base)
      const incoming = await scheduledJob(tx, base)

      await expect(
        bumpScheduledJob(
          contextFor(dispatcher),
          displaced.id,
          { incomingJobId: incoming.id, reason: '   ' },
          tx,
        ),
      ).rejects.toThrow()
    })
  })

  it('refuses a role without job.bump', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const base = await craneFixtures(tx)
      const displaced = await scheduledJob(tx, base)
      const incoming = await scheduledJob(tx, base)

      await expect(
        bumpScheduledJob(
          contextFor(storekeeper),
          displaced.id,
          { incomingJobId: incoming.id, reason: 'No.' },
          tx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})

describe('leave and the on-call roster', () => {
  it('records leave and names the jobs it clashes with in the audit entry', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)
      const job = await scheduledJob(tx, base, { technicianIds: [technician.id] })

      const leave = await createUnavailability(
        contextFor(dispatcher),
        {
          technicianId: technician.id,
          startAt: '2026-10-26T00:00',
          endAt: '2026-10-27T00:00',
          reason: 'Annual leave',
        },
        tx,
      )

      const log = await tx.auditLog.findFirst({
        where: { entity: 'Technician', entityId: technician.id },
      })
      expect(log?.after).toMatchObject({ clashesWithJobs: [job.number] })

      await deleteUnavailability(contextFor(dispatcher), leave.id, tx)
      expect(await tx.unavailability.count({ where: { technicianId: technician.id } })).toBe(0)
    })
  })

  it('reports the holes in the on-call roster', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const { technician } = await makeTechnician(tx)

      await createOnCallShift(
        contextFor(dispatcher),
        {
          technicianId: technician.id,
          startAt: '2026-10-26T00:00',
          endAt: '2026-10-26T12:00',
        },
        tx,
      )

      const board = await scheduleBoard(
        contextFor(dispatcher),
        { date: '2026-10-26' },
        tx,
        new Date('2026-10-25T16:00:00Z'),
      )

      // Local midnight to local noon in Singapore is 16:00Z–04:00Z, and the local day itself runs
      // 16:00Z–16:00Z. So the uncovered span is the afternoon and evening: one gap, from 04:00Z to
      // the end of the Singapore day.
      expect(board.onCallGaps).toHaveLength(1)
      expect(board.onCallGaps[0]?.start.toISOString()).toBe('2026-10-26T04:00:00.000Z')
      expect(board.onCallGaps[0]?.end.toISOString()).toBe('2026-10-26T16:00:00.000Z')
    })
  })

  it('lists technicians with their expiry flagged', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const { technician } = await makeTechnician(tx, 'Expired Holder')
      await tx.competency.create({
        data: {
          technicianId: technician.id,
          name: 'Rigging',
          expiryDate: new Date('2020-01-01T00:00:00Z'),
        },
      })

      const rows = await listTechnicians(contextFor(dispatcher), tx)
      const row = rows.find((entry) => entry.id === technician.id)
      expect(row?.competencies[0]?.expired).toBe(true)
    })
  })
})

describe('resource booking', () => {
  it('books a resource for the visit when no span is given, and flags a calibration lapse', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const job = await scheduledJob(tx, base)
      const resource = await tx.resource.create({
        data: {
          name: `Test weight ${testSuffix()}`,
          type: 'TEST_WEIGHT',
          calibrationDueDate: new Date('2020-01-01T00:00:00Z'),
        },
      })

      await expect(
        bookResource(contextFor(dispatcher), job.id, { resourceId: resource.id }, tx),
      ).rejects.toBeInstanceOf(RuleError)

      const booking = await bookResource(
        contextFor(dispatcher),
        job.id,
        { resourceId: resource.id, confirm: true },
        tx,
      )
      expect(booking.warnings.join(' ')).toContain('calibration')

      const stored = await tx.jobResource.findUniqueOrThrow({
        where: { jobId_resourceId: { jobId: job.id, resourceId: resource.id } },
        select: { startAt: true, endAt: true },
      })
      expect(stored.startAt?.toISOString()).toBe('2026-10-26T00:00:00.000Z')
      expect(stored.endAt?.toISOString()).toBe('2026-10-26T02:00:00.000Z')
    })
  })

  it('warns when the same resource is wanted by two jobs at once', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const first = await scheduledJob(tx, base)
      const second = await scheduledJob(tx, base)
      const resource = await tx.resource.create({
        data: { name: `Load cell ${testSuffix()}`, type: 'LOAD_CELL' },
      })

      await bookResource(contextFor(dispatcher), first.id, { resourceId: resource.id }, tx)

      await expect(
        bookResource(contextFor(dispatcher), second.id, { resourceId: resource.id }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('refuses a retired resource outright', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const job = await scheduledJob(tx, base)
      const resource = await tx.resource.create({
        data: { name: `Old van ${testSuffix()}`, type: 'VEHICLE', status: 'RETIRED' },
      })

      await expect(
        bookResource(
          contextFor(dispatcher),
          job.id,
          { resourceId: resource.id, confirm: true },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })
})

describe('dispatch', () => {
  it('builds the pack with the site contact, access notes and restrictions', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      await tx.site.update({
        where: { id: base.site.id },
        data: {
          accessNotes: 'Report to gate B; ask for the duty engineer.',
          address: { line1: '12 Jurong Pier Road', city: 'Singapore', postalCode: '619160' },
        },
      })
      await tx.contact.create({
        data: {
          customerId: base.customer.id,
          siteId: base.site.id,
          name: 'Duty Engineer',
          role: 'SITE_CONTACT',
          phone: '+65 6123 4567',
          isPrimary: true,
        },
      })
      await tx.crane.update({
        where: { id: base.crane.id },
        data: { status: 'RESTRICTED', restrictedReason: 'Brake failed inspection.' },
      })
      const job = await scheduledJob(tx, base)
      await tx.jobCrane.create({ data: { jobId: job.id, craneId: base.crane.id } })

      const pack = await dispatchPack(contextFor(dispatcher), job.id, tx)

      expect(pack.accessNotes).toContain('gate B')
      expect(pack.contact?.name).toBe('Duty Engineer')
      expect(pack.address).toContain('Jurong Pier')
      expect(pack.warnings.join(' ')).toContain('Do Not Operate')
    })
  })

  it('names the missing access notes rather than leaving a blank', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const job = await scheduledJob(tx, base)

      const pack = await dispatchPack(contextFor(dispatcher), job.id, tx)
      expect(pack.warnings.join(' ')).toContain('No access notes')
    })
  })

  it('sends to every technician, records both channels, and moves the job to DISPATCHED', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const first = await makeTechnician(tx, 'First')
      const second = await makeTechnician(tx, 'Second')
      const job = await scheduledJob(tx, base, {
        technicianIds: [first.technician.id, second.technician.id],
      })

      const result = await dispatchJob(contextFor(dispatcher), job.id, tx)

      expect(result.recipients).toHaveLength(4)

      const rows = await tx.notification.findMany({ where: { jobId: job.id } })
      expect(rows).toHaveLength(4)
      expect(rows.filter((row) => row.channel === 'IN_APP')).toHaveLength(2)
      expect(rows.filter((row) => row.channel === 'EMAIL')).toHaveLength(2)
      // No tablet has subscribed in this fixture, and push is unconfigured here — the dispatch is
      // unchanged rather than broken. The subscription path itself is tests/integration/push.test.ts.
      expect(rows.filter((row) => row.channel === 'WEB_PUSH')).toHaveLength(0)

      const after = await tx.job.findUniqueOrThrow({
        where: { id: job.id },
        select: { status: true },
      })
      expect(after.status).toBe('DISPATCHED')

      const history = await tx.jobStatusHistory.findFirst({
        where: { jobId: job.id, toStatus: 'DISPATCHED' },
        select: { fromStatus: true, reason: true },
      })
      expect(history?.fromStatus).toBe('SCHEDULED')
      expect(history?.reason).toContain('First')
    })
  })

  it('refuses to dispatch a job nobody is on', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const job = await scheduledJob(tx, base)

      await expect(dispatchJob(contextFor(dispatcher), job.id, tx)).rejects.toBeInstanceOf(
        RuleError,
      )
    })
  })

  it('refuses to dispatch a job that is not scheduled yet', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)
      const job = await scheduledJob(tx, base, {
        technicianIds: [technician.id],
        status: 'TRIAGED',
      })

      await expect(dispatchJob(contextFor(dispatcher), job.id, tx)).rejects.toBeInstanceOf(
        RuleError,
      )
    })
  })

  it('refuses a role without job.dispatch', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const base = await craneFixtures(tx)
      const job = await scheduledJob(tx, base)

      await expect(dispatchJob(contextFor(storekeeper), job.id, tx)).rejects.toBeInstanceOf(
        ForbiddenError,
      )
    })
  })

  it('does not show a dispatch pack for a job outside the caller’s scope', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const job = await scheduledJob(tx, base)
      await tx.job.update({ where: { id: job.id }, data: { deletedAt: new Date() } })

      await expect(
        dispatchPack(contextFor(dispatcher), job.id, tx),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})

describe('dragging a card on the board', () => {
  it('moves a visit to another day and keeps the wall-clock time', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)
      const timezone = await getSetting('timezone')

      const start = wallTimeToUtc(2026, 10, 26, 8, 0, timezone)
      const end = wallTimeToUtc(2026, 10, 26, 10, 0, timezone)
      const job = await scheduledJob(tx, base, { technicianIds: [technician.id], start, end })

      await moveJobCard(
        contextFor(dispatcher),
        job.id,
        { technicianId: technician.id, day: '2026-10-28' },
        tx,
      )

      const after = await tx.job.findUniqueOrThrow({ where: { id: job.id } })
      const local = zonedParts(after.scheduledStart!, timezone)
      expect({ year: local.year, month: local.month, day: local.day }).toEqual({
        year: 2026,
        month: 10,
        day: 28,
      })
      expect({ hour: local.hour, minute: local.minute }).toEqual({ hour: 8, minute: 0 })

      // Two hours still two hours, so the duration travels with the card.
      expect(after.scheduledEnd!.getTime() - after.scheduledStart!.getTime()).toBe(end.getTime() - start.getTime())
    })
  })

  it('gives an undated job a slot on the day it was dropped', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)
      const timezone = await getSetting('timezone')

      const job = await scheduledJob(tx, base, { technicianIds: [technician.id] })
      await tx.job.update({
        where: { id: job.id },
        data: { scheduledStart: null, scheduledEnd: null },
      })

      await moveJobCard(
        contextFor(dispatcher),
        job.id,
        { technicianId: technician.id, day: '2026-11-02' },
        tx,
      )

      const after = await tx.job.findUniqueOrThrow({ where: { id: job.id } })
      expect(after.scheduledStart).not.toBeNull()
      const local = zonedParts(after.scheduledStart!, timezone)
      expect(local.day).toBe(2)
      expect(local.hour).toBe(8)
    })
  })

  it('takes everybody off when dropped on the unassigned rail', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)
      const job = await scheduledJob(tx, base, { technicianIds: [technician.id] })

      await moveJobCard(contextFor(dispatcher), job.id, { technicianId: 'unassigned' }, tx)

      const crew = await tx.jobTechnician.findMany({ where: { jobId: job.id } })
      expect(crew).toHaveLength(0)
    })
  })

  it('refuses a double-booking without an override, and keeps the date it had', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)

      // Same technician, same wall-clock slot on the 28th. Dragging the 26th visit onto the 28th
      // would put them on two jobs at once.
      const busy = await scheduledJob(tx, base, {
        technicianIds: [technician.id],
        start: new Date('2026-10-28T03:00:00Z'),
        end: new Date('2026-10-28T05:00:00Z'),
      })
      const other = await scheduledJob(tx, base, {
        technicianIds: [technician.id],
        start: new Date('2026-10-26T03:00:00Z'),
        end: new Date('2026-10-26T05:00:00Z'),
      })

      await expect(
        moveJobCard(
          contextFor(dispatcher),
          other.id,
          { technicianId: technician.id, day: '2026-10-28' },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)

      // The refusal is the whole transaction, not just the assignment: the date did not move either.
      const after = await tx.job.findUniqueOrThrow({ where: { id: other.id } })
      expect(after.scheduledStart?.toISOString()).toBe('2026-10-26T03:00:00.000Z')
      expect(busy.id).not.toBe(other.id)
    })
  })

  it('refuses to move a visit that is already being worked', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)
      const job = await scheduledJob(tx, base, { technicianIds: [technician.id] })
      await tx.job.update({ where: { id: job.id }, data: { status: 'IN_PROGRESS' } })

      await expect(
        moveJobCard(contextFor(dispatcher), job.id, { technicianId: technician.id, day: '2026-10-30' }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('refuses a role without job.assign when the drop is onto a person', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const base = await craneFixtures(tx)

      const job = await scheduledJob(tx, base)
      await expect(
        moveJobCard(contextFor(storekeeper), job.id, { technicianId: 'unassigned' }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})
