import type { JobStatus, OnHoldReason, Prisma } from '@prisma/client'
import { cache } from 'react'
import { db, type Tx } from '@/lib/db'
import { addDays, wallTimeToUtc } from '@/lib/time'
import { parseInput } from '@/lib/validation/parse'
import {
  convertTicketSchema,
  createJobSchema,
  jobFilterSchema,
  transitionJobSchema,
  updateJobSchema,
  type CreateJobInput,
  type JobFilter,
  type JobSort,
} from '@/lib/validation/jobs'
import { withAudit } from '@/server/audit/audit'
import { markSchedulesDone } from '@/server/schedules/schedules'
import { NotFoundError, RuleError, ValidationError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import {
  craneReadWhere,
  customerReadWhere,
  jobReadWhere,
  siteReadWhere,
  ticketReadWhere,
} from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { nextDocumentNumber } from '@/server/documents/sequence'
import { notifyDispatchersOfJobP1 } from '@/server/notify/notify'
import { getSettings } from '@/server/settings/settings'
import { addMinutes, resolveSlaTargets, slaState, type SlaResult } from '@/server/sla/sla'
import { canTransition, timestampFieldFor } from './status'

/**
 * Jobs: the work itself (brief §4.2).
 *
 * A job is created either straight from the office or from a triaged ticket, and then moves through
 * the lifecycle in `status.ts`. This service owns three things that must not be duplicated elsewhere:
 *
 *   - **Creation resolves the location.** The same customer → site → crane rules as tickets: a job
 *     cannot be raised against another customer's crane, and the crane's site is the truth.
 *   - **SLA deadlines are snapshotted at creation.** `slaResponseDue` / `slaResolveDue` are written
 *     once, so editing an SLA policy next month cannot rewrite whether a job met its target.
 *   - **Every status change writes a history row.** `JobStatusHistory` is the record the brief asks
 *     for (§ rule 7): who moved it, from what, to what, when, and why.
 */

export interface JobTicketRef {
  id: string
  number: string
}

export interface JobTypeRef {
  id: string
  code: string
  name: string
}

export interface JobSla {
  response: SlaResult
  resolution: SlaResult
}

export interface JobSummary {
  id: string
  number: string
  status: JobStatus
  priority: 'P1' | 'P2' | 'P3' | 'P4'
  onHoldReason: OnHoldReason | null
  onHoldNote: string | null
  /** The part an `AWAITING_PARTS` hold waits for (slice 28). Null for every other hold. */
  onHoldPart: { id: string; partNumber: string; description: string; uom: string } | null
  customerPoRef: string | null
  jobType: JobTypeRef
  customer: { id: string; legalName: string; tradingName: string | null }
  site: { id: string; name: string } | null
  cranes: Array<{ id: string; assetTag: string; status: string }>
  ticket: JobTicketRef | null
  scheduledStart: Date | null
  scheduledEnd: Date | null
  reportedAt: Date | null
  respondedAt: Date | null
  completedAt: Date | null
  closedAt: Date | null
  sla: JobSla
}

export interface JobHistoryEntry {
  id: string
  fromStatus: JobStatus | null
  toStatus: JobStatus
  reason: string | null
  onHoldReason: OnHoldReason | null
  changedById: string | null
  changedByName: string | null
  changedAt: Date
}

export interface JobDetail extends JobSummary {
  description: string | null
  internalNotes: string | null
  createdAt: Date
  updatedAt: Date
  createdById: string | null
  history: JobHistoryEntry[]
  /** The job whose finding raised this one (slice 16). */
  parentJob: { id: string; number: string } | null
  /** Jobs raised from findings on this one. */
  followUps: Array<{ id: string; number: string; status: JobStatus }>
}

const jobSelect = {
  id: true,
  number: true,
  status: true,
  priority: true,
  onHoldReason: true,
  onHoldNote: true,
  onHoldPartId: true,
  onHoldPart: { select: { id: true, partNumber: true, description: true, uom: true } },
  description: true,
  internalNotes: true,
  customerPoRef: true,
  scheduledStart: true,
  scheduledEnd: true,
  slaResponseDue: true,
  slaResolveDue: true,
  reportedAt: true,
  respondedAt: true,
  completedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  jobType: { select: { id: true, code: true, name: true } },
  customer: { select: { id: true, legalName: true, tradingName: true } },
  site: { select: { id: true, name: true } },
  cranes: {
    select: { crane: { select: { id: true, assetTag: true, status: true } } },
    orderBy: { crane: { assetTag: 'asc' } },
  },
  ticket: { select: { id: true, number: true } },
} satisfies Prisma.JobSelect

/** The two follow-up links, read only where the job's own page needs them — never in a list. */
const followUpSelect = {
  parentJob: { select: { id: true, number: true } },
  followUps: { select: { id: true, number: true, status: true }, orderBy: { number: 'asc' } },
} satisfies Prisma.JobSelect

type JobRow = Prisma.JobGetPayload<{ select: typeof jobSelect }>

/**
 * SLA state from the snapshotted deadlines rather than from today's policy. `startedAt` is the due
 * date minus the target, which is how the job was priced when it was created.
 */
export function jobSla(
  row: {
    reportedAt: Date | null
    respondedAt: Date | null
    completedAt: Date | null
    closedAt: Date | null
    slaResponseDue: Date | null
    slaResolveDue: Date | null
  },
  now: Date,
): JobSla {
  const window = (due: Date | null, metAt: Date | null): SlaResult => {
    if (!due) return { dueAt: null, state: 'on-time', remainingMs: null, elapsedMs: null }
    const startedAt = row.reportedAt
    const targetMinutes = startedAt
      ? Math.max(0, Math.round((due.getTime() - startedAt.getTime()) / 60_000))
      : 0
    return slaState({ startedAt, targetMinutes, metAt }, now)
  }

  return {
    response: window(row.slaResponseDue, row.respondedAt),
    // Resolution is met when the work is finished, not when it is invoiced: the customer's window is
    // about the crane being usable again.
    resolution: window(row.slaResolveDue, row.completedAt ?? row.closedAt),
  }
}

function toSummary(row: JobRow, now: Date): JobSummary {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    priority: row.priority,
    onHoldReason: row.onHoldReason,
    onHoldNote: row.onHoldNote,
    onHoldPart: row.onHoldPart,
    customerPoRef: row.customerPoRef,
    jobType: row.jobType,
    customer: row.customer,
    site: row.site,
    cranes: row.cranes.map(({ crane }) => crane),
    ticket: row.ticket,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    reportedAt: row.reportedAt,
    respondedAt: row.respondedAt,
    completedAt: row.completedAt,
    closedAt: row.closedAt,
    sla: jobSla(row, now),
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The largest list any caller gets. Filters that the database can answer are applied there; the SLA
 * filter is not (its state depends on the snapshotted deadline *and* the clock), so it is applied
 * after the rows come back — which means the page is taken from a capped set rather than from SQL.
 * At the scale in ASSUMPTIONS 5 that cap is the whole book of work.
 */
const MAX_JOB_ROWS = 2_000

/**
 * The company-wide list (brief §8): every filter the brief names, in one place.
 *
 * Everything except the SLA state is a `where` clause. The SLA state is computed by `jobSla`, because
 * "breached" is a function of a snapshotted deadline and the current time, not a column — filtering it
 * in SQL would mean a second implementation of the rule, which is exactly what `sla.ts` exists to
 * prevent.
 *
 * The date range matches the visit date, falling back to when the job was raised for jobs that have
 * not been scheduled. A range is two wall dates in the operating timezone, so it is resolved with the
 * settings; `timezone` is a parameter rather than a read, so a caller that already has the settings
 * (every page does) pays nothing for it.
 */
export async function listJobs(
  context: AuthContext,
  rawFilters: unknown = {},
  client: Tx = db,
  now: Date = new Date(),
  timezone: string | null = null,
): Promise<JobSummary[]> {
  assertCan(context, 'job.read.all')
  const filters = parseInput(jobFilterSchema, rawFilters) as JobFilter

  const range = await jobDateRange(filters, client, timezone)

  // The date range and the text search each need their own OR. They are collected into an AND rather
  // than spread into the same object, because two `OR` keys survive as one and the second would
  // silently replace the first.
  const conditions: Prisma.JobWhereInput[] = []
  if (range) {
    conditions.push({
      OR: [
        { scheduledStart: { gte: range.from, lt: range.to } },
        // Not scheduled yet: the date it was raised is the only date it has.
        { scheduledStart: null, reportedAt: { gte: range.from, lt: range.to } },
      ],
    })
  }

  const where: Prisma.JobWhereInput = {
    ...jobReadWhere(context),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.jobTypeId ? { jobTypeId: filters.jobTypeId } : {}),
    ...(filters.ticketId ? { ticketId: filters.ticketId } : {}),
    ...(filters.technicianId
      ? { technicians: { some: { technicianId: filters.technicianId } } }
      : {}),
    ...(filters.q
      ? {
          OR: [
            { number: { contains: filters.q, mode: 'insensitive' } },
            { customerPoRef: { contains: filters.q, mode: 'insensitive' } },
            { customer: { legalName: { contains: filters.q, mode: 'insensitive' } } },
            { cranes: { some: { crane: { assetTag: { contains: filters.q, mode: 'insensitive' } } } } },
          ],
        }
      : {}),
    ...(conditions.length > 0 ? { AND: conditions } : {}),
  }

  const rows = await client.job.findMany({
    where,
    select: jobSelect,
    orderBy: JOB_ORDER[filters.sort || 'default'],
    take: MAX_JOB_ROWS,
  })

  let summaries = rows.map((row) => toSummary(row, now))

  if (filters.sla) {
    summaries = summaries.filter((job) =>
      [job.sla.response, job.sla.resolution].some((sla) => sla.state === filters.sla),
    )
  }

  return summaries
}

/**
 * The orderings the list offers, in the database's own terms. The default is the order somebody works
 * down the list: live before finished, urgent before routine, oldest first.
 */
const JOB_ORDER: Record<JobSort, Prisma.JobOrderByWithRelationInput[]> = {
  default: [{ status: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
  newest: [{ createdAt: 'desc' }],
  // Nulls last: a job with no date cannot be the next thing happening.
  scheduled: [{ scheduledStart: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
}

/**
 * The `from`/`to` wall dates as an instant range, or null when neither was given.
 *
 * A range with only one end is halved rather than refused: somebody filtering "from the 1st" means
 * "since then", and telling them to re-enter a second date would be pedantry.
 */
async function jobDateRange(
  filters: JobFilter,
  client: Tx,
  timezone: string | null,
): Promise<{ from: Date; to: Date } | null> {
  if (!filters.from && !filters.to) return null
  const tz = timezone ?? (await getSettings(client)).timezone

  const start = filters.from ? isoDayStart(filters.from, tz) : null
  const end = filters.to ? isoDayStart(filters.to, tz) : null

  return {
    from: start ?? new Date(0),
    // The range includes the `to` day in full, so the bound is the start of the day after it.
    to: end ? addDays(end, 1) : new Date(8.64e15),
  }
}

/** Midnight at the start of a `YYYY-MM-DD` wall date, or null if it is not one. */
function isoDayStart(value: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return wallTimeToUtc(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0, timezone)
}

export async function getJob(
  context: AuthContext,
  jobId: string,
  client: Tx = db,
  now: Date = new Date(),
): Promise<JobDetail> {
  assertCan(context, 'job.read.all')

  const [[row, history, users], links] = await Promise.all([
    metadataForJob(context, jobId, client),
    // Read only on this page: the two follow-up links would be two joins per row in every list.
    client.job.findFirst({
      where: { id: jobId, ...jobReadWhere(context) },
      select: followUpSelect,
    }),
  ])

  return {
    ...toSummary(row, now),
    description: row.description,
    internalNotes: row.internalNotes,
    customerPoRef: row.customerPoRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
    history: withNames(history, users),
    parentJob: links?.parentJob ?? null,
    followUps: links?.followUps ?? [],
  }
}

/**
 * The job row and its status history with the names resolved, in one round trip.
 *
 * `generateMetadata` and the page both need the job, and Next renders them as two separate calls —
 * without this the detail page pays for the same queries twice before it draws anything. Deliberately
 * no `now` argument: a `new Date()` per caller would be a different cache key every time.
 */
export const metadataForJob = cache(
  async (
    context: AuthContext,
    jobId: string,
    client: Tx = db,
  ): Promise<[JobRow, JobHistoryRow[], Map<string, string>]> => {
    assertCan(context, 'job.read.all')

    const [row, history] = await Promise.all([
      client.job.findFirst({
        where: { id: jobId, ...jobReadWhere(context) },
        select: jobSelect,
      }),
      client.jobStatusHistory.findMany({
        where: { jobId },
        orderBy: [{ changedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          reason: true,
          onHoldReason: true,
          changedById: true,
          changedAt: true,
        },
      }),
    ])
    if (!row) throw new NotFoundError('No such job.')

    // One query for the names on the history rows, rather than a join per row.
    const userIds = [
      ...new Set(history.map((entry) => entry.changedById).filter((id): id is string => !!id)),
    ]
    const users = userIds.length
      ? await client.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : []
    const nameFor = new Map(users.map((user) => [user.id, user.name]))

    return [row, history, nameFor]
  },
)

type JobHistoryRow = Omit<JobHistoryEntry, 'changedByName'>

function withNames(history: JobHistoryRow[], nameFor: Map<string, string>): JobHistoryEntry[] {
  return history.map((entry) => ({
    ...entry,
    changedByName: entry.changedById ? nameFor.get(entry.changedById) ?? null : null,
  }))
}

/** Counts for the dashboard tile: what is live, what is late, and what is stuck. */
export interface JobStats {
  open: number
  breached: number
  onHold: number
  p1Open: number
}

const CLOSED_STATUSES: JobStatus[] = ['CLOSED', 'CANCELLED']

export async function openJobStats(
  context: AuthContext,
  client: Tx = db,
  now: Date = new Date(),
): Promise<JobStats> {
  assertCan(context, 'job.read.all')

  const rows = await client.job.findMany({
    where: { ...jobReadWhere(context), status: { notIn: CLOSED_STATUSES } },
    select: {
      priority: true,
      status: true,
      reportedAt: true,
      respondedAt: true,
      completedAt: true,
      closedAt: true,
      slaResponseDue: true,
      slaResolveDue: true,
    },
  })

  let breached = 0
  let onHold = 0
  let p1Open = 0
  for (const row of rows) {
    const sla = jobSla(row, now)
    if (sla.response.state === 'breached' || sla.resolution.state === 'breached') breached += 1
    if (row.status === 'ON_HOLD') onHold += 1
    if (row.priority === 'P1') p1Open += 1
  }
  return { open: rows.length, breached, onHold, p1Open }
}

/** Active job types, for a filter or a form that needs to name the kind of work. */
export async function listJobTypes(
  context: AuthContext,
  client: Tx = db,
): Promise<JobTypeRef[]> {
  assertCan(context, 'job.read.all')

  return client.jobType.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, code: true, name: true },
  })
}

export interface JobFormOptions {
  customers: Array<{
    id: string
    legalName: string
    tradingName: string | null
    sites: Array<{
      id: string
      name: string
      cranes: Array<{ id: string; assetTag: string; status: string }>
    }>
  }>
  jobTypes: JobTypeRef[]
}

/**
 * Everything the create-job form needs, in one payload: the same cascade as ticket intake plus the
 * active job types. Capped at hundreds of cranes by the size of the business, as with tickets.
 */
export async function listJobFormOptions(
  context: AuthContext,
  client: Tx = db,
): Promise<JobFormOptions> {
  assertCan(context, 'job.create')

  const [customers, jobTypes] = await Promise.all([
    client.customer.findMany({
      where: { ...customerReadWhere(context) },
      orderBy: { legalName: 'asc' },
      select: {
        id: true,
        legalName: true,
        tradingName: true,
        sites: {
          where: { deletedAt: null },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            cranes: {
              where: { deletedAt: null },
              orderBy: { assetTag: 'asc' },
              select: { id: true, assetTag: true, status: true },
            },
          },
        },
      },
    }),
    client.jobType.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true },
    }),
  ])

  return { customers, jobTypes }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Resolves the customer, site and cranes into what the `Job` row needs.
 *
 * `Job.siteId` is required by the schema while `Ticket.siteId` is optional, so a job needs a site
 * even when one is not given: it comes from the first crane. A job with cranes at two different sites
 * is refused rather than silently filed at the first one — that would send somebody to the wrong
 * plant.
 */
