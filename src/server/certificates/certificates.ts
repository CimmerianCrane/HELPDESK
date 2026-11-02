import type { CertificateType, Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import {
  certificateFilterSchema,
  createCertificateSchema,
  isStatutoryCertificate,
  updateCertificateSchema,
  type CertificateFilter,
} from '@/lib/validation/certificates'
import { parseInput } from '@/lib/validation/parse'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, ValidationError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import {
  certificateReadWhere,
  craneReadWhere,
  jobReadWhere,
} from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { daysUntil, dueBucket, type DueBucket } from '@/server/schedules/recurrence'
import { storage } from '@/server/storage/storage'

/**
 * The certificate register (brief §6.6, slice 13).
 *
 * One service behind the crane page, the `/certificates` queue and the dashboard tile, for the same
 * reason schedules have one: a tile that says "four expiring" must link to a list that shows four.
 *
 * A certificate is a document somebody else issued. Our technicians' reports are company inspections
 * and live in the report timeline; nothing here claims statutory status (CLAUDE.md rule 3), and the
 * only type marked as the Authorised Examiner's is the statutory test and examination.
 */

export interface CertificateSummary {
  id: string
  type: CertificateType
  certificateNumber: string | null
  issuer: string | null
  issueDate: Date | null
  expiryDate: Date | null
  nextDueDate: Date | null
  /** `expiryDate ?? nextDueDate` — the date the compliance screen counts and buckets. */
  dueDate: Date | null
  dueBucket: DueBucket
  overdue: boolean
  statutory: boolean
  statedSwlKg: number | null
  notes: string | null
  crane: {
    id: string
    assetTag: string
    status: string
    siteName: string
    customerName: string
  }
  job: { id: string; number: string } | null
  file: { id: string; filename: string; downloadUrl: string } | null
}

/**
 * A certificate's effective deadline. `expiryDate` is the fact; `nextDueDate` exists for renewals
 * that are due before the certificate runs out, so a register with only the latter still counts.
 */
export function certificateDueDate(certificate: {
  expiryDate: Date | null
  nextDueDate: Date | null
}): Date | null {
  return certificate.expiryDate ?? certificate.nextDueDate
}

const certificateSelect = {
  id: true,
  type: true,
  certificateNumber: true,
  issuer: true,
  issueDate: true,
  expiryDate: true,
  nextDueDate: true,
  statedSwlKg: true,
  fileId: true,
  notes: true,
  crane: {
    select: {
      id: true,
      assetTag: true,
      status: true,
      site: { select: { name: true, customer: { select: { legalName: true } } } },
    },
  },
  job: { select: { id: true, number: true } },
} satisfies Prisma.CertificateSelect

type CertificateRow = Prisma.CertificateGetPayload<{ select: typeof certificateSelect }>

/**
 * Files are looked up in one query and their links signed together, because `Certificate.fileId` is a
 * plain id with no Prisma relation — adding one would mean a schema change for a lookup this cheap.
 */
async function toSummaries(
  client: Tx,
  rows: CertificateRow[],
  now: Date,
): Promise<CertificateSummary[]> {
  const fileIds = rows.map((row) => row.fileId).filter((id): id is string => Boolean(id))
  const files = fileIds.length
    ? await client.file.findMany({
        where: { id: { in: fileIds }, deletedAt: null },
        select: { id: true, filename: true, storageKey: true },
      })
    : []
  const byId = new Map(files.map((file) => [file.id, file]))

  return Promise.all(
    rows.map(async (row) => {
      const file = row.fileId ? byId.get(row.fileId) : undefined
      const dueDate = certificateDueDate(row)
      return {
        id: row.id,
        type: row.type,
        certificateNumber: row.certificateNumber,
        issuer: row.issuer,
        issueDate: row.issueDate,
        expiryDate: row.expiryDate,
        nextDueDate: row.nextDueDate,
        dueDate,
        dueBucket: dueBucket(dueDate, now),
        overdue: dueBucket(dueDate, now) === 'overdue',
        statutory: isStatutoryCertificate(row.type),
        statedSwlKg: row.statedSwlKg === null ? null : Number(row.statedSwlKg),
        notes: row.notes,
        crane: {
          id: row.crane.id,
          assetTag: row.crane.assetTag,
          status: row.crane.status,
          siteName: row.crane.site.name,
          customerName: row.crane.site.customer.legalName,
        },
        job: row.job,
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
 * Every certificate the caller may see, soonest due first, undated last.
 *
 * Bucketing and the text search are combined inside a single top-level `AND`: the technician's scope
 * is an `OR` of their cranes (`craneReadWhere`), and spreading a second `OR` beside it would overwrite
 * it and open the register to every customer.
 */
export async function listCertificates(
  context: AuthContext,
  rawFilters: unknown = {},
  client: Tx = db,
  now: Date = new Date(),
): Promise<CertificateSummary[]> {
  assertCan(context, 'certificate.read')
  const filters = parseInput(certificateFilterSchema, rawFilters) as CertificateFilter

  const q = filters.q
  const where: Prisma.CertificateWhereInput = {
    AND: [
      certificateReadWhere(context),
      ...(filters.type ? [{ type: filters.type }] : []),
      ...(q
        ? [
            {
              OR: [
                { certificateNumber: { contains: q, mode: 'insensitive' as const } },
                { issuer: { contains: q, mode: 'insensitive' as const } },
                {
                  crane: {
                    AND: [
                      craneReadWhere(context),
                      { deletedAt: null },
                      {
                        OR: [
                          { assetTag: { contains: q, mode: 'insensitive' as const } },
                          { site: { name: { contains: q, mode: 'insensitive' as const } } },
                          {
                            site: {
                              customer: {
                                legalName: { contains: q, mode: 'insensitive' as const },
                              },
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ]
        : []),
    ],
  }

  const rows = await client.certificate.findMany({ where, select: certificateSelect, take: 2000 })
  const summaries = await toSummaries(client, rows, now)
  const filtered = filters.due
    ? summaries.filter((row) => row.dueBucket === filters.due)
    : summaries

  return filtered.sort((a, b) => {
    const aAt = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY
    const bAt = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY
    if (aAt !== bAt) return aAt - bAt
    return a.crane.assetTag.localeCompare(b.crane.assetTag)
  })
}

/** The certificates on one crane — the crane page's Compliance section. */
export async function certificatesForCrane(
  context: AuthContext,
  craneId: string,
  client: Tx = db,
  now: Date = new Date(),
): Promise<CertificateSummary[]> {
  assertCan(context, 'certificate.read')
  const rows = await client.certificate.findMany({
    where: { craneId, ...certificateReadWhere(context) },
    select: certificateSelect,
    orderBy: [{ expiryDate: 'asc' }, { type: 'asc' }],
  })
  return toSummaries(client, rows, now)
}

export interface CertificateCounts {
  overdue: number
  /** Expiring in the next 30 days, excluding anything already overdue — the dashboard tile's window. */
  dueWithin30Days: number
  /** Expiring in the next 90 days, excluding anything already overdue — the list's headline. */
  dueWithin90: number
}

/**
 * The dashboard tile's numbers, from the same rows the list reads. `dueWithin90` is the brief's
 * "expiring in 90/60/30" window with the three buckets folded into the one number a tile can show;
 * overdue is kept apart because a lapsed certificate is not merely "coming up".
 */
export async function certificateCounts(
  context: AuthContext,
  client: Tx = db,
  now: Date = new Date(),
): Promise<CertificateCounts> {
  assertCan(context, 'certificate.read')
  const rows = await client.certificate.findMany({
    where: certificateReadWhere(context),
    select: { expiryDate: true, nextDueDate: true },
  })

  let overdue = 0
  let dueWithin30Days = 0
  let dueWithin90 = 0
  for (const row of rows) {
    const bucket = dueBucket(certificateDueDate(row), now)
    if (bucket === 'overdue') overdue += 1
    else if (bucket === '30' || bucket === '60' || bucket === '90') {
      dueWithin90 += 1
      if (bucket === '30') dueWithin30Days += 1
    }
  }
  return { overdue, dueWithin30Days, dueWithin90 }
}

/** "Expires 15/11/2026 (12 days overdue)" for the crane page, in the one date format the app uses. */
export function certificateDueLabel(summary: CertificateSummary): string {
  const days = daysUntil(summary.dueDate)
  if (days === null) return 'no expiry recorded'
  if (days < 0) return `${Math.abs(days)} days overdue`
  if (days === 0) return 'expires today'
  return `expires in ${days} ${days === 1 ? 'day' : 'days'}`
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * The form asks for the job's number rather than its id: the office knows "JOB-2026-0142", not a
 * uuid, and a select of every job on the crane would cost a query for a field that is optional.
 */
async function jobIdForNumber(
  tx: Tx,
  context: AuthContext,
  craneId: string,
  jobNumber: string | null,
): Promise<string | null> {
  if (!jobNumber) return null
  const job = await tx.job.findFirst({
    where: {
      number: jobNumber,
      ...jobReadWhere(context),
      cranes: { some: { craneId } },
    },
    select: { id: true },
  })
  if (!job) {
    throw new ValidationError({ jobNumber: ['No job with that number covers this crane.'] })
  }
  return job.id
}

/** A file may only be attached if it was uploaded as a certificate for this same crane. */
async function certificateFileId(
  tx: Tx,
  craneId: string,
  fileId: string | null,
): Promise<string | null> {
  if (!fileId) return null
  const file = await tx.file.findFirst({
    where: {
      id: fileId,
      kind: 'CERTIFICATE',
      entity: 'Crane',
      entityId: craneId,
      deletedAt: null,
    },
    select: { id: true },
  })
  if (!file) {
    throw new ValidationError({ fileId: ['That upload is not a certificate for this crane.'] })
  }
  return file.id
}

export async function createCertificate(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
  now: Date = new Date(),
): Promise<CertificateSummary> {
  assertCan(context, 'certificate.write')
  const input = parseInput(createCertificateSchema, raw)

  const created = await withAudit(
    context,
    async (tx, log) => {
      const crane = await tx.crane.findFirst({
        where: { id: input.craneId, ...craneReadWhere(context) },
        select: { id: true, assetTag: true },
      })
      if (!crane) throw new NotFoundError('No such crane.')

      const jobId = await jobIdForNumber(tx, context, crane.id, input.jobNumber)
      const fileId = await certificateFileId(tx, crane.id, input.fileId)

      const row = await tx.certificate.create({
        data: {
          craneId: crane.id,
          type: input.type,
          certificateNumber: input.certificateNumber,
          issuer: input.issuer,
          issueDate: input.issueDate,
          expiryDate: input.expiryDate,
          nextDueDate: input.nextDueDate,
          statedSwlKg: input.statedSwlKg,
          jobId,
          fileId,
          notes: input.notes,
        },
        select: certificateSelect,
      })

      await log({ entity: 'Certificate', entityId: row.id, action: 'CREATE', after: auditShape(row) })
      return row
    },
    client,
  )

  return (await toSummaries(client, [created], now))[0]!
}

export async function updateCertificate(
  context: AuthContext,
  certificateId: string,
  raw: unknown,
  client: Tx = db,
  now: Date = new Date(),
): Promise<CertificateSummary> {
  assertCan(context, 'certificate.write')
  const input = parseInput(updateCertificateSchema, raw)

  const updated = await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.certificate.findFirst({
        where: { id: certificateId, ...certificateReadWhere(context) },
        select: { ...certificateSelect, craneId: true, fileId: true },
      })
      if (!before) throw new NotFoundError('No such certificate.')

      const jobId = await jobIdForNumber(tx, context, before.craneId, input.jobNumber)
      // No file on the form means "keep the scan that is already there"; replacing it is an upload,
      // not a checkbox. Removing a document is a deliberate act we do not offer from a text form.
      const fileId = input.fileId
        ? await certificateFileId(tx, before.craneId, input.fileId)
        : before.fileId

      const row = await tx.certificate.update({
        where: { id: certificateId },
        data: {
          type: input.type,
          certificateNumber: input.certificateNumber,
          issuer: input.issuer,
          issueDate: input.issueDate,
          expiryDate: input.expiryDate,
          nextDueDate: input.nextDueDate,
          statedSwlKg: input.statedSwlKg,
          jobId,
          fileId,
          notes: input.notes,
        },
        select: certificateSelect,
      })

      await log({
        entity: 'Certificate',
        entityId: certificateId,
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

/**
 * Ends a certificate record. Soft-deleted like everything else (CLAUDE.md rule 4): a lapsed or
 * superseded certificate is retained, because the crane's paper history is the point of the register.
 */
export async function archiveCertificate(
  context: AuthContext,
  certificateId: string,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'certificate.write')

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.certificate.findFirst({
        where: { id: certificateId, ...certificateReadWhere(context) },
        select: certificateSelect,
      })
      if (!before) throw new NotFoundError('No such certificate.')

      await tx.certificate.update({
        where: { id: certificateId },
        data: { deletedAt: new Date() },
      })
      await log({
        entity: 'Certificate',
        entityId: certificateId,
        action: 'DELETE',
        before: auditShape(before),
      })
    },
    client,
  )
}

/** The audit row's columns, flattened so a reader sees "TAG-01 / JOB-2026-0142", not two uuids. */
function auditShape(row: CertificateRow): Record<string, unknown> {
  return {
    crane: row.crane.assetTag,
    type: row.type,
    certificateNumber: row.certificateNumber,
    issuer: row.issuer,
    issueDate: row.issueDate,
    expiryDate: row.expiryDate,
    nextDueDate: row.nextDueDate,
    statedSwlKg: row.statedSwlKg,
    job: row.job?.number ?? null,
    fileId: row.fileId,
    notes: row.notes,
  }
}
