import type { Prisma, ScheduleSource, ScheduleType } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import {
  createScheduleSchema,
  scheduleFilterSchema,
  updateScheduleSchema,
  type ScheduleFilter,
} from '@/lib/validation/schedules'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { craneReadWhere, craneScheduleReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { getSettings } from '@/server/settings/settings'
import { formatDate } from '@/lib/format'
import { daysUntil, dueBucket, isOverdue, recomputeNextDue, type DueBucket } from './recurrence'

/**
 * Recurring obligations for a crane (brief §8, slice 12).
 *
 * One service behind every screen: the crane page's next-due block, the `/schedules` list and the
 * dashboard tile all read through `listSchedules`, so a tile cannot say "three overdue" while the list
 * it links to shows two. That was the slice-10 lesson, and it is the reason this file has no queries
 * outside these functions.
 *
 * **This file knows nothing about job types.** Which job completes which obligation is a
 * `ComplianceRule` question (slice 14) — inventing a code-side mapping here would be a regulatory fact
 * in code, which report rule 2 forbids. Marking a schedule done is therefore an explicit choice made
 * on the completed job, not something inferred from its type.
 */

export interface ScheduleSummary {
  id: string
  scheduleType: ScheduleType
  intervalMonths: number | null
  lastDoneDate: Date | null
  nextDueDate: Date | null
  source: ScheduleSource
  reminderOffsetsDays: number[]
  autoCreateDraftJob: boolean
  notes: string | null
  dueBucket: DueBucket
  overdue: boolean
  crane: {
    id: string
    assetTag: string
    status: string
    siteName: string
    customerName: string
  }
}

const scheduleSelect = {
  id: true,
  scheduleType: true,
  intervalMonths: true,
  lastDoneDate: true,
  nextDueDate: true,
  source: true,
  reminderOffsetsDays: true,
  autoCreateDraftJob: true,
  notes: true,
  crane: {
    select: {
      id: true,
      assetTag: true,
      status: true,
      site: { select: { name: true, customer: { select: { legalName: true } } } },
    },
  },
} satisfies Prisma.CraneScheduleSelect

type ScheduleRow = Prisma.CraneScheduleGetPayload<{ select: typeof scheduleSelect }>

function toSummary(row: ScheduleRow, now: Date): ScheduleSummary {
  return {
    id: row.id,
    scheduleType: row.scheduleType,
    intervalMonths: row.intervalMonths,
    lastDoneDate: row.lastDoneDate,
    nextDueDate: row.nextDueDate,
    source: row.source,
    reminderOffsetsDays: row.reminderOffsetsDays,
    autoCreateDraftJob: row.autoCreateDraftJob,
    notes: row.notes,
    dueBucket: dueBucket(row.nextDueDate, now),
    overdue: isOverdue(row, now),
    crane: {
      id: row.crane.id,
      assetTag: row.crane.assetTag,
      status: row.crane.status,
      siteName: row.crane.site.name,
      customerName: row.crane.site.customer.legalName,
    },
  }
}

/**
 * The buckets the list filters on. `overdue` is the only one that is not a forward window, and it is
 * the one the morning largely exists for, so it sorts first.
 */
const BUCKET_ORDER: readonly DueBucket[] = ['overdue', '30', '60', '90', 'later', 'none']

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Every schedule the caller may see, soonest due first.
 *
 * Sorting and bucketing happen in JavaScript rather than SQL for the same reason the SLA filter does
 * (ASSUMPTIONS 75): "overdue" is a function of the clock, and a SQL predicate would be a second
 * implementation of `dueBucket` waiting to disagree with the first.
 */
export async function listSchedules(
  context: AuthContext,
  rawFilters: unknown = {},
  client: Tx = db,
  now: Date = new Date(),
): Promise<ScheduleSummary[]> {
  assertCan(context, 'crane.read')
  const filters = parseInput(scheduleFilterSchema, rawFilters) as ScheduleFilter

  const where: Prisma.CraneScheduleWhereInput = {
    ...craneScheduleReadWhere(context),
    ...(filters.scheduleType ? { scheduleType: filters.scheduleType } : {}),
    // The search is `AND`-ed onto the crane's own scope, never spread beside it: `craneReadWhere`
    // already uses `OR` for a technician's cranes, and a second `OR` on the same object would replace
    // it — searching for another customer's asset tag would then return it.
    ...(filters.q
      ? {
          crane: {
            AND: [
              craneReadWhere(context),
              {
                OR: [
                  { assetTag: { contains: filters.q, mode: 'insensitive' } },
                  { site: { name: { contains: filters.q, mode: 'insensitive' } } },
                  {
                    site: {
                      customer: { legalName: { contains: filters.q, mode: 'insensitive' } },
                    },
                  },
                ],
              },
            ],
            deletedAt: null,
          },
        }
      : {}),
  }

  const rows = await client.craneSchedule.findMany({ where, select: scheduleSelect, take: 2000 })
  const summaries = rows.map((row) => toSummary(row, now))

  const filtered = filters.due ? summaries.filter((row) => row.dueBucket === filters.due) : summaries

  // Overdue first, then soonest; undated last, because they are unconfigured rather than urgent.
  return filtered.sort((a, b) => {
    const aAt = a.nextDueDate?.getTime() ?? Number.POSITIVE_INFINITY
    const bAt = b.nextDueDate?.getTime() ?? Number.POSITIVE_INFINITY
    if (aAt !== bAt) return aAt - bAt
    return a.crane.assetTag.localeCompare(b.crane.assetTag)
  })
}

/** The schedules on one crane — the crane page's next-due block. */
export async function schedulesForCrane(
  context: AuthContext,
  craneId: string,
  client: Tx = db,
  now: Date = new Date(),
): Promise<ScheduleSummary[]> {
  assertCan(context, 'crane.read')
  const rows = await client.craneSchedule.findMany({
    where: { craneId, ...craneScheduleReadWhere(context) },
    select: scheduleSelect,
    orderBy: [{ nextDueDate: 'asc' }, { scheduleType: 'asc' }],
  })
  return rows.map((row) => toSummary(row, now))
}

export interface ScheduleCounts {
  overdue: number
  /** Due in the next 30 days, excluding anything already overdue. */
  dueWithin30Days: number
}

/**
 * The dashboard tile's numbers, from the same rows the list reads. Deliberately returns the counts the
 * dashboard shows rather than a single number: "three overdue" is the fact worth acting on, and a tile
 * that quietly folds it into "due in the next 30 days" buries it.
 */
export async function scheduleCounts(
  context: AuthContext,
  client: Tx = db,
  now: Date = new Date(),
): Promise<ScheduleCounts> {
  assertCan(context, 'crane.read')
  const rows = await client.craneSchedule.findMany({
    where: { ...craneScheduleReadWhere(context), nextDueDate: { not: null } },
    select: { nextDueDate: true },
  })

  let overdue = 0
  let dueWithin30Days = 0
  for (const row of rows) {
    const bucket = dueBucket(row.nextDueDate, now)
    if (bucket === 'overdue') overdue += 1
    else if (bucket === '30') dueWithin30Days += 1
  }
  return { overdue, dueWithin30Days }
}

/** For the job completion form: the schedules on the cranes this job touched. */
export async function schedulesForJobCranes(
  context: AuthContext,
  jobId: string,
  client: Tx = db,
  now: Date = new Date(),
): Promise<ScheduleSummary[]> {
  assertCan(context, 'crane.read')
  const rows = await client.craneSchedule.findMany({
    where: {
      ...craneScheduleReadWhere(context),
      crane: { ...craneReadWhere(context), deletedAt: null, jobs: { some: { jobId } } },
    },
    select: scheduleSelect,
  })
  return rows
    .map((row) => toSummary(row, now))
    .sort((a, b) => BUCKET_ORDER.indexOf(a.dueBucket) - BUCKET_ORDER.indexOf(b.dueBucket))
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createSchedule(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<ScheduleSummary> {
  assertCan(context, 'schedule.manage')
  const input = parseInput(createScheduleSchema, raw)

  const created = await withAudit(
    context,
    async (tx, log) => {
      const crane = await tx.crane.findFirst({
        where: { id: input.craneId, ...craneReadWhere(context) },
        select: { id: true, assetTag: true },
      })
      if (!crane) throw new NotFoundError('No such crane.')

      // `deletedAt: null` matters: an archived obligation must not block the same kind being raised
      // again later, which is the whole reason archiving is a soft delete.
      const clash = await tx.craneSchedule.findFirst({
        where: { craneId: crane.id, scheduleType: input.scheduleType, deletedAt: null },
        select: { id: true },
      })
      if (clash) {
        throw new RuleError(
          `${crane.assetTag} already has a schedule of that kind. Edit the one that exists rather than adding a second — two answers to "when is it next due" is how a crane gets missed.`,
        )
      }

      const nextDueDate = recomputeNextDue({
        intervalMonths: input.intervalMonths,
        lastDoneDate: input.lastDoneDate,
        nextDueDate: input.nextDueDate,
      })

      const row = await tx.craneSchedule.create({
        data: {
          craneId: crane.id,
          scheduleType: input.scheduleType,
          intervalMonths: input.intervalMonths,
          lastDoneDate: input.lastDoneDate,
          nextDueDate,
          reminderOffsetsDays: input.reminderOffsets.length
            ? input.reminderOffsets
            : (await defaultReminderOffsets(tx)),
          autoCreateDraftJob: input.autoCreateDraftJob,
          notes: input.notes,
        },
        select: scheduleSelect,
      })

      await log({ entity: 'CraneSchedule', entityId: row.id, action: 'CREATE', after: auditShape(row) })
      return row
    },
    client,
  )

  return toSummary(created, new Date())
}

export async function updateSchedule(
  context: AuthContext,
  scheduleId: string,
  raw: unknown,
  client: Tx = db,
): Promise<ScheduleSummary> {
  assertCan(context, 'schedule.manage')
  const input = parseInput(updateScheduleSchema, raw)

  const updated = await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.craneSchedule.findFirst({
        where: { id: scheduleId, ...craneScheduleReadWhere(context) },
        select: { ...scheduleSelect, craneId: true },
      })
      if (!before) throw new NotFoundError('No such schedule.')

      const nextDueDate = recomputeNextDue({
        intervalMonths: input.intervalMonths,
        lastDoneDate: input.lastDoneDate,
        nextDueDate: input.nextDueDate,
      })

      const row = await tx.craneSchedule.update({
        where: { id: scheduleId },
        data: {
          scheduleType: input.scheduleType,
          intervalMonths: input.intervalMonths,
          lastDoneDate: input.lastDoneDate,
          nextDueDate,
          reminderOffsetsDays: input.reminderOffsets.length
            ? input.reminderOffsets
            : before.reminderOffsetsDays,
          autoCreateDraftJob: input.autoCreateDraftJob,
          notes: input.notes,
        },
        select: scheduleSelect,
      })

      await log({
        entity: 'CraneSchedule',
        entityId: scheduleId,
        action: 'UPDATE',
        before: auditShape(before),
        after: auditShape(row),
      })
      return row
    },
    client,
  )

  return toSummary(updated, new Date())
}

/**
 * Ends a recurring obligation. Soft-deleted like everything else (CLAUDE.md rule 4): the row stays so
 * a past reminder or job can still say what was due and when, and the audit log keeps who ended it.
 */
export async function archiveSchedule(
  context: AuthContext,
  scheduleId: string,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'schedule.manage')

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.craneSchedule.findFirst({
        where: { id: scheduleId, ...craneScheduleReadWhere(context) },
        select: scheduleSelect,
      })
      if (!before) throw new NotFoundError('No such schedule.')

      await tx.craneSchedule.update({ where: { id: scheduleId }, data: { deletedAt: new Date() } })
      await log({
        entity: 'CraneSchedule',
        entityId: scheduleId,
        action: 'DELETE',
        before: auditShape(before),
      })
    },
    client,
  )
}