async function resolveJobLocation(
  tx: Tx,
  context: AuthContext,
  input: { customerId: string; siteId: string | null; craneIds: string[] },
): Promise<{ siteId: string; craneIds: string[] }> {
  const customer = await tx.customer.findFirst({
    where: { id: input.customerId, ...customerReadWhere(context) },
    select: { id: true },
  })
  if (!customer) throw new NotFoundError('No such customer.')

  const cranes = input.craneIds.length
    ? await tx.crane.findMany({
        where: {
          id: { in: input.craneIds },
          customerId: input.customerId,
          ...craneReadWhere(context),
        },
        select: { id: true, siteId: true },
      })
    : []

  if (cranes.length !== input.craneIds.length) {
    throw new RuleError('Every selected crane must belong to this customer.')
  }

  const craneSites = [...new Set(cranes.map((crane) => crane.siteId))]
  if (craneSites.length > 1) {
    throw new RuleError('Choose cranes at one site — a job is one visit.')
  }

  const siteId = input.siteId ?? craneSites[0] ?? null
  if (!siteId) throw new RuleError('Choose a site, or at least one crane.')

  const site = await tx.site.findFirst({
    where: { id: siteId, customerId: input.customerId, ...siteReadWhere(context) },
    select: { id: true },
  })
  if (!site) throw new RuleError('That site does not belong to this customer.')

  if (craneSites[0] && craneSites[0] !== siteId) {
    throw new RuleError('Those cranes are at a different site.')
  }

  return { siteId, craneIds: cranes.map((crane) => crane.id) }
}

