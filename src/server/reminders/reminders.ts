import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { env } from '@/lib/env'
import { formatDate } from '@/lib/format'
import { errorMessage, logger } from '@/lib/logger'
import { dayKey } from '@/lib/time'
import { withAudit } from '@/server/audit/audit'
import { createSystemJob } from '@/server/jobs/jobs'
import { notifyOfficeOfReminder } from '@/server/notify/notify'
import { daysUntil } from '@/server/schedules/recurrence'
import { SCHEDULE_TYPE_LABELS } from '@/lib/validation/schedules'
import { getSettings } from '@/server/settings/settings'

/**
 * The daily reminder scan (brief §8, slice 15).
 *
 * Every live `CraneSchedule` with a due date is evaluated at its own `reminderOffsetsDays` (default
 * 90/60/30), then once when it is overdue. The office is told through the same `notify` fan-out a P1
 * uses; a schedule marked `autoCreateDraftJob` additionally raises a NEW job in the kind of work the
 * office chose on the schedule.
 *
 * **At most once per (schedule, threshold, period).** `ReminderDispatch` is the claim: the unique key
 * makes a retried or twice-run cron a no-op instead of a second email. `period` is the due date the
 * reminder was about, so a schedule that has been done and rolled forward starts a fresh period.
 *
 * Two deliberate limits, both visible in the code rather than discovered later:
 * - a reminder that fires only because the scan missed a threshold (a cron outage from 90 to 25 days)
 *   fires at the threshold still open (30), not once for each one skipped;
 * - "overdue" fires once per period, not daily. The dashboard's overdue count is the ongoing signal;
 *   daily email about a service nobody has booked is how a reminder list gets filtered into a folder.
 */

export interface ReminderRunResult {
  evaluated: number
  reminded: number
  draftJobs: number
}

export interface ScheduleReminderRow {
  id: string
  scheduleType: keyof typeof SCHEDULE_TYPE_LABELS
  nextDueDate: Date
  reminderOffsetsDays: number[]
  autoCreateDraftJob: boolean
  draftJobTypeId: string | null
  notes: string | null
  crane: {
    id: string
    assetTag: string
    status: string
    customerId: string
    siteId: string
    site: { name: string; customer: { legalName: string } }
  }
}

/**
 * Which threshold a schedule should be reminded at today, or null when it is still some way off.
 *
 * The smallest offset the due date has reached wins, so going from 85 to 65 days out moves the
 * reminder from 90 to 60 rather than staying on 90. Pure, so the boundaries are unit-tested.
 */
export function reminderOffsetFor(days: number | null, offsets: readonly number[]): string | null {
  if (days === null) return null
  if (days < 0) return 'overdue'
  const sorted = [...new Set(offsets)].sort((a, b) => a - b)
  const reached = sorted.find((offset) => days <= offset)
  return reached === undefined ? null : String(reached)
}

export async function runScheduleReminders(
  now: Date = new Date(),
  client: Tx = db,
): Promise<ReminderRunResult> {
  const { timezone } = await getSettings(client)

  // A decommissioned or archived crane has no obligations left to say anything about.
  const schedules = await client.craneSchedule.findMany({
    where: {
      deletedAt: null,
      nextDueDate: { not: null },
      crane: { deletedAt: null, status: { not: 'DECOMMISSIONED' } },
    },
    select: reminderScheduleSelect,
  })

  let reminded = 0
  let draftJobs = 0

  for (const schedule of schedules as ScheduleReminderRow[]) {
    try {
      const outcome = await remindForSchedule(client, schedule, now, timezone)
      if (outcome.reminded) reminded += 1
      if (outcome.draftJob) draftJobs += 1
    } catch (error) {
      // One bad schedule must not stop the scan for every other crane; the next run retries it,
      // because a failed attempt leaves no claim behind.
      logger.error('reminders.schedule.failed', {
        scheduleId: schedule.id,
        error: errorMessage(error),
      })
    }
  }

  return { evaluated: schedules.length, reminded, draftJobs }
}

/**
 * Evaluates one schedule. Exported so the integration suite can drive a single row through the same
 * code the cron runs, instead of scanning the whole database.
 */
export async function remindForSchedule(
  client: Tx,
  schedule: ScheduleReminderRow,
  now: Date,
  timezone: string,
): Promise<{ reminded: boolean; draftJob: boolean }> {
  const days = daysUntil(schedule.nextDueDate, now)
  const offset = reminderOffsetFor(days, schedule.reminderOffsetsDays)
  if (offset === null || days === null) return { reminded: false, draftJob: false }

  const period = dayKey(schedule.nextDueDate, timezone)
  const outcome = { reminded: false, draftJob: false }

  if (await claim(client, schedule.id, offset, period)) {
    await notifyOfficeOfReminder(client, reminderMessage(schedule, days, offset, timezone))
    outcome.reminded = true
  }

  // A job is raised when the work is actually due, not three months ahead: a NEW job appearing in
  // the list ninety days early is noise, and nobody schedules from it.
  if (schedule.autoCreateDraftJob && days <= 0) {
    outcome.draftJob = await raiseDraftJob(client, schedule, days, period, timezone, now)
  }

  return outcome
}