export interface MarkScheduleDoneInput {
  /** The job that completed the work — the date recorded is that job's completion, not "now". */
  jobId: string
  scheduleIds: readonly string[]
}

/**
 * Records that the work behind one or more schedules was done (PLAN §7.3 decision 2).
 *
 * Called inside the job-completion transaction, so the status change and the rolled-forward due dates
 * commit together — a completion that saved the job but lost the schedule would leave the obligation
 * looking overdue and prompt somebody to do the visit twice.
 *
 * The date recorded is the job's `completedAt`, never the wall clock: a report signed on Friday and
 * moved to Completed on Monday was still done on Friday.
 */
export async function markSchedulesDone(
  context: AuthContext,
  input: MarkScheduleDoneInput,
  client: Tx,
): Promise<ScheduleSummary[]> {
  assertCan(context, 'schedule.manage')
  if (input.scheduleIds.length === 0) return []

  const job = await client.job.findFirst({
    where: { id: input.jobId },
    select: { id: true, number: true, completedAt: true, cranes: { select: { craneId: true } } },
  })
  if (!job) throw new NotFoundError('No such job.')

  const completedAt = job.completedAt ?? new Date()
  const craneIds = new Set(job.cranes.map((row) => row.craneId))

  return withAudit(
    context,
    async (tx, log) => {
      const rows = await tx.craneSchedule.findMany({
        where: { id: { in: [...input.scheduleIds] }, ...craneScheduleReadWhere(context) },
        select: { ...scheduleSelect, craneId: true },
      })

      const done: ScheduleRow[] = []
      for (const before of rows) {
        // The checkbox is on a job's own cranes; a request naming any other crane is refused rather
        // than silently skipped, because it means the form and the ledger disagree about the job.
        if (!craneIds.has(before.craneId)) {
          throw new RuleError(
            `Schedule for ${before.crane.assetTag} is not on job ${job.number}'s cranes.`,
          )
        }

        const nextDueDate = recomputeNextDue({
          intervalMonths: before.intervalMonths,
          lastDoneDate: completedAt,
          nextDueDate: before.nextDueDate,
        })

        const row = await tx.craneSchedule.update({
          where: { id: before.id },
          data: { lastDoneDate: completedAt, nextDueDate },
          select: scheduleSelect,
        })
        // `viaJob` on the after side only: `changedFields` drops a key that is identical on both
        // sides, and the log is useless if it cannot say which visit rolled this forward.
        await log({
          entity: 'CraneSchedule',
          entityId: before.id,
          action: 'UPDATE',
          before: auditShape(before),
          after: { ...auditShape(row), viaJob: job.number },
        })
        done.push(row)
      }

      return done
    },
    client,
  ).then((rows) => rows.map((row) => toSummary(row, new Date())))
}