/** Creates one job inside the caller's transaction, shared by direct creation and conversion. */
async function createJobRow(
  tx: Tx,
  context: AuthContext,
  input: CreateJobInput,
  options: { ticketId: string | null; reportedAt: Date },
  parentJobId: string | null = null,
): Promise<JobRow> {
  const location = await resolveJobLocation(tx, context, input)
  return insertJob(tx, input, {
    ticketId: options.ticketId,
    reportedAt: options.reportedAt,
    location,
    actorId: context.userId,
    parentJobId,
  })
}

export interface DueScheduleJobInput {
  jobTypeId: string
  customerId: string
  siteId: string
  craneId: string
  priority: 'P1' | 'P2' | 'P3' | 'P4'
  description: string
  reportedAt: Date
}

/**
 * A job raised by the daily cron from a due schedule (slice 15).
 *
 * There is no signed-in user to attribute it to and nothing to alert: the location is already known
 * from the schedule's crane, so the scope-based `resolveJobLocation` is bypassed rather than given a
 * forged identity. SLA targets and numbering are the same as any other job — a cron-raised job is a
 * real job the moment it exists.
 */
export async function createSystemJob(
  tx: Tx,
  input: DueScheduleJobInput,
): Promise<{ id: string; number: string }> {
  const job = await insertJob(
    tx,
    {
      jobTypeId: input.jobTypeId,
      customerId: input.customerId,
      siteId: input.siteId,
      craneIds: [input.craneId],
      ticketId: null,
      priority: input.priority,
      description: input.description,
      internalNotes: null,
    },
    {
      ticketId: null,
      reportedAt: input.reportedAt,
      location: { siteId: input.siteId, craneIds: [input.craneId] },
      actorId: null,
    },
  )
  return { id: job.id, number: job.number }
}