/**
 * Claiming the dispatch row is what makes the run idempotent: the unique index refuses the second one.
 *
 * `ON CONFLICT DO NOTHING` rather than create-and-catch-P2002 because a failed statement inside a
 * transaction aborts it on Postgres, and this scan is meant to be callable inside one (the draft job
 * and its claim commit together). The row count says whether this run owns the reminder.
 */
async function claim(
  client: Tx,
  scheduleId: string,
  offset: string,
  period: string,
): Promise<boolean> {
  const inserted = await client.$executeRaw`
    INSERT INTO "ReminderDispatch" ("id", "scheduleId", "offset", "period")
    VALUES (${randomUUID()}, ${scheduleId}, ${offset}, ${period})
    ON CONFLICT ("scheduleId", "offset", "period") DO NOTHING
  `
  return inserted === 1
}

async function raiseDraftJob(
  client: Tx,
  schedule: ScheduleReminderRow,
  days: number,
  period: string,
  timezone: string,
  now: Date,
): Promise<boolean> {
  const draftJobTypeId = schedule.draftJobTypeId
  if (!draftJobTypeId) {
    logger.warn('reminders.draftJob.noJobType', { scheduleId: schedule.id })
    return false
  }

  const jobType = await client.jobType.findFirst({
    where: { id: draftJobTypeId, isActive: true },
    select: { defaultPriority: true, name: true },
  })
  if (!jobType) {
    logger.warn('reminders.draftJob.jobTypeUnavailable', {
      scheduleId: schedule.id,
      jobTypeId: draftJobTypeId,
    })
    return false
  }

  if (!(await claim(client, schedule.id, 'draft-job', period))) return false

  const label = SCHEDULE_TYPE_LABELS[schedule.scheduleType]
  const due = formatDate(schedule.nextDueDate, timezone)
  const crane = schedule.crane
  const description = [
    `${label} for crane ${crane.assetTag} (${crane.site.customer.legalName}, ${crane.site.name}).`,
    days < 0 ? `Was due ${due}.` : `Due ${due}.`,
    'Raised automatically from the crane schedule.',
    schedule.notes ? `Schedule notes: ${schedule.notes}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  await withAudit(
    {},
    async (tx, log) => {
      const job = await createSystemJob(tx, {
        jobTypeId: draftJobTypeId,
        customerId: crane.customerId,
        siteId: crane.siteId,
        craneId: crane.id,
        priority: jobType.defaultPriority,
        description,
        reportedAt: now,
      })
      await log({
        entity: 'Job',
        entityId: job.id,
        action: 'CREATE',
        after: {
          number: job.number,
          scheduleId: schedule.id,
          scheduleType: schedule.scheduleType,
          crane: crane.assetTag,
          jobType: jobType.name,
          priority: jobType.defaultPriority,
        },
      })
    },
    client,
  )

  return true
}

function reminderMessage(
  schedule: ScheduleReminderRow,
  days: number,
  offset: string,
  timezone: string,
): { title: string; body: string; link: string } {
  const label = SCHEDULE_TYPE_LABELS[schedule.scheduleType]
  const crane = schedule.crane
  const due = formatDate(schedule.nextDueDate, timezone)
  const link = `/cranes/${crane.id}`

  const when =
    days < 0
      ? `was due ${due} and is ${Math.abs(days)} day(s) overdue`
      : days === 0
        ? `is due today (${due})`
        : `is due ${due}, in ${days} day(s)`

  return {
    title:
      offset === 'overdue'
        ? `Overdue: ${label} — ${crane.assetTag}`
        : `${label} due — ${crane.assetTag}`,
    body: [
      `${crane.site.customer.legalName} · ${crane.site.name}`,
      '',
      `${label} on crane ${crane.assetTag} ${when}.`,
      '',
      `Open it: ${env().APP_BASE_URL.replace(/\/$/, '')}${link}`,
    ].join('\n'),
    link,
  }
}

/** The row shape `remindForSchedule` takes. Exported so a test can drive one schedule directly. */
export const reminderScheduleSelect = {
  id: true,
  scheduleType: true,
  nextDueDate: true,
  reminderOffsetsDays: true,
  autoCreateDraftJob: true,
  draftJobTypeId: true,
  notes: true,
  crane: {
    select: {
      id: true,
      assetTag: true,
      status: true,
      customerId: true,
      siteId: true,
      site: { select: { name: true, customer: { select: { legalName: true } } } },
    },
  },
} satisfies Prisma.CraneScheduleSelect
