import type { JobStatus, Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import {
  assignTechnicianSchema,
  boardFilterSchema,
  bumpSchema,
  localSpan,
  moveCardSchema,
  rescheduleSchema,
  unassignTechnicianSchema,
  type BoardFilter,
} from '@/lib/validation/schedule'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { jobReadWhere, resourceReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { canTransition } from '@/server/jobs/status'
import { getSettings } from '@/server/settings/settings'
import { utcToLocalInput, wallTimeToUtc, zonedParts } from '@/lib/time'
import {
  boardWindow,
  checkCompetency,
  defaultVisitSpan,
  isoDay,
  jobConflicts,
  onCallGaps,
  parseIsoDay,
  spansOverlap,
  type BoardJob,
  type BoardResource,
  type BoardTechnician,
  type BoardView,
  type BoardWindow,
  type CompetencyCheck,
  type Conflict,
} from './board'

/**
 * Scheduling and dispatch (brief §4.4).
 *
 * The rules themselves are in `board.ts`, as pure functions, because they are the things that are
 * easy to get subtly wrong and impossible to test through a page. This file fetches the rows, applies
 * those rules and writes the results. Three decisions are worth stating, because a reader could
 * reasonably assume the opposite:
 *
 *   - **A competency gap is a refusal; a clash is a warning with an override.** The setting decides
 *     whether a gap blocks. A double-booking or a clash with leave only warns, and the caller passes
 *     `override` to proceed — a missing ticket cannot be waved through by a tired dispatcher at
 *     18:00, but a busy afternoon sometimes has to be.
 *   - **Assigning a technician with a date moves the job to SCHEDULED.** A dated, staffed job left in
 *     TRIAGED would make the board and the lifecycle disagree. The move writes the same history row
 *     as any other transition, so the status machine stays the single record.
 *   - **Dispatch is its own step, with its own notification.** SCHEDULED means planned; DISPATCHED
 *     means the technician has been sent the details. The notification carries what they need on the
 *     road — who to ask for, how to get in, what the machine has had done to it recently — so it is
 *     built here, from rows, and written in the same transaction as the status change.
 */

// ---------------------------------------------------------------------------
// Board shapes
// ---------------------------------------------------------------------------

export interface BoardJobCard {
  id: string
  number: string
  status: JobStatus
  priority: 'P1' | 'P2' | 'P3' | 'P4'
  jobTypeName: string
  customerName: string
  siteName: string
  assetTags: string[]
  description: string | null
  scheduledStart: Date | null
  scheduledEnd: Date | null
  technicianIds: string[]
  leadTechnicianId: string | null
  conflicts: Conflict[]
}

export interface BoardTechnicianCard extends BoardTechnician {
  /** Minutes of job time inside the window, for the utilisation line under the name. */
  scheduledMinutes: number
  /** True when an on-call shift of theirs overlaps the window. */
  onCall: boolean
  onCallUntil: Date | null
}

export interface ScheduleBoard {
  view: BoardView
  /** The day the board is showing, as `YYYY-MM-DD`. */
  day: string
  window: BoardWindow
  technicians: BoardTechnicianCard[]
  jobs: BoardJobCard[]
  /** Assigned and dated, but the date is outside the window. Shown so work is never invisible. */
  later: BoardJobCard[]
  /** A technician, no date: the board cannot draw it, and it cannot be dispatched either. */
  undated: BoardJobCard[]
  /** A date, nobody on it. */
  unassigned: BoardJobCard[]
  resources: Array<BoardResource & { bookedMinutes: number; conflicts: number }>
  onCallGaps: Array<{ start: Date; end: Date }>
  /** Competency gaps, keyed `${jobId}:${technicianId}` — what the assignment form warns about. */
  competency: Record<string, CompetencyCheck>
  timezone: string
}

const OPEN_STATUSES: JobStatus[] = [
  'NEW',
  'TRIAGED',
  'QUOTED',
  'APPROVED',
  'SCHEDULED',
  'DISPATCHED',
  'IN_PROGRESS',
  'ON_HOLD',
]

/**
 * The board for one day or one week.
 *
 * Reads every job that overlaps the window — tomorrow included, not just work inside it — plus the
 * undated and unassigned open work, which is what a dispatcher is actually trying to place. Finished
 * work is excluded: the board is for deciding what happens next, and the job list answers what
 * happened.
 */
export async function scheduleBoard(
  context: AuthContext,
  rawFilter: unknown = {},
  client: Tx = db,
  now: Date = new Date(),
): Promise<ScheduleBoard> {
  assertCan(context, 'job.schedule')

  const filter = parseInput(boardFilterSchema, rawFilter) as BoardFilter
  const settings = await getSettings(client)
  const timezone = settings.timezone

  const day = parseIsoDay(filter.date, now)
  const window = boardWindow(filter.view, day, timezone)

  const jobSelect = {
    id: true,
    number: true,
    status: true,
    priority: true,
    description: true,
    scheduledStart: true,
    scheduledEnd: true,
    jobType: { select: { name: true, requiredCompetencies: true } },
    customer: { select: { legalName: true, tradingName: true } },
    site: { select: { name: true } },
    cranes: {
      select: { crane: { select: { assetTag: true } } },
      orderBy: { crane: { assetTag: 'asc' } },
    },
    technicians: { select: { technicianId: true, isLead: true } },
  } satisfies Prisma.JobSelect

  type JobRow = Prisma.JobGetPayload<{ select: typeof jobSelect }>

  const [jobRows, technicianRows, resources, onCallShifts] = await Promise.all([
    client.job.findMany({
      where: {
        ...jobReadWhere(context),
        status: { in: OPEN_STATUSES },
        // Anything overlapping the window, plus anything undated that somebody has staffed. A job
        // with dates elsewhere is fetched by a second query below so "later" is a real answer, not an
        // absence the dispatcher has to infer.
        OR: [
          { scheduledStart: { lt: window.to }, scheduledEnd: { gt: window.from } },
          { scheduledStart: null },
        ],
      },
      select: jobSelect,
      orderBy: [{ scheduledStart: 'asc' }, { priority: 'asc' }],
      take: 1000,
    }),
    client.technician.findMany({
      where: filter.technicianId ? { id: filter.technicianId } : {},
      orderBy: { user: { name: 'asc' } },
      select: {
        id: true,
        employeeNo: true,
        colour: true,
        user: { select: { name: true } },
        competencies: { select: { name: true, expiryDate: true } },
        unavailability: {
          orderBy: { startAt: 'asc' },
          select: { id: true, startAt: true, endAt: true, reason: true },
        },
        onCallShifts: {
          orderBy: { startAt: 'asc' },
          select: { id: true, startAt: true, endAt: true, notes: true },
        },
      },
    }),
    client.resource.findMany({
      where: resourceReadWhere(context),
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, type: true, status: true, calibrationDueDate: true },
    }),
    client.onCallShift.findMany({
      where: { endAt: { gt: window.from }, startAt: { lt: window.to } },
      orderBy: { startAt: 'asc' },
      select: { id: true, technicianId: true, startAt: true, endAt: true, notes: true },
    }),
  ])

  const boardTechnicians: BoardTechnician[] = technicianRows.map((row) => ({
    id: row.id,
    name: row.user.name,
    colour: row.colour,
    employeeNo: row.employeeNo,
    competencyNames: row.competencies
      .filter((entry) => !entry.expiryDate || entry.expiryDate.getTime() >= now.getTime())
      .map((entry) => entry.name),
    unavailability: row.unavailability,
  }))

  const toBoardJob = (row: JobRow): BoardJob => ({
    id: row.id,
    number: row.number,
    status: row.status,
    priority: row.priority,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    technicianIds: row.technicians.map((entry) => entry.technicianId),
  })

  const boardJobs = jobRows.map(toBoardJob)

  const conflictsFor = (job: BoardJob): Conflict[] =>
    jobConflicts(job, boardTechnicians, boardJobs)

  const toCard = (row: JobRow): BoardJobCard => {
    const job = toBoardJob(row)
    const lead = row.technicians.find((entry) => entry.isLead)
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      priority: row.priority,
      jobTypeName: row.jobType.name,
      customerName: row.customer.tradingName ?? row.customer.legalName,
      siteName: row.site.name,
      assetTags: row.cranes.map(({ crane }) => crane.assetTag),
      description: row.description,
      scheduledStart: row.scheduledStart,
      scheduledEnd: row.scheduledEnd,
      technicianIds: job.technicianIds,
      leadTechnicianId: lead?.technicianId ?? job.technicianIds[0] ?? null,
      conflicts: conflictsFor(job),
    }
  }

  const inWindow = (row: JobRow): boolean =>
    !!row.scheduledStart &&
    !!row.scheduledEnd &&
    row.scheduledStart.getTime() < window.to.getTime() &&
    row.scheduledEnd.getTime() > window.from.getTime()

  const jobs: BoardJobCard[] = []
  const undated: BoardJobCard[] = []
  const unassigned: BoardJobCard[] = []

  for (const row of jobRows) {
    const card = toCard(row)
    if (!row.scheduledStart || !row.scheduledEnd) {
      // A dated job with nobody on it is not "undated" — it is waiting for a name, which is a
      // different problem and a different column on the board.
      undated.push(card)
      continue
    }
    if (row.technicians.length === 0) unassigned.push(card)
    if (inWindow(row)) jobs.push(card)
  }

  // Everything staffed but outside the window, for the "later this week" rail.
  const laterRows = await client.job.findMany({
    where: {
      ...jobReadWhere(context),
      status: { in: OPEN_STATUSES },
      scheduledStart: { gte: window.to },
      technicians: { some: {} },
    },
    select: jobSelect,
    orderBy: [{ scheduledStart: 'asc' }, { priority: 'asc' }],
    take: 50,
  })

  // Competency, per assignment on the board. Computed once here rather than per render, because the
  // board shows the same verdict the assignment service will enforce.
  const competency: Record<string, CompetencyCheck> = {}
  const requiredByJob = new Map(jobRows.map((row) => [row.id, row.jobType.requiredCompetencies]))
  for (const row of jobRows) {
    const required = requiredByJob.get(row.id) ?? []
    if (required.length === 0) continue
    for (const entry of row.technicians) {
      const technician = technicianRows.find((candidate) => candidate.id === entry.technicianId)
      if (!technician) continue
      competency[`${row.id}:${entry.technicianId}`] = checkCompetency(
        required,
        technician.competencies,
        { now, blockOnExpired: settings.blockAssignmentOnExpiredCompetency },
      )
    }
  }

  const scheduledMinutes = (technicianId: string): number =>
    jobs
      .filter((job) => job.technicianIds.includes(technicianId) && job.scheduledStart && job.scheduledEnd)
      .reduce(
        (total, job) =>
          total +
          Math.round(
            (Math.min(job.scheduledEnd!.getTime(), window.to.getTime()) -
              Math.max(job.scheduledStart!.getTime(), window.from.getTime())) /
              60_000,
          ),
        0,
      )

  const technicianCards: BoardTechnicianCard[] = boardTechnicians.map((technician) => {
    const shift = onCallShifts.find((entry) => entry.technicianId === technician.id)
    return {
      ...technician,
      scheduledMinutes: scheduledMinutes(technician.id),
      onCall: !!shift,
      onCallUntil: shift?.endAt ?? null,
    }
  })

  // Resource conflicts: two bookings of the same resource that overlap, inside the window.
  const bookings = await client.jobResource.findMany({
    where: {
      resourceId: { in: resources.map((resource) => resource.id) },
      OR: [
        { startAt: { lt: window.to }, endAt: { gt: window.from } },
        // A booking with no span follows its job; the join below resolves it.
        { startAt: null, job: { scheduledStart: { lt: window.to }, scheduledEnd: { gt: window.from } } },
      ],
    },
    select: {
      resourceId: true,
      startAt: true,
      endAt: true,
      job: { select: { scheduledStart: true, scheduledEnd: true } },
    },
  })

  const bookingsByResource = new Map<string, Array<{ start: Date | null; end: Date | null }>>()
  for (const booking of bookings) {
    const span = {
      start: booking.startAt ?? booking.job.scheduledStart,
      end: booking.endAt ?? booking.job.scheduledEnd,
    }
    const list = bookingsByResource.get(booking.resourceId) ?? []
    list.push(span)
    bookingsByResource.set(booking.resourceId, list)
  }

  const resourceCards = resources.map((resource) => {
    const spans = bookingsByResource.get(resource.id) ?? []
    let conflicts = 0
    for (let i = 0; i < spans.length; i += 1) {
      for (let j = i + 1; j < spans.length; j += 1) {
        if (spansOverlap(spans[i]!, spans[j]!)) conflicts += 1
      }
    }
    const bookedMinutes = spans.reduce((total, span) => {
      if (!span.start || !span.end) return total
      return (
        total +
        Math.max(
          0,
          Math.round(
            (Math.min(span.end.getTime(), window.to.getTime()) -
              Math.max(span.start.getTime(), window.from.getTime())) /
              60_000,
          ),
        )
      )
    }, 0)
    return { ...resource, bookedMinutes, conflicts }
  })

  return {
    view: filter.view,
    day: isoDay(day),
    window,
    technicians: technicianCards,
    jobs,
    later: laterRows.map(toCard),
    undated,
    unassigned,
    resources: resourceCards,
    onCallGaps: onCallGaps(onCallShifts, window.from, window.to),
    competency,
    timezone,
  }
}