/** The shared tail of job creation: SLA snapshot, document number, status history. */
async function insertJob(
  tx: Tx,
  input: CreateJobInput,
  options: {
    ticketId: string | null
    reportedAt: Date
    location: { siteId: string; craneIds: string[] }
    actorId: string | null
    /** Set when this job was raised from a finding on an earlier job (slice 16). */
    parentJobId?: string | null
  },
): Promise<JobRow> {
  const { location, reportedAt, actorId } = options

  const jobType = await tx.jobType.findFirst({
    where: { id: input.jobTypeId, isActive: true },
    select: { id: true },
  })
  if (!jobType) throw new RuleError('That kind of work is not available.')

  // The contract, if one covers this customer, decides which SLA row applies. Null means the
  // company-wide policy.
  const contract = await tx.contract.findFirst({
    where: {
      customerId: input.customerId,
      deletedAt: null,
      OR: [{ endDate: null }, { endDate: { gte: reportedAt } }],
    },
    orderBy: { startDate: 'desc' },
    select: { id: true },
  })
  const targets = await resolveSlaTargets(input.priority, contract?.id ?? null, tx)

  const number = await nextDocumentNumber(tx, 'JOB')
  const job = await tx.job.create({
    data: {
      number,
      ticketId: options.ticketId,
      parentJobId: options.parentJobId ?? null,
      jobTypeId: input.jobTypeId,
      customerId: input.customerId,
      siteId: location.siteId,
      contractId: contract?.id ?? null,
      status: 'NEW',
      priority: input.priority,
      description: input.description,
      internalNotes: input.internalNotes,
      reportedAt,
      // Snapshotted once, so a later policy edit cannot rewrite this job's history.
      slaResponseDue: addMinutes(reportedAt, targets.responseMinutes),
      slaResolveDue: addMinutes(reportedAt, targets.resolutionMinutes),
      createdById: actorId,
      cranes: { create: location.craneIds.map((craneId) => ({ craneId })) },
      statusHistory: {
        create: { fromStatus: null, toStatus: 'NEW', changedById: actorId },
      },
    },
    select: jobSelect,
  })

  return job
}