/**
 * "Due 15/11/2026 (12 days overdue)" for the completion checkboxes.
 *
 * Lives here rather than in the component because the phrase is about a schedule, and it appears on
 * more than one screen — the same helper both keeps them identical and keeps the two date formatters
 * (a calendar day here, a timestamp in the audit log) from getting swapped.
 */
export function dueLabelFor(schedule: ScheduleSummary, timezone: string): string {
  const days = daysUntil(schedule.nextDueDate)
  if (days === null) return 'no date set'
  if (days < 0) return `due ${formatDate(schedule.nextDueDate, timezone)}, ${Math.abs(days)} days overdue`
  if (days === 0) return `due today (${formatDate(schedule.nextDueDate, timezone)})`
  return `due ${formatDate(schedule.nextDueDate, timezone)}, in ${days} days`
}

/** The office's configured default, so a schedule left blank follows the same offsets as the setting. */
async function defaultReminderOffsets(tx: Tx): Promise<number[]> {
  return (await getSettings(tx)).reminderOffsetsDays
}

/**
 * The columns an audit row records. The relation is flattened to the asset tag: an id in the log is
 * unreadable, and the crane can be gone by the time somebody reads it.
 */
function auditShape(row: ScheduleRow): Record<string, unknown> {
  return {
    crane: row.crane.assetTag,
    scheduleType: row.scheduleType,
    intervalMonths: row.intervalMonths,
    lastDoneDate: row.lastDoneDate,
    nextDueDate: row.nextDueDate,
    reminderOffsetsDays: row.reminderOffsetsDays,
    autoCreateDraftJob: row.autoCreateDraftJob,
    notes: row.notes,
  }
}