// ---------------------------------------------------------------------------
// One job's staffing
// ---------------------------------------------------------------------------

export interface JobStaffing {
  jobId: string
  scheduledStart: Date | null
  scheduledEnd: Date | null
  technicians: Array<{
    technicianId: string
    name: string
    colour: string | null
    isLead: boolean
    competency: CompetencyCheck
  }>
  resources: Array<{ resourceId: string; name: string; status: string; startAt: Date | null; endAt: Date | null }>
}

/**
 * What is on a job, for the job screen: its crew, their competency verdict, and the kit booked out.
 *
 * The job page needs this without the whole board, and the verdict has to be the one the assignment
 * service would give — so it is computed with the same function and the same setting rather than
 * re-derived from a list of names in the page.
 */
export async function jobStaffing(
  context: AuthContext,
  jobId: string,
  client: Tx = db,
  now: Date = new Date(),
): Promise<JobStaffing> {
  assertCan(context, 'job.read.all')

  const job = await client.job.findFirst({
    where: { id: jobId, ...jobReadWhere(context) },
    select: {
      id: true,
      scheduledStart: true,
      scheduledEnd: true,
      jobType: { select: { requiredCompetencies: true } },
      technicians: {
        orderBy: { assignedAt: 'asc' },
        select: {
          technicianId: true,
          isLead: true,
          technician: {
            select: {
              colour: true,
              user: { select: { name: true } },
              competencies: { select: { name: true, expiryDate: true } },
            },
          },
        },
      },
      resources: {
        select: {
          resourceId: true,
          startAt: true,
          endAt: true,
          resource: { select: { name: true, status: true } },
        },
      },
    },
  })
  if (!job) throw new NotFoundError('No such job.')

  const settings = await getSettings(client)

  return {
    jobId: job.id,
    scheduledStart: job.scheduledStart,
    scheduledEnd: job.scheduledEnd,
    technicians: job.technicians.map((entry) => ({
      technicianId: entry.technicianId,
      name: entry.technician.user.name,
      colour: entry.technician.colour,
      isLead: entry.isLead,
      competency: checkCompetency(job.jobType.requiredCompetencies, entry.technician.competencies, {
        now,
        blockOnExpired: settings.blockAssignmentOnExpiredCompetency,
      }),
    })),
    resources: job.resources.map((entry) => ({
      resourceId: entry.resourceId,
      name: entry.resource.name,
      status: entry.resource.status,
      startAt: entry.startAt,
      endAt: entry.endAt,
    })),
  }
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export interface AssignmentResult {
  jobId: string
  jobNumber: string
  technicianId: string
  /** What the dispatcher was shown and chose to proceed past. Empty when the assignment was clean. */
  warnings: string[]
  competency: CompetencyCheck
}

/**
 * Puts a technician on a job.
 *
 * Refuses outright when the competency setting says a gap blocks; warns — and proceeds only with
 * `override` — on a double-booking or a clash with leave. A blocked assignment is not overridable:
 * the office has declared that work must not go ahead without the qualification, and a form must not
 * be able to talk its way past that.
 */
export async function assignTechnician(
  context: AuthContext,
  jobId: string,
  raw: unknown,
  client: Tx = db,
): Promise<AssignmentResult> {
  assertCan(context, 'job.assign')
  const input = parseInput(assignTechnicianSchema, raw)

  return withAudit(
    context,
    async (tx, log) => {
      const now = new Date()
      const settings = await getSettings(tx)

      const job = await tx.job.findFirst({
        where: { id: jobId, ...jobReadWhere(context) },
        select: {
          id: true,
          number: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
          jobType: { select: { name: true, requiredCompetencies: true } },
          technicians: { select: { technicianId: true, isLead: true } },
        },
      })
      if (!job) throw new NotFoundError('No such job.')
      if (job.status === 'CLOSED' || job.status === 'CANCELLED') {
        throw new RuleError('This job is finished; it cannot be staffed.')
      }

      const technician = await tx.technician.findUnique({
        where: { id: input.technicianId },
        select: {
          id: true,
          user: { select: { name: true, isActive: true, deletedAt: true } },
          competencies: { select: { name: true, expiryDate: true } },
          unavailability: { select: { startAt: true, endAt: true, reason: true } },
        },
      })
      if (!technician || !technician.user.isActive || technician.user.deletedAt) {
        throw new RuleError('That technician is not available to assign.')
      }

      const competency = checkCompetency(
        job.jobType.requiredCompetencies,
        technician.competencies,
        { now, blockOnExpired: settings.blockAssignmentOnExpiredCompetency },
      )

      if (competency.blocked) {
        const names = [...competency.missing, ...competency.expired].join(', ')
        throw new RuleError(
          `${technician.user.name} does not hold the competency this work requires (${names}).`,
        )
      }

      const warnings: string[] = []
      const span = { start: job.scheduledStart, end: job.scheduledEnd }

      // Leave. Warned, not refused: cover can be arranged, but it has to be a decision.
      for (const leave of technician.unavailability) {
        if (!spansOverlap(span, { start: leave.startAt, end: leave.endAt })) continue
        warnings.push(
          `${technician.user.name} is on leave then${leave.reason ? ` (${leave.reason})` : ''}.`,
        )
      }

      // Already on another job at the same time.
      const others = await tx.job.findMany({
        where: {
          id: { not: job.id },
          status: { in: OPEN_STATUSES },
          technicians: { some: { technicianId: technician.id } },
          scheduledStart: { lt: job.scheduledEnd ?? new Date(8.64e15) },
          scheduledEnd: { gt: job.scheduledStart ?? new Date(-8.64e15) },
        },
        select: { id: true, number: true, scheduledStart: true, scheduledEnd: true },
      })
      for (const other of others) {
        if (!spansOverlap(span, { start: other.scheduledStart, end: other.scheduledEnd })) continue
        warnings.push(`${technician.user.name} is already on ${other.number} at the same time.`)
      }

      if (warnings.length > 0 && !input.override) {
        throw new RuleError(`${warnings.join(' ')} Confirm the booking to go ahead anyway.`)
      }
      if (input.override && !input.overrideReason) {
        throw new RuleError('Say why the warning is being overridden.')
      }

      const alreadyAssigned = job.technicians.some(
        (entry) => entry.technicianId === technician.id,
      )
      if (alreadyAssigned) {
        throw new RuleError('That technician is already on this job.')
      }

      // Only one lead: the lead is who the dispatch goes to, so two would be two dispatches.
      if (input.isLead) {
        await tx.jobTechnician.updateMany({
          where: { jobId: job.id, isLead: true },
          data: { isLead: false },
        })
      }

      await tx.jobTechnician.create({
        data: {
          jobId: job.id,
          technicianId: technician.id,
          isLead: input.isLead || job.technicians.length === 0,
          assignedById: context.userId,
        },
      })

      // A dated, staffed job that is still in an earlier status moves on. TRIAGED and APPROVED have
      // SCHEDULED as a legal next step; a QUOTED job waits for the customer, so it is left alone and
      // the board shows the mismatch rather than inventing an approval.
      let movedTo: JobStatus | null = null
      if (job.scheduledStart && job.scheduledEnd) {
        for (const candidate of ['TRIAGED', 'APPROVED'] as JobStatus[]) {
          if (job.status === candidate && canTransition(job.status, 'SCHEDULED')) {
            await tx.job.update({ where: { id: job.id }, data: { status: 'SCHEDULED' } })
            await tx.jobStatusHistory.create({
              data: {
                jobId: job.id,
                fromStatus: job.status,
                toStatus: 'SCHEDULED',
                reason: `Scheduled with ${technician.user.name}.`,
                changedById: context.userId,
              },
            })
            movedTo = 'SCHEDULED'
            break
          }
        }
      }

      if (input.override && input.overrideReason) {
        // The override is a decision about safety and cover, so it gets its own audit row rather than
        // being folded into the assignment: "who let this through, and why" is the question asked.
        await log({
          entity: 'Job',
          entityId: job.id,
          action: 'UPDATE',
          before: {},
          after: {
            assignmentOverride: true,
            technicianId: technician.id,
            warnings,
            reason: input.overrideReason,
          },
        })
      }

      await log({
        entity: 'Job',
        entityId: job.id,
        action: 'UPDATE',
        before: { technicianIds: job.technicians.map((entry) => entry.technicianId) },
        after: {
          technicianIds: [...job.technicians.map((entry) => entry.technicianId), technician.id],
          isLead: input.isLead,
          ...(movedTo ? { status: movedTo } : {}),
        },
      })

      return {
        jobId: job.id,
        jobNumber: job.number,
        technicianId: technician.id,
        warnings,
        competency,
      }
    },
    client,
  )
}

/** Takes a technician off a job. The history of them being on it survives in the audit trail. */
export async function unassignTechnician(
  context: AuthContext,
  jobId: string,
  raw: unknown,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'job.assign')
  const input = parseInput(unassignTechnicianSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.jobTechnician.findUnique({
        where: { jobId_technicianId: { jobId, technicianId: input.technicianId } },
        select: { isLead: true },
      })
      if (!before) throw new NotFoundError('That technician is not on this job.')

      const job = await tx.job.findFirst({
        where: { id: jobId, ...jobReadWhere(context) },
        select: { id: true, number: true, status: true },
      })
      if (!job) throw new NotFoundError('No such job.')
      if (job.status === 'IN_PROGRESS' || job.status === 'COMPLETED') {
        throw new RuleError('Somebody is working this job. Reassign it through the job screen.')
      }

      await tx.jobTechnician.delete({
        where: { jobId_technicianId: { jobId, technicianId: input.technicianId } },
      })

      // If the lead went, the longest-standing remaining person takes over. A job with technicians
      // and no lead has nobody to dispatch to.
      if (before.isLead) {
        const next = await tx.jobTechnician.findFirst({
          where: { jobId },
          orderBy: { assignedAt: 'asc' },
          select: { technicianId: true },
        })
        if (next) {
          await tx.jobTechnician.update({
            where: { jobId_technicianId: { jobId, technicianId: next.technicianId } },
            data: { isLead: true },
          })
        }
      }

      await log({
        entity: 'Job',
        entityId: job.id,
        action: 'UPDATE',
        before: { technicianId: input.technicianId, isLead: before.isLead },
        after: { technicianId: null },
      })
    },
    client,
  )
}