/** A job raised directly by the office. */
export async function createJob(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
  options: { parentJobId?: string | null } = {},
): Promise<JobSummary> {
  assertCan(context, 'job.create')
  const input = parseInput(createJobSchema, raw)
  if (input.ticketId) {
    throw new RuleError('Use the ticket screen to turn a ticket into jobs.')
  }

  const created = await withAudit(
    context,
    async (tx, log) => {
      const job = await createJobRow(
        tx,
        context,
        input,
        { ticketId: null, reportedAt: new Date() },
        options.parentJobId ?? null,
      )

      await log({
        entity: 'Job',
        entityId: job.id,
        action: 'CREATE',
        after: {
          number: job.number,
          jobTypeId: job.jobType.id,
          customerId: job.customer.id,
          siteId: job.site?.id ?? null,
          craneIds: job.cranes.map(({ crane }) => crane.id),
          priority: job.priority,
          status: job.status,
          ...(options.parentJobId ? { parentJobId: options.parentJobId } : {}),
        },
      })

      if (job.priority === 'P1') {
        await notifyDispatchersOfJobP1(tx, {
          jobId: job.id,
          number: job.number,
          customerName: job.customer.legalName,
          assetTag: job.cranes[0]?.crane.assetTag ?? null,
          description: job.description ?? 'P1 job raised with no description.',
        })
      }

      return job
    },
    client,
  )

  return toSummary(created, new Date())
}

