import { describe, expect, it } from 'vitest'
import {
  reminderOffsetFor,
  reminderScheduleSelect,
  remindForSchedule,
  type ScheduleReminderRow,
} from '@/server/reminders/reminders'
import { craneFixtures, inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * The daily reminder scan against the real database (slice 15).
 *
 * The unit test pins which offset a due date has reached. What a database is needed for is the claim:
 * a re-run must not email the office twice, a schedule that has been rolled forward must be able to
 * remind again, and a draft job must be raised once — not once per cron run.
 *
 * Runs inside a transaction that always rolls back. The fan-out writes notifications for every live
 * dispatcher, including the demo ones, and the email adapter under test is the console one, so nothing
 * leaves the machine and no row survives.
 */

const TZ = 'Asia/Singapore'

function dayFromToday(days: number): Date {
  const now = new Date()
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return new Date(day + days * 86_400_000)
}

async function makeSchedule(
  tx: Tx,
  options: { dueInDays: number; autoCreateDraftJob?: boolean; draftJobTypeId?: string | null },
) {
  const fixtures = await craneFixtures(tx)
  const schedule = await tx.craneSchedule.create({
    data: {
      craneId: fixtures.crane.id,
      scheduleType: 'MONTHLY_SERVICE',
      intervalMonths: 1,
      nextDueDate: dayFromToday(options.dueInDays),
      reminderOffsetsDays: [90, 60, 30],
      autoCreateDraftJob: options.autoCreateDraftJob ?? false,
      draftJobTypeId: options.draftJobTypeId ?? null,
    },
  })
  const row = await tx.craneSchedule.findUniqueOrThrow({
    where: { id: schedule.id },
    select: reminderScheduleSelect,
  })
  return { ...fixtures, schedule, row: row as ScheduleReminderRow }
}

describe('schedule reminders', () => {
  it('reminds once per threshold and due date, however often the scan runs', async () => {
    await inRolledBackTx(async (tx) => {
      const { schedule, row } = await makeSchedule(tx, { dueInDays: 45 })
      const now = new Date()

      const first = await remindForSchedule(tx, row, now, TZ)
      const second = await remindForSchedule(tx, row, now, TZ)

      expect(first).toEqual({ reminded: true, draftJob: false })
      expect(second).toEqual({ reminded: false, draftJob: false })

      const claims = await tx.reminderDispatch.findMany({
        where: { scheduleId: schedule.id },
        select: { offset: true, period: true },
      })
      expect(claims).toHaveLength(1)
      expect(claims[0]?.offset).toBe('60')
    })
  })

  it('reminds again at the next threshold, and once when it is overdue', async () => {
    await inRolledBackTx(async (tx) => {
      const { schedule, row } = await makeSchedule(tx, { dueInDays: 45 })

      // 45 days out: the 60-day threshold. Three weeks later: the 30-day one.
      expect((await remindForSchedule(tx, row, new Date(), TZ)).reminded).toBe(true)
      expect((await remindForSchedule(tx, row, dayFromToday(20), TZ)).reminded).toBe(true)
      // Two days past the due date: overdue, once.
      expect((await remindForSchedule(tx, row, dayFromToday(47), TZ)).reminded).toBe(true)
      expect((await remindForSchedule(tx, row, dayFromToday(48), TZ)).reminded).toBe(false)

      const offsets = await tx.reminderDispatch.findMany({
        where: { scheduleId: schedule.id },
        orderBy: { createdAt: 'asc' },
        select: { offset: true },
      })
      expect(offsets.map((row) => row.offset)).toEqual(['60', '30', 'overdue'])
    })
  })

  it('says nothing while every offset is still ahead of the due date', async () => {
    await inRolledBackTx(async (tx) => {
      const { schedule, row } = await makeSchedule(tx, { dueInDays: 200 })

      expect((await remindForSchedule(tx, row, new Date(), TZ)).reminded).toBe(false)
      expect(await tx.reminderDispatch.count({ where: { scheduleId: schedule.id } })).toBe(0)
      expect(reminderOffsetFor(200, [90, 60, 30])).toBeNull()
    })
  })

  it('raises a draft job once when a due schedule asks for one, audited', async () => {
    await inRolledBackTx(async (tx) => {
      const jobType = await tx.jobType.create({
        data: {
          code: `DUE_${testSuffix()}`,
          name: 'Scheduled service',
          defaultPriority: 'P3',
        },
      })
      const { schedule, row, crane, site, customer } = await makeSchedule(tx, {
        dueInDays: 0,
        autoCreateDraftJob: true,
        draftJobTypeId: jobType.id,
      })
      const now = new Date()

      expect(await remindForSchedule(tx, row, now, TZ)).toEqual({
        reminded: true,
        draftJob: true,
      })
      // A second run the same day claims nothing, so no second job.
      expect(await remindForSchedule(tx, row, now, TZ)).toEqual({
        reminded: false,
        draftJob: false,
      })

      const jobs = await tx.job.findMany({
        where: { jobTypeId: jobType.id },
        select: {
          id: true,
          status: true,
          priority: true,
          customerId: true,
          siteId: true,
          createdById: true,
          cranes: { select: { craneId: true } },
        },
      })
      expect(jobs).toHaveLength(1)
      expect(jobs[0]).toMatchObject({
        status: 'NEW',
        priority: 'P3',
        customerId: customer.id,
        siteId: site.id,
        createdById: null,
      })
      expect(jobs[0]?.cranes.map((entry) => entry.craneId)).toEqual([crane.id])

      const audit = await tx.auditLog.findMany({
        where: { entity: 'Job', entityId: jobs[0]?.id },
        select: { action: true, after: true },
      })
      expect(audit).toHaveLength(1)
      expect(audit[0]?.action).toBe('CREATE')
      expect(audit[0]?.after).toMatchObject({ scheduleId: schedule.id, crane: crane.assetTag })
    })
  })

  it('does not raise a job before the due date', async () => {
    await inRolledBackTx(async (tx) => {
      const jobType = await tx.jobType.create({
        data: { code: `EARLY_${testSuffix()}`, name: 'Scheduled service' },
      })
      const { row } = await makeSchedule(tx, {
        dueInDays: 45,
        autoCreateDraftJob: true,
        draftJobTypeId: jobType.id,
      })

      expect((await remindForSchedule(tx, row, new Date(), TZ)).draftJob).toBe(false)
      expect(await tx.job.count({ where: { jobTypeId: jobType.id } })).toBe(0)
    })
  })

  it('reminds but raises no job when the chosen job type is no longer active', async () => {
    await inRolledBackTx(async (tx) => {
      const jobType = await tx.jobType.create({
        data: { code: `GONE_${testSuffix()}`, name: 'Retired service', isActive: false },
      })
      const { row } = await makeSchedule(tx, {
        dueInDays: 0,
        autoCreateDraftJob: true,
        draftJobTypeId: jobType.id,
      })

      expect(await remindForSchedule(tx, row, new Date(), TZ)).toEqual({
        reminded: true,
        draftJob: false,
      })
    })
  })
})