// ---------------------------------------------------------------------------
// Rescheduling
// ---------------------------------------------------------------------------

export interface RescheduleResult {
  jobId: string
  jobNumber: string
  warnings: string[]
}

/**
 * Moves a visit's dates.
 *
 * Refuses a span that another job of the same technician already occupies unless the caller
 * confirms; a technician cannot be in two places, and the board is where that is discovered rather
 * than at the gate. The previous span goes into the audit entry, which is what makes a move
 * reversible after the fact.
 */
export async function rescheduleJob(
  context: AuthContext,
  jobId: string,
  raw: unknown,
  client: Tx = db,
): Promise<RescheduleResult> {
  assertCan(context, 'job.schedule')
  const input = parseInput(rescheduleSchema, raw)
  const confirm = Boolean((raw as { confirm?: unknown } | undefined)?.confirm)

  return withAudit(
    context,
    async (tx, log) => {
      const settings = await getSettings(tx)
      const span = localSpan(input.scheduledStart, input.scheduledEnd, settings.timezone)

      const job = await tx.job.findFirst({
        where: { id: jobId, ...jobReadWhere(context) },
        select: {
          id: true,
          number: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
          technicians: {
            select: {
              technicianId: true,
              technician: { select: { user: { select: { name: true } } } },
            },
          },
        },
      })
      if (!job) throw new NotFoundError('No such job.')
      if (job.status === 'IN_PROGRESS' || job.status === 'COMPLETED') {
        throw new RuleError('The visit has already started; its dates are a record now.')
      }
      if (job.status === 'CLOSED' || job.status === 'CANCELLED') {
        throw new RuleError('This job is finished.')
      }

      const warnings: string[] = []

      for (const entry of job.technicians) {
        const others = await tx.job.findMany({
          where: {
            id: { not: job.id },
            status: { in: OPEN_STATUSES },
            technicians: { some: { technicianId: entry.technicianId } },
            scheduledStart: { lt: span.end },
            scheduledEnd: { gt: span.start },
          },
          select: { number: true, scheduledStart: true, scheduledEnd: true },
        })
        for (const other of others) {
          if (
            !spansOverlap(span, { start: other.scheduledStart, end: other.scheduledEnd })
          ) {
            continue
          }
          warnings.push(`${entry.technician.user.name} is on ${other.number} over that time.`)
        }
        const leave = await tx.unavailability.findMany({
          where: {
            technicianId: entry.technicianId,
            startAt: { lt: span.end },
            endAt: { gt: span.start },
          },
          select: { reason: true },
        })
        for (const onLeave of leave) {
          warnings.push(
            `${entry.technician.user.name} is on leave then${onLeave.reason ? ` (${onLeave.reason})` : ''}.`,
          )
        }
      }

      if (warnings.length > 0 && !confirm) {
        throw new RuleError(`${warnings.join(' ')} Confirm the move to go ahead anyway.`)
      }

      await tx.job.update({
        where: { id: job.id },
        data: { scheduledStart: span.start, scheduledEnd: span.end },
      })

      await log({
        entity: 'Job',
        entityId: job.id,
        action: 'UPDATE',
        before: { scheduledStart: job.scheduledStart, scheduledEnd: job.scheduledEnd },
        after: {
          scheduledStart: span.start,
          scheduledEnd: span.end,
          warnings,
        },
      })

      return { jobId: job.id, jobNumber: job.number, warnings }
    },
    client,
  )
}