/**
 * Turns a triaged ticket into one or more jobs and marks the ticket CONVERTED.
 *
 * The ticket keeps its own record; it is not closed, because the call happened and the job numbers
 * may need to be traced back to it. Jobs inherit the customer and, when the ticket named one, the
 * site and crane, and the ticket's priority unless the form overrides it.
 */
export async function convertTicketToJobs(
  context: AuthContext,
  ticketId: string,
  raw: unknown,
  client: Tx = db,
): Promise<JobSummary[]> {
  assertCan(context, 'job.create')
  const input = parseInput(convertTicketSchema, raw)

  const created = await withAudit(
    context,
    async (tx, log) => {
      const ticket = await tx.ticket.findFirst({
        where: { id: ticketId, ...ticketReadWhere(context) },
        select: {
          id: true,
          number: true,
          status: true,
          customerId: true,
          siteId: true,
          craneId: true,
          priority: true,
          reportedAt: true,
        },
      })
      if (!ticket) throw new NotFoundError('No such ticket.')
      if (ticket.status === 'CONVERTED') {
        throw new RuleError('This ticket has already become jobs.')
      }
      if (ticket.status === 'CLOSED' || ticket.status === 'CANCELLED') {
        throw new RuleError('Reopen this ticket before turning it into jobs.')
      }

      const jobs: JobRow[] = []
      for (const jobInput of input.jobs) {
        jobs.push(
          await createJobRow(
            tx,
            context,
            {
              customerId: ticket.customerId,
              // A ticket may name no site at all. The job then has to take one from its cranes, and
              // `resolveJobLocation` refuses if there are none — which is the right outcome: a job
              // with no address cannot be dispatched.
              siteId: ticket.siteId,
              jobTypeId: jobInput.jobTypeId,
              craneIds: ticket.craneId ? [ticket.craneId] : [],
              ticketId: ticket.id,
              priority: jobInput.priority,
              description: jobInput.description,
              internalNotes: null,
            },
            { ticketId: ticket.id, reportedAt: ticket.reportedAt },
          ),
        )
      }

      // The ticket is finished as an intake record, and its resolution clock stops here: from now on
      // the jobs carry the target. Stamping `closedAt` while status is CONVERTED is what makes the
      // ticket drop off the open board and stop counting as breached.
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { status: 'CONVERTED', closedAt: new Date() },
      })

      await log({
        entity: 'Ticket',
        entityId: ticket.id,
        action: 'UPDATE',
        before: { status: ticket.status },
        after: {
          status: 'CONVERTED',
          jobIds: jobs.map((job) => job.id),
          jobNumbers: jobs.map((job) => job.number),
        },
      })

      for (const job of jobs) {
        await log({
          entity: 'Job',
          entityId: job.id,
          action: 'CREATE',
          after: {
            number: job.number,
            ticketId: ticket.id,
            jobTypeId: job.jobType.id,
            customerId: job.customer.id,
            siteId: job.site?.id ?? null,
            craneIds: job.cranes.map(({ crane }) => crane.id),
            priority: job.priority,
            status: job.status,
          },
        })
      }

      // No second P1 alert: the ticket that spawned these jobs already alerted dispatch when it was
      // raised (or when it was triaged). A duplicate alert for every follow-up job would train
      // dispatchers to ignore the one that matters.
      return jobs
    },
    client,
  )

  const now = new Date()
  return created.map((job) => toSummary(job, now))
}

