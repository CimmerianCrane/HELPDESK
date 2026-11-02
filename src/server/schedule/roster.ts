import type { EquipmentType, Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import {
  bookResourceSchema,
  localSpan,
  onCallShiftSchema,
  unavailabilitySchema,
  type BookResourceInput,
} from '@/lib/validation/schedule'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import {
  jobReadWhere,
  onCallShiftReadWhere,
  resourceReadWhere,
  unavailabilityReadWhere,
} from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { getSettings } from '@/server/settings/settings'
import { onCallGaps, spansOverlap } from './board'

/**
 * The people and the kit: competencies, leave, the on-call roster and bookable resources (brief
 * §4.4). Kept apart from `scheduling.ts`, which is about placing work, because these are the inputs
 * to that decision and they change on a different cadence — leave is booked weeks ahead, a job is
 * moved in a phone call.
 */

// ---------------------------------------------------------------------------
// Technicians and competencies
// ---------------------------------------------------------------------------

export interface TechnicianProfile {
  id: string
  name: string
  email: string
  employeeNo: string | null
  phone: string | null
  colour: string | null
  isActive: boolean
  competencies: Array<{
    id: string
    name: string
    certificateNo: string | null
    issuer: string | null
    expiryDate: Date | null
    expired: boolean
  }>
}

/** The roster the assignment form and the admin screen both read. */
export async function listTechnicians(
  context: AuthContext,
  client: Tx = db,
  now: Date = new Date(),
): Promise<TechnicianProfile[]> {
  assertCan(context, 'job.schedule')

  const rows = await client.technician.findMany({
    orderBy: { user: { name: 'asc' } },
    select: {
      id: true,
      employeeNo: true,
      phone: true,
      colour: true,
      user: { select: { name: true, email: true, isActive: true, deletedAt: true } },
      competencies: {
        orderBy: [{ expiryDate: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          certificateNo: true,
          issuer: true,
          expiryDate: true,
        },
      },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    name: row.user.name,
    email: row.user.email,
    employeeNo: row.employeeNo,
    phone: row.phone,
    colour: row.colour,
    isActive: row.user.isActive && !row.user.deletedAt,
    competencies: row.competencies.map((competency) => ({
      ...competency,
      expired: !!competency.expiryDate && competency.expiryDate.getTime() < now.getTime(),
    })),
  }))
}

/** Competency names that jobs actually ask for, so the admin form can suggest rather than invent. */
export async function requiredCompetencyNames(context: AuthContext, client: Tx = db) {
  assertCan(context, 'job.schedule')
  const rows = await client.jobType.findMany({
    where: { isActive: true },
    select: { requiredCompetencies: true },
  })
  return [...new Set(rows.flatMap((row) => row.requiredCompetencies))].sort()
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export interface LeaveEntry {
  id: string
  technicianId: string
  technicianName: string
  startAt: Date
  endAt: Date
  reason: string | null
}

export async function listUnavailability(
  context: AuthContext,
  options: { technicianId?: string; from?: Date; to?: Date } = {},
  client: Tx = db,
): Promise<LeaveEntry[]> {
  assertCan(context, 'job.read.own')

  const where: Prisma.UnavailabilityWhereInput = {
    ...(options.technicianId ? { technicianId: options.technicianId } : {}),
    ...(options.from || options.to
      ? {
          ...(options.to ? { startAt: { lt: options.to } } : {}),
          ...(options.from ? { endAt: { gt: options.from } } : {}),
        }
      : {}),
  }

  // A technician may read their own leave even without the scheduling capability, so the scope
  // filter is applied by the dispatcher path rather than by `assertCan('job.schedule')` alone.
  if (!context.technicianId) assertCan(context, 'job.schedule')

  const rows = await client.unavailability.findMany({
    where:
      context.technicianId && !context.role.startsWith('ADMIN')
        ? { ...where, technicianId: context.technicianId }
        : where,
    orderBy: { startAt: 'asc' },
    select: {
      id: true,
      technicianId: true,
      startAt: true,
      endAt: true,
      reason: true,
      technician: { select: { user: { select: { name: true } } } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    technicianId: row.technicianId,
    technicianName: row.technician.user.name,
    startAt: row.startAt,
    endAt: row.endAt,
    reason: row.reason,
  }))
}

/**
 * Records leave.
 *
 * Leave that overlaps work already scheduled for that person does not stop the booking — people do
 * take leave after a job was planned — but the jobs it clashes with are named in the audit entry, so
 * the dispatcher reading the trail later can see what needs moving.
 */
export async function createUnavailability(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<LeaveEntry> {
  assertCan(context, 'job.schedule')
  const input = parseInput(unavailabilitySchema, raw)

  return withAudit(
    context,
    async (tx, log) => {
      const settings = await getSettings(tx)
      const span = localSpan(input.startAt, input.endAt, settings.timezone)

      const technician = await tx.technician.findUnique({
        where: { id: input.technicianId },
        select: { id: true, user: { select: { name: true } } },
      })
      if (!technician) throw new NotFoundError('No such technician.')

      const clashes = await tx.job.findMany({
        where: {
          ...jobReadWhere(context),
          status: { in: ['SCHEDULED', 'DISPATCHED', 'IN_PROGRESS'] },
          technicians: { some: { technicianId: technician.id } },
          scheduledStart: { lt: span.end },
          scheduledEnd: { gt: span.start },
        },
        select: { number: true, scheduledStart: true, scheduledEnd: true },
      })

      const leave = await tx.unavailability.create({
        data: {
          technicianId: technician.id,
          startAt: span.start,
          endAt: span.end,
          reason: input.reason,
        },
        select: { id: true, technicianId: true, startAt: true, endAt: true, reason: true },
      })

      await log({
        entity: 'Technician',
        entityId: technician.id,
        action: 'CREATE',
        after: {
          leaveId: leave.id,
          startAt: leave.startAt,
          endAt: leave.endAt,
          reason: leave.reason,
          clashesWithJobs: clashes.map((job) => job.number),
        },
      })

      return { ...leave, technicianName: technician.user.name }
    },
    client,
  )
}

export async function deleteUnavailability(
  context: AuthContext,
  leaveId: string,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'job.schedule')

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.unavailability.findFirst({
        where: { id: leaveId, ...unavailabilityReadWhere(context) },
        select: { id: true, technicianId: true, startAt: true, endAt: true, reason: true },
      })
      if (!before) throw new NotFoundError('No such leave.')

      await tx.unavailability.delete({ where: { id: leaveId } })

      await log({
        entity: 'Technician',
        entityId: before.technicianId,
        action: 'DELETE',
        before: {
          leaveId: before.id,
          startAt: before.startAt,
          endAt: before.endAt,
          reason: before.reason,
        },
      })
    },
    client,
  )
}

// ---------------------------------------------------------------------------
// On-call roster
// ---------------------------------------------------------------------------

export interface OnCallEntry {
  id: string
  technicianId: string
  technicianName: string
  startAt: Date
  endAt: Date
  notes: string | null
}

export interface OnCallRoster {
  shifts: OnCallEntry[]
  /** Spans in the requested window with nobody on call — the question a dispatcher actually asks. */
  gaps: Array<{ start: Date; end: Date }>
  from: Date
  to: Date
}

/**
 * The roster for a window, and its holes.
 *
 * Reading the roster is open to a technician for their own shifts; the gaps are a dispatch concern
 * and only come back to someone who holds `job.schedule`.
 */
export async function onCallRoster(
  context: AuthContext,
  options: { from: Date; to: Date; technicianId?: string },
  client: Tx = db,
): Promise<OnCallRoster> {
  const manages = context.role !== 'TECHNICIAN'
  if (manages) assertCan(context, 'job.schedule')

  const where: Prisma.OnCallShiftWhereInput = {
    endAt: { gt: options.from },
    startAt: { lt: options.to },
    ...(options.technicianId ? { technicianId: options.technicianId } : {}),
    ...(context.technicianId ? { technicianId: context.technicianId } : {}),
  }

  const rows = await client.onCallShift.findMany({
    where,
    orderBy: { startAt: 'asc' },
    select: {
      id: true,
      technicianId: true,
      startAt: true,
      endAt: true,
      notes: true,
      technician: { select: { user: { select: { name: true } } } },
    },
  })

  return {
    shifts: rows.map((row) => ({
      id: row.id,
      technicianId: row.technicianId,
      technicianName: row.technician.user.name,
      startAt: row.startAt,
      endAt: row.endAt,
      notes: row.notes,
    })),
    gaps: manages ? onCallGaps(rows, options.from, options.to) : [],
    from: options.from,
    to: options.to,
  }
}

/**
 * Puts somebody on call.
 *
 * Overlapping shifts are allowed — a handover where two people are both reachable is safer than a
 * gap — but a shift that overlaps only partially leaves the roster with a gap somewhere else, which
 * the roster view shows. Refusing the overlap instead would push the office to shorten shifts until
 * nobody was covered.
 */
export async function createOnCallShift(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<OnCallEntry> {
  assertCan(context, 'job.schedule')
  const input = parseInput(onCallShiftSchema, raw)

  return withAudit(
    context,
    async (tx, log) => {
      const settings = await getSettings(tx)
      const span = localSpan(input.startAt, input.endAt, settings.timezone)

      const technician = await tx.technician.findUnique({
        where: { id: input.technicianId },
        select: { id: true, user: { select: { name: true } } },
      })
      if (!technician) throw new NotFoundError('No such technician.')

      const shift = await tx.onCallShift.create({
        data: {
          technicianId: technician.id,
          startAt: span.start,
          endAt: span.end,
          notes: input.notes,
          createdById: context.userId,
        },
        select: { id: true, technicianId: true, startAt: true, endAt: true, notes: true },
      })

      await log({
        entity: 'OnCallShift',
        entityId: shift.id,
        action: 'CREATE',
        after: {
          technicianId: technician.id,
          startAt: shift.startAt,
          endAt: shift.endAt,
          notes: shift.notes,
        },
      })

      return { ...shift, technicianName: technician.user.name }
    },
    client,
  )
}

export async function deleteOnCallShift(
  context: AuthContext,
  shiftId: string,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'job.schedule')

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.onCallShift.findFirst({
        where: { id: shiftId, ...onCallShiftReadWhere(context) },
        select: { id: true, technicianId: true, startAt: true, endAt: true, notes: true },
      })
      if (!before) throw new NotFoundError('No such shift.')

      await tx.onCallShift.delete({ where: { id: shiftId } })

      await log({
        entity: 'OnCallShift',
        entityId: before.id,
        action: 'DELETE',
        before: {
          technicianId: before.technicianId,
          startAt: before.startAt,
          endAt: before.endAt,
        },
      })
    },
    client,
  )
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export interface ResourceRow {
  id: string
  name: string
  type: EquipmentType
  serialNumber: string | null
  status: string
  calibrationDueDate: Date | null
  calibrationOverdue: boolean
}

export async function listResources(
  context: AuthContext,
  client: Tx = db,
  now: Date = new Date(),
): Promise<ResourceRow[]> {
  assertCan(context, 'resource.read')

  const rows = await client.resource.findMany({
    where: resourceReadWhere(context),
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      type: true,
      serialNumber: true,
      status: true,
      calibrationDueDate: true,
    },
  })

  return rows.map((row) => ({
    ...row,
    calibrationOverdue: !!row.calibrationDueDate && row.calibrationDueDate.getTime() < now.getTime(),
  }))
}

