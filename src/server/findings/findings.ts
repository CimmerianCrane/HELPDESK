import type { Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import {
  acknowledgeDeclineSchema,
  canMoveFinding,
  createFollowUpJobSchema,
  isFindingOpen,
  priorityForSeverity,
  updateFindingStatusSchema,
  type FindingStatusName,
} from '@/lib/validation/findings'
import { parseInput } from '@/lib/validation/parse'
import { withAudit } from '@/server/audit/audit'
import { ForbiddenError, NotFoundError, RuleError, ValidationError } from '@/server/auth/errors'
import { assertCan, can } from '@/server/auth/permissions'
import { findingReadWhere, jobReadWhere, reportReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { createJob } from '@/server/jobs/jobs'
import { storage } from '@/server/storage/storage'

/**
 * Findings: the defects a report raised, and what became of them (brief §4.2, §6.4, slice 16).
 *
 * A finding is not a job and not a quote. It is the outstanding item on a crane — "this brake is
 * below spec and nobody has fixed it yet" — and it stays outstanding until the work is recorded as
 * done or the customer declines it in writing. There is no due date: a finding is unanswered or it is
 * not, which is why the crane page lists open findings rather than bucketing them.
 *
 * The one-click follow-up job is the link between the two: it creates a NEW job for the crane, copies
 * the defect into its description, and records `followUpJobId` on the finding **in the same
 * transaction**, so a finding can never point at a job that was never raised.
 */

export interface FindingSummary {
  id: string
  component: string
  description: string
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR' | 'OBSERVATION'
  recommendation: string | null
  status: FindingStatusName
  open: boolean
  /** The follow-up job, once the office has raised one. */
  followUpJob: { id: string; number: string; status: string } | null
  /** The customer's signed refusal, when they declined the repair. */
  declined: {
    name: string | null
    at: Date | null
    note: string | null
    signatureUrl: string | null
  } | null
  report: {
    id: string
    docNumber: string | null
    jobId: string
    jobNumber: string
    submittedAt: Date | null
  }
  crane: { id: string; assetTag: string }
  /** The priority a follow-up job starts with, from the severity. The office may change it. */
  suggestedPriority: 'P1' | 'P2' | 'P3' | 'P4'
  createdAt: Date
}

const findingSelect = {
  id: true,
  component: true,
  description: true,
  severity: true,
  recommendation: true,
  status: true,
  followUpJob: { select: { id: true, number: true, status: true } },
  declinedAcknowledgedName: true,
  declinedAcknowledgedAt: true,
  declinedSignatureFileId: true,
  createdAt: true,
  report: {
    select: {
      id: true,
      documentNumber: true,
      submittedAt: true,
      job: { select: { id: true, number: true } },
    },
  },
  crane: { select: { id: true, assetTag: true } },
} satisfies Prisma.FindingSelect

type FindingRow = Prisma.FindingGetPayload<{ select: typeof findingSelect }>

/**
 * Rows to what the screens show. Two batched lookups: the decline signatures, and — because a
 * declined repair's reason has no column of its own — the audit entry that recorded it.
 */
async function toSummaries(client: Tx, rows: FindingRow[]): Promise<FindingSummary[]> {
  const fileIds = rows
    .map((row) => row.declinedSignatureFileId)
    .filter((id): id is string => Boolean(id))
  const declinedIds = rows
    .filter((row) => row.status === 'DECLINED_BY_CUSTOMER')
    .map((row) => row.id)

  const [files, declineEntries] = await Promise.all([
    fileIds.length
      ? client.file.findMany({
          where: { id: { in: fileIds }, deletedAt: null },
          select: { id: true, storageKey: true },
        })
      : [],
    declinedIds.length
      ? client.auditLog.findMany({
          where: { entity: 'Finding', entityId: { in: declinedIds }, action: 'UPDATE' },
          orderBy: { createdAt: 'desc' },
          select: { entityId: true, after: true },
        })
      : [],
  ])

  const keyFor = new Map(files.map((file) => [file.id, file.storageKey]))
  const noteFor = new Map<string, string>()
  for (const entry of declineEntries) {
    if (noteFor.has(entry.entityId)) continue
    const note = (entry.after as { note?: unknown } | null)?.note
    if (typeof note === 'string' && note) noteFor.set(entry.entityId, note)
  }

  return Promise.all(
    rows.map(async (row) => {
      const storageKey = row.declinedSignatureFileId
        ? keyFor.get(row.declinedSignatureFileId)
        : undefined
      return {
        id: row.id,
        component: row.component,
        description: row.description,
        severity: row.severity,
        recommendation: row.recommendation,
        status: row.status,
        open: isFindingOpen(row.status),
        followUpJob: row.followUpJob,
        declined: row.declinedAcknowledgedAt
          ? {
              name: row.declinedAcknowledgedName,
              at: row.declinedAcknowledgedAt,
              note: noteFor.get(row.id) ?? null,
              signatureUrl: storageKey ? await storage().signedDownloadUrl(storageKey) : null,
            }
          : null,
        report: {
          id: row.report.id,
          docNumber: row.report.documentNumber,
          jobId: row.report.job.id,
          jobNumber: row.report.job.number,
          submittedAt: row.report.submittedAt,
        },
        crane: row.crane,
        suggestedPriority: priorityForSeverity(row.severity),
        createdAt: row.createdAt,
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Findings on one crane, newest first — the crane page's "Open findings" section (brief §8).
 *
 * `openOnly` is what that section asks for: a rectified defect is in the crane's history, not on its
 * list of things still owed an answer.
 */
export async function findingsForCrane(
  context: AuthContext,
  craneId: string,
  options: { openOnly?: boolean } = {},
  client: Tx = db,
): Promise<FindingSummary[]> {
  assertCan(context, 'crane.read')
  const rows = await client.finding.findMany({
    where: {
      ...findingReadWhere(context),
      craneId,
      ...(options.openOnly ? { status: { in: ['OPEN', 'QUOTED', 'SCHEDULED'] } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: findingSelect,
  })
  return toSummaries(client, rows)
}

/**
 * Every finding on one report, in the order the technician recorded them.
 *
 * Both report capabilities pass: the office reads every report, and a technician reads the one they
 * signed. Which reports reach either is `reportReadWhere`, spread below.
 */
export async function findingsForReport(
  context: AuthContext,
  reportId: string,
  client: Tx = db,
): Promise<FindingSummary[]> {
  if (!can(context.role, 'report.read.all') && !can(context.role, 'report.read.own')) {
    throw new ForbiddenError()
  }
  const rows = await client.finding.findMany({
    where: { ...findingReadWhere(context), reportId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: findingSelect,
  })
  return toSummaries(client, rows)
}

/** One finding. Scoped by the report, so a caller who cannot read the report cannot read this. */
export async function getFinding(  context: AuthContext,
  findingId: string,
  client: Tx = db,
): Promise<FindingSummary> {
  const row = await client.finding.findFirst({
    where: { id: findingId, ...findingReadWhere(context) },
    select: findingSelect,
  })
  if (!row) throw new NotFoundError('No such finding.')
  const [summary] = await toSummaries(client, [row])
  return summary!
}

/**
 * Findings on one job's reports that are still open — what the quote form offers to price (slice 19).
 *
 * The finding keeps its own status: quoting it is pricing, and the signed-off move to `QUOTED` is still
 * the finding form's job. The two `report` filters are merged rather than overwritten, so the row scope
 * survives the job filter.
 */
export async function openFindingsForJob(
  context: AuthContext,
  jobId: string,
  client: Tx = db,
): Promise<FindingSummary[]> {
  assertCan(context, 'report.read.all')
  const job = await client.job.findFirst({
    where: { id: jobId, ...jobReadWhere(context) },
    select: { id: true },
  })
  if (!job) throw new NotFoundError('No such job.')

  const rows = await client.finding.findMany({
    where: {
      ...findingReadWhere(context),
      report: { ...reportReadWhere(context), jobId },
      status: 'OPEN',
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: findingSelect,
  })
  return toSummaries(client, rows)
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Moves a finding along its flow: quoted, scheduled, rectified.
 *
 * Declining is deliberately not here — it needs the customer's name, signature and date, so it goes
 * through `acknowledgeDecline` and nowhere else. The form's status list leaves it out for the same
 * reason, so a client cannot post one without a signature.
 */
export async function updateFindingStatus(
  context: AuthContext,
  findingId: string,
  raw: unknown,
  client: Tx = db,
): Promise<FindingSummary> {
  assertCan(context, 'finding.write')
  const input = parseInput(updateFindingStatusSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.finding.findFirst({
        where: { id: findingId, ...findingReadWhere(context) },
        select: { id: true, status: true },
      })
      if (!before) throw new NotFoundError('No such finding.')

      if (!canMoveFinding(before.status, input.status)) {
        throw new RuleError(
          before.status === input.status
            ? 'That finding is already in that state.'
            : `A ${before.status.toLowerCase().replaceAll('_', ' ')} finding cannot become ${input.status.toLowerCase().replaceAll('_', ' ')}.`,
        )
      }

      await tx.finding.update({ where: { id: findingId }, data: { status: input.status } })
      await log({
        entity: 'Finding',
        entityId: findingId,
        action: 'UPDATE',
        before: { status: before.status },
        after: { status: input.status, ...(input.note ? { note: input.note } : {}) },
      })
    },
    client,
  )

  return getFinding(context, findingId, client)
}

/**
 * The signed acknowledgement of a declined repair (brief §6.4).
 *
 * This is the liability record: the customer says, in their own name and their own hand, that they
 * were told a recommended repair was needed and chose not to have it done. Only a finding that
 * carries a recommendation can be declined — there is nothing to acknowledge otherwise.
 */
export async function acknowledgeDecline(
  context: AuthContext,
  findingId: string,
  raw: unknown,
  client: Tx = db,
): Promise<FindingSummary> {
  assertCan(context, 'finding.write')
  const input = parseInput(acknowledgeDeclineSchema, raw)
  const acknowledgedAt = new Date(`${input.date}T00:00:00Z`)

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.finding.findFirst({
        where: { id: findingId, ...findingReadWhere(context) },
        select: { id: true, status: true, recommendation: true },
      })
      if (!before) throw new NotFoundError('No such finding.')
      if (!before.recommendation) {
        throw new RuleError(
          'There is no recommendation to decline — record what should have been done first.',
        )
      }
      if (!canMoveFinding(before.status, 'DECLINED_BY_CUSTOMER')) {
        throw new RuleError('That finding is already closed.')
      }

      // Bound to this finding, not merely to being a signature: otherwise any PNG already uploaded
      // as somebody's signature could be attached here, and the record would claim this customer
      // declined. `receiveDeliveryOrder` binds its own the same way.
      const signature = await tx.file.findFirst({
        where: {
          id: input.signatureFileId,
          kind: 'SIGNATURE',
          entity: 'Finding',
          entityId: findingId,
          deletedAt: null,
        },
        select: { id: true },
      })
      if (!signature) {
        throw new ValidationError({ signatureFileId: ['That signature upload was not found.'] })
      }

      await tx.finding.update({
        where: { id: findingId },
        data: {
          status: 'DECLINED_BY_CUSTOMER',
          declinedAcknowledgedName: input.name,
          declinedAcknowledgedAt: acknowledgedAt,
          declinedSignatureFileId: signature.id,
        },
      })

      await log({
        entity: 'Finding',
        entityId: findingId,
        action: 'UPDATE',
        before: { status: before.status },
        after: {
          status: 'DECLINED_BY_CUSTOMER',
          declinedBy: input.name,
          declinedOn: input.date,
          note: input.note,
        },
      })
    },
    client,
  )

  return getFinding(context, findingId, client)
}

/**
 * One click: a finding becomes a NEW job for its crane (brief §4.2).
 *
 * The finding supplies the crane, the customer and the site, and the job's description is drafted
 * from it — the office only chooses the kind of work and confirms the priority. `createJob` does the
 * numbering, the SLA snapshot and the P1 fan-out; this adds the two links a follow-up has that a
 * plain job does not: `Finding.followUpJobId` and `Job.parentJobId`, written in the same transaction.
 */
export async function createFollowUpJob(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<{ jobId: string; number: string; finding: FindingSummary }> {
  assertCan(context, 'finding.followUpJob')
  const input = parseInput(createFollowUpJobSchema, raw)

  const result = await withAudit(
    context,
    async (tx, log) => {
      const finding = await getFinding(context, input.findingId, tx)
      if (finding.followUpJob) {
        throw new RuleError(`This finding already has ${finding.followUpJob.number} against it.`)
      }
      if (!isFindingOpen(finding.status)) {
        throw new RuleError('That finding is closed — there is nothing to raise a job for.')
      }

      // The job needs the customer and site, which the finding reaches through its report's job.
      const source = await tx.report.findUniqueOrThrow({
        where: { id: finding.report.id },
        select: { job: { select: { id: true, customerId: true, siteId: true } } },
      })

      const job = await createJob(
        context,
        {
          customerId: source.job.customerId,
          siteId: source.job.siteId,
          jobTypeId: input.jobTypeId,
          craneIds: [finding.crane.id],
          priority: input.priority,
          description: input.description ?? describeFinding(finding),
        },
        tx,
        { parentJobId: source.job.id },
      )

      await tx.finding.update({
        where: { id: finding.id },
        data: { followUpJobId: job.id, status: 'SCHEDULED' },
      })
      await log({
        entity: 'Finding',
        entityId: finding.id,
        action: 'UPDATE',
        before: { status: finding.status, followUpJobId: null },
        after: { status: 'SCHEDULED', followUpJobId: job.id, jobNumber: job.number },
      })

      return { jobId: job.id, number: job.number, findingId: finding.id }
    },
    client,
  )

  return {
    jobId: result.jobId,
    number: result.number,
    finding: await getFinding(context, result.findingId, client),
  }
}

/** The description a follow-up job is born with, in the words the technician wrote. */
export function describeFinding(finding: {
  component: string
  description: string
  recommendation: string | null
  crane: { assetTag: string }
  report: { jobNumber: string; docNumber: string | null }
}): string {
  const lines = [
    `Follow-up to the finding on ${finding.crane.assetTag} recorded in ${finding.report.docNumber ?? finding.report.jobNumber}.`,
    '',
    `Component: ${finding.component}`,
    `Defect: ${finding.description}`,
  ]
  if (finding.recommendation) lines.push(`Recommended: ${finding.recommendation}`)
  return lines.join('\n')
}