/**
 * Moves a job to another status.
 *
 * Three things happen together or not at all: the status and its timestamp, the history row, and the
 * audit entry. The legal transitions live in `status.ts`; this function only refuses what that map
 * refuses and supplies the reason rules the database also enforces.
 */
export async function transitionJob(
  context: AuthContext,
  jobId: string,
  raw: unknown,
  client: Tx = db,
): Promise<JobDetail> {
  assertCan(context, 'job.transition')
  const input = parseInput(transitionJobSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.job.findFirst({
        where: { id: jobId, ...jobReadWhere(context) },
        select: {
          id: true,
          status: true,
          onHoldReason: true,
          onHoldNote: true,
          onHoldPartId: true,
          reportedAt: true,
          respondedAt: true,
          onSiteAt: true,
          completedAt: true,
          reviewedAt: true,
          invoicedAt: true,
          closedAt: true,
        },
      })
      if (!before) throw new NotFoundError('No such job.')

      if (before.status === input.status) {
        throw new RuleError('The job is already in that state.')
      }
      if (!canTransition(before.status, input.status)) {
        throw new RuleError(`A job cannot go from ${before.status} to ${input.status}.`)
      }

      const now = new Date()
      const stampField = timestampFieldFor(input.status)
      const goingOnHold = input.status === 'ON_HOLD'
      // Never overwrite: the first time a job reached a state is the one that counts. Rework sends a
      // job from COMPLETED back to IN_PROGRESS, and that must not reset `onSiteAt` or `completedAt`.
      const stamp = stampField
        ? ({ [stampField]: before[stampField] ?? now } as Prisma.JobUncheckedUpdateInput)
        : {}

      // The part a parts-hold waits for (slice 28). Checked against the active catalogue rather than
      // trusted from the form, the way a movement's locations are — a job held for a part that is not
      // in the book would never be found by the store looking for what to order.
      const onHoldPartId = goingOnHold && input.onHoldReason === 'AWAITING_PARTS' ? input.onHoldPartId : null
      if (onHoldPartId) {
        const part = await tx.part.findFirst({
          where: { id: onHoldPartId, deletedAt: null },
          select: { id: true },
        })
        if (!part) {
          throw new ValidationError({ onHoldPartId: ['That part is not in the catalogue.'] })
        }
      }

      const after = await tx.job.update({
        where: { id: jobId },
        data: {
          status: input.status,
          onHoldReason: goingOnHold ? input.onHoldReason : null,
          onHoldNote: goingOnHold ? input.note : null,
          onHoldPartId,
          ...stamp,
        },
        select: { status: true, onHoldReason: true, onHoldNote: true, onHoldPartId: true },
      })

      await tx.jobStatusHistory.create({
        data: {
          jobId,
          fromStatus: before.status,
          toStatus: input.status,
          reason: input.note,
          onHoldReason: goingOnHold ? input.onHoldReason : null,
          changedById: context.userId,
        },
      })

      await log({
        entity: 'Job',
        entityId: jobId,
        action: 'UPDATE',
        before: {
          status: before.status,
          onHoldReason: before.onHoldReason,
          onHoldPartId: before.onHoldPartId,
        },
        after: {
          status: after.status,
          onHoldReason: after.onHoldReason,
          onHoldPartId: after.onHoldPartId,
          note: input.note,
        },
      })

      // The schedules this visit completed (slice 12). Inside this transaction on purpose: a saved
      // completion whose schedule did not roll forward leaves the obligation looking overdue and gets
      // the crane visited twice.
      if (input.status === 'COMPLETED' && input.scheduleIds.length > 0) {
        await markSchedulesDone(context, { jobId, scheduleIds: input.scheduleIds }, tx)
      }

      // A follow-up job completing is the record that the defect it was raised for is fixed (slice 19,
      // PLAN §7.7). Written directly rather than through `updateFindingStatus`, which needs
      // `finding.write` that the dispatcher does not hold — the capability that applies here is the
      // job transition that caused it.
      if (input.status === 'COMPLETED') {
        const followUps = await tx.finding.findMany({
          where: { followUpJobId: jobId, status: 'SCHEDULED' },
          select: { id: true },
        })
        if (followUps.length > 0) {
          await tx.finding.updateMany({
            where: { id: { in: followUps.map((finding) => finding.id) } },
            data: { status: 'RECTIFIED' },
          })
          for (const finding of followUps) {
            await log({
              entity: 'Finding',
              entityId: finding.id,
              action: 'UPDATE',
              before: { status: 'SCHEDULED' },
              after: { status: 'RECTIFIED', completedJobId: jobId },
            })
          }
        }
      }
    },
    client,
  )

  return getJob(context, jobId, client)
}

/** Corrects the paperwork on a job. Status is not editable here — that is `transitionJob`. */
export async function updateJob(
  context: AuthContext,
  jobId: string,
  raw: unknown,
  client: Tx = db,
): Promise<JobDetail> {
  assertCan(context, 'job.create')
  const input = parseInput(updateJobSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.job.findFirst({
        where: { id: jobId, ...jobReadWhere(context) },
        select: { id: true, description: true, internalNotes: true, customerPoRef: true },
      })
      if (!before) throw new NotFoundError('No such job.')

      await tx.job.update({
        where: { id: jobId },
        data: {
          description: input.description,
          internalNotes: input.internalNotes,
          customerPoRef: input.customerPoRef,
        },
      })

      await log({
        entity: 'Job',
        entityId: jobId,
        action: 'UPDATE',
        before: {
          description: before.description,
          internalNotes: before.internalNotes,
          customerPoRef: before.customerPoRef,
        },
        after: {
          description: input.description,
          internalNotes: input.internalNotes,
          customerPoRef: input.customerPoRef,
        },
      })
    },
    client,
  )

  return getJob(context, jobId, client)
}