export interface BookingResult {
  jobId: string
  resourceId: string
  startAt: Date | null
  endAt: Date | null
  warnings: string[]
}

/**
 * Books a resource onto a job.
 *
 * A test weight with an expired calibration is a warning, not a refusal — the office may be booking
 * it in order to send it away — but two jobs wanting the same weight at the same time is the clash
 * that has to be resolved before a technician drives out to collect it.
 */
export async function bookResource(
  context: AuthContext,
  jobId: string,
  raw: unknown,
  client: Tx = db,
  now: Date = new Date(),
): Promise<BookingResult> {
  assertCan(context, 'job.schedule')
  const input = parseInput(bookResourceSchema, raw) as BookResourceInput
  const confirm = Boolean((raw as { confirm?: unknown } | undefined)?.confirm)

  return withAudit(
    context,
    async (tx, log) => {
      const job = await tx.job.findFirst({
        where: { id: jobId, ...jobReadWhere(context) },
        select: { id: true, number: true, scheduledStart: true, scheduledEnd: true },
      })
      if (!job) throw new NotFoundError('No such job.')

      const resource = await tx.resource.findFirst({
        where: { id: input.resourceId, ...resourceReadWhere(context) },
        select: { id: true, name: true, status: true, calibrationDueDate: true },
      })
      if (!resource) throw new NotFoundError('No such resource.')
      if (resource.status === 'RETIRED') {
        throw new RuleError(`${resource.name} is retired and cannot be booked.`)
      }

      // No span given means "for the visit", which is what a test weight or a van is for. A job with
      // no dates cannot lend one, so the booking needs its own — and a wall-clock pair only becomes
      // an instant once the operating timezone has been applied.
      const settings = await getSettings(tx)
      const explicit = input.startAt && input.endAt
        ? localSpan(input.startAt, input.endAt, settings.timezone)
        : null
      const startAt = explicit?.start ?? job.scheduledStart
      const endAt = explicit?.end ?? job.scheduledEnd
      if (!startAt || !endAt) {
        throw new RuleError('This job has no dates yet. Give the booking its own start and end.')
      }

      const warnings: string[] = []
      if (resource.calibrationDueDate && resource.calibrationDueDate.getTime() < now.getTime()) {
        warnings.push(`${resource.name} is past its calibration date.`)
      }
      if (resource.status === 'MAINTENANCE') {
        warnings.push(`${resource.name} is marked as in maintenance.`)
      }

      const others = await tx.jobResource.findMany({
        where: {
          resourceId: resource.id,
          jobId: { not: job.id },
        },
        select: {
          job: { select: { number: true, scheduledStart: true, scheduledEnd: true } },
          startAt: true,
          endAt: true,
        },
      })
      for (const other of others) {
        const span = {
          start: other.startAt ?? other.job.scheduledStart,
          end: other.endAt ?? other.job.scheduledEnd,
        }
        if (!spansOverlap({ start: startAt, end: endAt }, span)) continue
        warnings.push(`${resource.name} is already booked on ${other.job.number} over that time.`)
      }

      if (warnings.length > 0 && !confirm) {
        throw new RuleError(`${warnings.join(' ')} Confirm the booking to go ahead anyway.`)
      }

      await tx.jobResource.upsert({
        where: { jobId_resourceId: { jobId: job.id, resourceId: resource.id } },
        create: { jobId: job.id, resourceId: resource.id, startAt, endAt },
        update: { startAt, endAt },
      })

      await log({
        entity: 'Job',
        entityId: job.id,
        action: 'UPDATE',
        after: {
          resourceId: resource.id,
          resourceName: resource.name,
          startAt,
          endAt,
          warnings,
        },
      })

      return { jobId: job.id, resourceId: resource.id, startAt, endAt, warnings }
    },
    client,
  )
}

export async function releaseResource(
  context: AuthContext,
  jobId: string,
  resourceId: string,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'job.schedule')

  await withAudit(
    context,
    async (tx, log) => {
      // The booking itself is found by its own key, but the resource it names is still a row the
      // caller must be allowed to see — `resourceReadWhere` is what decides that.
      const before = await tx.jobResource.findFirst({
        where: { jobId, resourceId, resource: resourceReadWhere(context) },
        select: { startAt: true, endAt: true, resource: { select: { name: true } } },
      })
      if (!before) throw new NotFoundError('That resource is not booked on this job.')

      await tx.jobResource.delete({ where: { jobId_resourceId: { jobId, resourceId } } })

      await log({
        entity: 'Job',
        entityId: jobId,
        action: 'UPDATE',
        before: {
          resourceId,
          startAt: before.startAt,
          endAt: before.endAt,
        },
        after: { resourceId: null },
      })
    },
    client,
  )
}

/** The operating timezone, for callers that need to build a window themselves. */
export async function operatingTimeZone(): Promise<string> {
  return (await getSettings()).timezone
}