// ---------------------------------------------------------------------------
// Dragging a card
// ---------------------------------------------------------------------------

export interface MoveCardResult {
  jobId: string
  jobNumber: string
  technicianId: string | null
  scheduledStart: Date | null
  scheduledEnd: Date | null
  warnings: string[]
}

/**
 * The board's drag gesture, as one service call.
 *
 * A drop says two things at once — who, and which day — and both have to be true together or neither
 * is. It is deliberately built out of the two services above rather than reimplementing them: the
 * competency block, the clash warnings and the audit rows are the same code a dispatcher hits through
 * the forms, so a card that drags cleanly and a form that submits cleanly can never disagree.
 *
 * The clock time travels with the card. Moving Tuesday 08:00 to Wednesday means Wednesday 08:00, not
 * Wednesday midnight — a dispatcher placing a visit is choosing a slot in their head, and losing the
 * hour would silently turn every move into a reschedule of the whole visit.
 */
export async function moveJobCard(
  context: AuthContext,
  jobId: string,
  raw: unknown,
  client: Tx = db,
): Promise<MoveCardResult> {
  assertCan(context, 'job.schedule')
  const input = parseInput(moveCardSchema, raw)
  const technicianId = input.technicianId === '' || input.technicianId === 'unassigned'
    ? null
    : input.technicianId

  return withAudit(
    context,
    async (tx, log) => {
      const settings = await getSettings(tx)
      const timezone = settings.timezone

      const job = await tx.job.findFirst({
        where: { id: jobId, ...jobReadWhere(context) },
        select: {
          id: true,
          number: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
          technicians: { select: { technicianId: true } },
        },
      })
      if (!job) throw new NotFoundError('No such job.')
      if (job.status === 'IN_PROGRESS' || job.status === 'COMPLETED') {
        throw new RuleError('The visit has already started; the board cannot move it.')
      }
      if (job.status === 'CLOSED' || job.status === 'CANCELLED') {
        throw new RuleError('This job is finished.')
      }

      const alreadyAssigned = job.technicians.some(
        (entry) => entry.technicianId === technicianId,
      )
      const knowsWho = technicianId !== null

      // "Somebody and no date" is not a state the board can draw, so dropping a card onto a technician
      // also gives it a date — 08:00–10:00 on the day it was dropped on, or the day it was already on.
      // The alternative is a drop that appears to do nothing.
      const wall = {
        start: job.scheduledStart,
        end: job.scheduledEnd,
      }

      let nextStart = wall.start
      let nextEnd = wall.end

      if (input.day) {
        const [year, month, dayOfMonth] = input.day.split('-').map(Number) as [
          number,
          number,
          number,
        ]
        if (wall.start) {
          const local = zonedParts(wall.start, timezone)
          nextStart = wallTimeToUtc(
            year,
            month,
            dayOfMonth,
            local.hour,
            local.minute,
            timezone,
          )
          // The duration is real elapsed time, so a visit does not stretch or shrink because the date
          // it moved to straddles a clock change.
          nextEnd = wall.end
            ? new Date(nextStart.getTime() + (wall.end.getTime() - wall.start.getTime()))
            : null
        } else {
          const span = defaultVisitSpan(new Date(input.day + 'T00:00:00.000Z'), timezone)
          nextStart = span.start
          nextEnd = span.end
        }
      } else if (knowsWho && !wall.start) {
        const span = defaultVisitSpan(new Date(), timezone)
        nextStart = span.start
        nextEnd = span.end
      }

      const warnings: string[] = []

      // Dates first: the assignment's double-booking check reads the job's window, and it should read
      // the window the card is being dropped into rather than the one it is leaving.
      if (nextStart && nextEnd && (!wall.start || !wall.end || nextStart.getTime() !== wall.start.getTime() || nextEnd.getTime() !== wall.end.getTime())) {
        const moved = await rescheduleJob(
          context,
          jobId,
          {
            // Back to wall clock in the operating zone, which is exactly what `rescheduleJob` expects.
            scheduledStart: utcToLocalInput(nextStart, timezone),
            scheduledEnd: utcToLocalInput(nextEnd, timezone),
            confirm: input.override ? 'on' : undefined,
          },
          tx,
        )
        warnings.push(...moved.warnings)
      }

      // Now the people. Taking everybody off is the unassigned rail; a named technician replaces the
      // assignment rather than adding to it, because a card has one home on the board.
      for (const entry of job.technicians) {
        if (entry.technicianId === technicianId) continue
        await unassignTechnician(context, jobId, { technicianId: entry.technicianId }, tx)
      }

      if (knowsWho && !alreadyAssigned) {
        const assigned = await assignTechnician(
          context,
          jobId,
          {
            technicianId,
            override: input.override ? 'on' : undefined,
            overrideReason: input.overrideReason,
          },
          tx,
        )
        warnings.push(...assigned.warnings)
      }

      const after = await tx.job.findFirst({
        where: { id: jobId },
        select: { scheduledStart: true, scheduledEnd: true },
      })

      await log({
        entity: 'Job',
        entityId: jobId,
        action: 'UPDATE',
        before: {
          technicianIds: job.technicians.map((entry) => entry.technicianId),
          scheduledStart: job.scheduledStart,
        },
        after: {
          technicianIds: technicianId ? [technicianId] : [],
          scheduledStart: after?.scheduledStart ?? null,
          via: 'board',
        },
      })

      return {
        jobId: job.id,
        jobNumber: job.number,
        technicianId,
        scheduledStart: after?.scheduledStart ?? null,
        scheduledEnd: after?.scheduledEnd ?? null,
        warnings,
      }
    },
    client,
  )
}

