import type { EquipmentStatus, EquipmentType, Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import {
  calibrationFilterSchema,
  createResourceSchema,
  updateResourceSchema,
  type CalibrationFilter,
} from '@/lib/validation/calibrations'
import { parseInput } from '@/lib/validation/parse'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, ValidationError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { resourceReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { daysUntil, dueBucket, type DueBucket } from '@/server/schedules/recurrence'
import { storage } from '@/server/storage/storage'

/**
 * The calibration register (brief §4.5, slice 34).
 *
 * The equipment this register tracks is the `Resource` rows the scheduler already books onto jobs —
 * test weights, load cells, vehicles and tools. Nothing new is modelled: the date was already there
 * (`Resource.calibrationDueDate`), the slice-17 load test already warns against it, and the phone
 * already receives it. What was missing was a screen that owns the date: who recalibrated what, when
 * it runs out, and what has already lapsed.
 *
 * The certificate for a calibration is a scan like any other, so it takes the same signed-URL upload
 * and the same `FileKind.CERTIFICATE`, owned by the equipment instead of a crane.
 */

export interface CalibrationSummary {
  id: string
  name: string
  type: EquipmentType
  serialNumber: string | null
  status: EquipmentStatus
  calibrationDueDate: Date | null
  dueBucket: DueBucket
  overdue: boolean
  /** The open bookings that would be stranded by retiring it. */
  openBookings: number
  file: { id: string; filename: string; downloadUrl: string } | null
}

const resourceSelect = {
  id: true,
  name: true,
  type: true,
  serialNumber: true,
  status: true,
  calibrationDueDate: true,
  calibrationFileId: true,
} satisfies Prisma.ResourceSelect

type ResourceRow = Prisma.ResourceGetPayload<{ select: typeof resourceSelect }>

/**
 * Files are looked up in one query and their links signed together, the way the certificate register
 * does it: `Resource.calibrationFileId` is a plain id with no Prisma relation.
 */
async function toSummaries(
  client: Tx,
  rows: ResourceRow[],
  now: Date,
): Promise<CalibrationSummary[]> {
  const fileIds = rows.map((row) => row.calibrationFileId).filter((id): id is string => Boolean(id))
  const files = fileIds.length
    ? await client.file.findMany({
        where: { id: { in: fileIds }, deletedAt: null },
        select: { id: true, filename: true, storageKey: true },
      })
    : []
  const byId = new Map(files.map((file) => [file.id, file]))

  const bookings = rows.length
    ? await client.jobResource.groupBy({
        by: ['resourceId'],
        where: { resourceId: { in: rows.map((row) => row.id) }, job: { status: { notIn: ['CLOSED', 'CANCELLED'] } } },
        _count: { _all: true },
      })
    : []
  const bookedCount = new Map(bookings.map((row) => [row.resourceId, row._count._all]))

  return Promise.all(
    rows.map(async (row) => {
      const file = row.calibrationFileId ? byId.get(row.calibrationFileId) : undefined
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        serialNumber: row.serialNumber,
        status: row.status,
        calibrationDueDate: row.calibrationDueDate,
        dueBucket: dueBucket(row.calibrationDueDate, now),
        overdue: dueBucket(row.calibrationDueDate, now) === 'overdue',
        openBookings: bookedCount.get(row.id) ?? 0,
        file: file
          ? {
              id: file.id,
              filename: file.filename,
              downloadUrl: await storage().signedDownloadUrl(file.storageKey),
            }
          : null,
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Every item the caller may see, soonest calibration first, undated last.
 *
 * Bucketing happens in memory, like the certificate queue: the bucket is derived from the clock, and
 * a SQL date comparison would need the operating timezone applied a second time.
 */
export async function listCalibrations(
  context: AuthContext,
  rawFilters: unknown = {},
  client: Tx = db,
  now: Date = new Date(),
): Promise<CalibrationSummary[]> {
  assertCan(context, 'resource.read')
  const filters = parseInput(calibrationFilterSchema, rawFilters) as CalibrationFilter

  const q = filters.q
  const where: Prisma.ResourceWhereInput = {
    AND: [
      resourceReadWhere(context),
      ...(filters.type ? [{ type: filters.type }] : []),
      ...(q
        ? [
            {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                { serialNumber: { contains: q, mode: 'insensitive' as const } },
              ],
            },
          ]
        : []),
    ],
  }

  const rows = await client.resource.findMany({
    where,
    select: resourceSelect,
    orderBy: [{ calibrationDueDate: 'asc' }, { name: 'asc' }],
  })
  const summaries = await toSummaries(client, rows, now)
  const filtered = filters.due
    ? summaries.filter((row) => row.dueBucket === filters.due)
    : summaries

  return filtered.sort((a, b) => {
    const aAt = a.calibrationDueDate?.getTime() ?? Number.POSITIVE_INFINITY
    const bAt = b.calibrationDueDate?.getTime() ?? Number.POSITIVE_INFINITY
    if (aAt !== bAt) return aAt - bAt
    return a.name.localeCompare(b.name)
  })
}

export interface CalibrationCounts {
  overdue: number
  /** Lapsing in the next 30 days, excluding anything already overdue. */
  dueWithin30Days: number
  /** Lapsing in the next 90 days, excluding anything already overdue — the screen's headline. */
  dueWithin90: number
}

/** The same windows the certificate queue counts, from the same rows the list reads. */
export async function calibrationCounts(
  context: AuthContext,
  client: Tx = db,
  now: Date = new Date(),
): Promise<CalibrationCounts> {
  assertCan(context, 'resource.read')
  const rows = await client.resource.findMany({
    where: resourceReadWhere(context),
    select: { calibrationDueDate: true },
  })

  let overdue = 0
  let dueWithin30Days = 0
  let dueWithin90 = 0
  for (const row of rows) {
    const bucket = dueBucket(row.calibrationDueDate, now)
    if (bucket === 'overdue') overdue += 1
    else if (bucket === '30' || bucket === '60' || bucket === '90') {
      dueWithin90 += 1
      if (bucket === '30') dueWithin30Days += 1
    }
  }
  return { overdue, dueWithin30Days, dueWithin90 }
}

/** "Lapses 15/11/2026 (12 days ago)" — the certificate register's sentence, for the same question. */
export function calibrationDueLabel(row: CalibrationSummary): string {
  const days = daysUntil(row.calibrationDueDate)
  if (days === null) return 'no calibration recorded'
  if (days < 0) return `lapsed ${Math.abs(days)} days ago`
  if (days === 0) return 'lapses today'
  return `lapses in ${days} ${days === 1 ? 'day' : 'days'}`
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** A file may only be attached if it was uploaded as a calibration certificate for this equipment. */
async function calibrationFileId(
  tx: Tx,
  resourceId: string,
  fileId: string | null,
): Promise<string | null> {
  if (!fileId) return null
  const file = await tx.file.findFirst({
    where: {
      id: fileId,
      kind: 'CERTIFICATE',
      entity: 'Resource',
      entityId: resourceId,
      deletedAt: null,
    },
    select: { id: true },
  })
  if (!file) {
    throw new ValidationError({ fileId: ['That upload is not a calibration certificate for this item.'] })
  }
  return file.id
}

export async function createResource(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
  now: Date = new Date(),
): Promise<CalibrationSummary> {
  assertCan(context, 'resource.write')
  const input = parseInput(createResourceSchema, raw)

  const created = await withAudit(
    context,
    async (tx, log) => {
      const row = await tx.resource.create({
        data: {
          name: input.name,
          type: input.type,
          serialNumber: input.serialNumber,
          status: input.status,
          calibrationDueDate: input.calibrationDueDate,
        },
        select: resourceSelect,
      })

      await log({ entity: 'Resource', entityId: row.id, action: 'CREATE', after: auditShape(row) })
      return row
    },
    client,
  )

  return (await toSummaries(client, [created], now))[0]!
}

/**
 * Records what the item is and when it was last calibrated.
 *
 * Retiring is the status select rather than a delete: bookings, jobs and the audit trail name the
 * equipment forever, and the calibration history is the point of keeping it. Equipment still booked
 * onto an unfinished job cannot be retired, because the technician would turn up without it.
 */
export async function updateResource(
  context: AuthContext,
  resourceId: string,
  raw: unknown,
  client: Tx = db,
  now: Date = new Date(),
): Promise<CalibrationSummary> {
  assertCan(context, 'resource.write')
  const input = parseInput(updateResourceSchema, raw)

  const updated = await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.resource.findFirst({
        where: { id: resourceId, ...resourceReadWhere(context) },
        select: resourceSelect,
      })
      if (!before) throw new NotFoundError('No such equipment.')

      if (input.status === 'RETIRED' && before.status !== 'RETIRED') {
        const booked = await tx.jobResource.findMany({
          where: {
            resourceId,
            job: { status: { notIn: ['CLOSED', 'CANCELLED'] } },
          },
          select: { job: { select: { number: true } } },
          take: 3,
        })
        if (booked.length > 0) {
          throw new ValidationError({
            status: [
              `Still booked on ${booked.map((row) => row.job.number).join(', ')}. Release it from those jobs before retiring it.`,
            ],
          })
        }
      }

      // No file on the form means "keep the certificate already there"; replacing it is an upload.
      const fileId = input.fileId
        ? await calibrationFileId(tx, resourceId, input.fileId)
        : before.calibrationFileId

      const row = await tx.resource.update({
        where: { id: resourceId },
        data: {
          name: input.name,
          type: input.type,
          serialNumber: input.serialNumber,
          status: input.status,
          calibrationDueDate: input.calibrationDueDate,
          calibrationFileId: fileId,
        },
        select: resourceSelect,
      })

      await log({
        entity: 'Resource',
        entityId: resourceId,
        action: 'UPDATE',
        before: auditShape(before),
        after: auditShape(row),
      })
      return row
    },
    client,
  )

  return (await toSummaries(client, [updated], now))[0]!
}

/** The audit row's columns, so a reader sees the item and its date rather than a uuid. */
function auditShape(row: ResourceRow) {
  return {
    name: row.name,
    type: row.type,
    serialNumber: row.serialNumber,
    status: row.status,
    calibrationDueDate: row.calibrationDueDate,
    calibrationFileId: row.calibrationFileId,
  }
}