// ---------------------------------------------------------------------------
// Priority bump
// ---------------------------------------------------------------------------

export interface BumpResult {
  displacedJobId: string
  displacedJobNumber: string
  incomingJobId: string
}

/**
 * Displaces a scheduled visit to make room for something more urgent (brief §4.3).
 *
 * The displaced job goes back to APPROVED with its date cleared, and a `ScheduleBump` row records
 * what it had, what took the slot and why. Both facts matter: `ScheduleBump` answers "why did
 * Tuesday move" without reading an audit diff, and the audit row answers "who decided".
 *
 * The function deliberately does *not* schedule the incoming job into the vacated slot. A bump frees
 * the time; putting a job in it is a scheduling decision with its own competency and travel checks,
 * and doing both here would hide one refusal inside the other.
 */
export async function bumpScheduledJob(
  context: AuthContext,
  displacedJobId: string,
  raw: unknown,
  client: Tx = db,
): Promise<BumpResult> {
  assertCan(context, 'job.bump')
  const input = parseInput(bumpSchema, raw)

  return withAudit(
    context,
    async (tx, log) => {
      const [displaced, incoming] = await Promise.all([
        tx.job.findFirst({
          where: { id: displacedJobId, ...jobReadWhere(context) },
          select: {
            id: true,
            number: true,
            status: true,
            priority: true,
            scheduledStart: true,
            scheduledEnd: true,
          },
        }),
        tx.job.findFirst({
          where: { id: input.incomingJobId, ...jobReadWhere(context) },
          select: { id: true, number: true, priority: true, status: true },
        }),
      ])

      if (!displaced) throw new NotFoundError('No such job to move.')
      if (!incoming) throw new NotFoundError('No such job to make room for.')
      if (displaced.id === incoming.id) {
        throw new RuleError('A job cannot displace itself.')
      }
      if (!displaced.scheduledStart || !displaced.scheduledEnd) {
        throw new RuleError('That job is not scheduled, so nothing is being displaced.')
      }
      if (displaced.status === 'IN_PROGRESS' || displaced.status === 'COMPLETED') {
        throw new RuleError('Somebody is already working that visit.')
      }
      if (incoming.status === 'CLOSED' || incoming.status === 'CANCELLED') {
        throw new RuleError('That job is finished; it does not need a slot.')
      }
      if (incoming.status === 'DISPATCHED' || incoming.status === 'IN_PROGRESS') {
        throw new RuleError('That job has already been dispatched.')
      }

      await tx.job.update({
        where: { id: displaced.id },
        data: {
          scheduledStart: null,
          scheduledEnd: null,
          // Back to APPROVED rather than SCHEDULED: the work is still agreed, but it has lost its
          // date and has to be placed again. SCHEDULED with no date is the state the board flags.
          status: 'APPROVED',
        },
      })

      await tx.jobStatusHistory.create({
        data: {
          jobId: displaced.id,
          fromStatus: displaced.status,
          toStatus: 'APPROVED',
          reason: `Displaced by ${incoming.number}: ${input.reason}`,
          changedById: context.userId,
        },
      })

      const bump = await tx.scheduleBump.create({
        data: {
          displacedJobId: displaced.id,
          incomingJobId: incoming.id,
          reason: input.reason,
          previousStart: displaced.scheduledStart,
          previousEnd: displaced.scheduledEnd,
          bumpedById: context.userId,
        },
      })
      void bump

      await log({
        entity: 'Job',
        entityId: displaced.id,
        action: 'UPDATE',
        before: {
          status: displaced.status,
          scheduledStart: displaced.scheduledStart,
          scheduledEnd: displaced.scheduledEnd,
        },
        after: {
          status: 'APPROVED',
          scheduledStart: null,
          scheduledEnd: null,
          bumpedFor: incoming.number,
          reason: input.reason,
        },
      })

      return {
        displacedJobId: displaced.id,
        displacedJobNumber: displaced.number,
        incomingJobId: incoming.id,
      }
    },
    client,
  )
}
