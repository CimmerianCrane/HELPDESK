import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db, type Tx } from '@/lib/db'
import { templateSchema } from '@/lib/templates/schema'
import { parseInput } from '@/lib/validation/parse'
import { reportSubmitSchema, safeToOperateCode } from '@/lib/validation/reports'
import { withAudit, type AuditLogger } from '@/server/audit/audit'
import { ForbiddenError, NotFoundError, RuleError, ValidationError } from '@/server/auth/errors'
import { assertCan, can } from '@/server/auth/permissions'
import { jobReadWhere, reportReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { issuePartForReport } from '@/server/inventory/parts'

/**
 * Submitting a report from the phone (slice 8).
 *
 * The shape is fixed before anything is written:
 *
 *  - the template and the checklist are derived from the **job**, not from the phone, so a crafted
 *    payload cannot pick a different one;
 *  - the phone's rendered template version must still be current, because `Report.data` is validated
 *    against the version stored with the report (CLAUDE.md rule 5);
 *  - the report id comes from the phone, so a replayed upload can be recognised instead of creating a
 *    second visit record.
 *
 * The idempotency receipt itself is written by `applyTechSync` in this same transaction, which is
 * why this module exposes both the standalone `submitReport` and the transaction-taking `applyReport`.
 */

const SEVERITIES = {
  Critical: 'CRITICAL',
  Major: 'MAJOR',
  Minor: 'MINOR',
  Observation: 'OBSERVATION',
} as const

export interface ReportSummary {
  reportId: string
  status: 'SUBMITTED'
  submittedAt: string
}

const envelopeSchema = z.object({
  jobId: z.string().min(1).max(64),
  craneId: z.string().min(1).max(64),
})

/** The job as the report needs it, already narrowed to the caller's scope. */
async function reportJob(context: AuthContext, tx: Tx, jobId: string) {
  const job = await tx.job.findFirst({
    where: { id: jobId, ...jobReadWhere(context) },
    select: {
      id: true,
      number: true,
      jobType: {
        select: {
          name: true,
          defaultReportTemplateId: true,
          defaultChecklistTemplateId: true,
        },
      },
      cranes: { select: { craneId: true } },
    },
  })
  // Not found and not yours are the same answer for a technician's phone.
  if (!job) throw new NotFoundError('No such job.')
  return job
}

/**
 * Validates and writes one report inside the caller's transaction.
 *
 * `log` is the audit logger from `withAudit`; every business row this creates gets an entry, not just
 * the Report (CLAUDE.md rule 6).
 */
export async function applyReport(
  context: AuthContext,
  tx: Tx,
  raw: unknown,
  log: AuditLogger,
): Promise<ReportSummary> {
  const envelope = parseInput(envelopeSchema, raw)
  const job = await reportJob(context, tx, envelope.jobId)

  if (!job.cranes.some((entry) => entry.craneId === envelope.craneId)) {
    throw new ValidationError({ craneId: ['That crane is not on this job.'] })
  }

  if (!job.jobType.defaultReportTemplateId) {
    throw new RuleError('This job type has no report template. Ask the office to attach one.')
  }

  const templateRow = await tx.reportTemplate.findUnique({
    where: { id: job.jobType.defaultReportTemplateId },
    select: { id: true, version: true, schema: true },
  })
  if (!templateRow) {
    throw new RuleError('This job type points at a report template that no longer exists.')
  }

  const template = templateSchema.safeParse(templateRow.schema)
  if (!template.success) {
    throw new RuleError('The report template is not valid. Ask the office to check it.')
  }

  const checklistItems = job.jobType.defaultChecklistTemplateId
    ? await tx.checklistItem.findMany({
        where: { templateId: job.jobType.defaultChecklistTemplateId },
        select: { code: true, label: true, resultType: true, requiresMeasurement: true },
      })
    : []

  const input = parseInput(reportSubmitSchema(template.data, checklistItems), raw)

  // The phone must be filling in the version it actually rendered. Silently accepting a newer
  // template would store answers the technician never saw.
  if (input.templateId !== templateRow.id || input.templateVersion !== templateRow.version) {
    throw new ValidationError({
      templateVersion: ['The report template has changed. Sync and fill the report in again.'],
    })
  }

  if (await tx.report.findUnique({ where: { id: input.reportId }, select: { id: true } })) {
    throw new RuleError('This report has already been submitted.')
  }

  const files = await tx.file.findMany({
    where: {
      id: {
        in: [
          ...input.photoFileIds,
          input.technicianSignatureFileId,
          ...(input.customerSignatureFileId ? [input.customerSignatureFileId] : []),
        ],
      },
      jobId: input.jobId,
      uploadedById: context.userId,
      deletedAt: null,
    },
    select: { id: true, kind: true },
  })
  const fileById = new Map(files.map((file) => [file.id, file.kind]))

  const missingPhoto = input.photoFileIds.find((id) => fileById.get(id) !== 'PHOTO')
  if (missingPhoto) {
    throw new ValidationError({ photos: ['A photo did not upload. Take it again.'] })
  }
  if (fileById.get(input.technicianSignatureFileId) !== 'SIGNATURE') {
    throw new ValidationError({ technicianSignature: ['The technician signature did not upload.'] })
  }
  if (
    input.customerSignatureFileId &&
    fileById.get(input.customerSignatureFileId) !== 'SIGNATURE'
  ) {
    throw new ValidationError({ customerSignature: ['The customer signature did not upload.'] })
  }

  const parts =
    input.parts.length > 0
      ? await tx.part.findMany({
          where: {
            partNumber: { in: input.parts.map((part) => part.partNumber) },
            deletedAt: null,
            isActive: true,
          },
          select: { id: true, partNumber: true, cost: true },
        })
      : []
  const partByNumber = new Map(parts.map((part) => [part.partNumber, part]))
  for (const used of input.parts) {
    if (!partByNumber.has(used.partNumber)) {
      throw new ValidationError({ parts: [`${used.partNumber} is not in the parts catalogue.`] })
    }
  }

  // Field data wins for the technician's own report. A different report already sitting on this
  // job and crane is recorded rather than overwritten (brief §10, CLAUDE.md rule 11).
  const other = await tx.report.findFirst({
    where: { jobId: input.jobId, craneId: input.craneId, id: { not: input.reportId } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  })
  if (other) {
    await tx.conflictLog.create({
      data: {
        entity: 'Report',
        entityId: input.reportId,
        resolution: 'FIELD_WINS',
        detail: {
          jobId: input.jobId,
          craneId: input.craneId,
          otherReportId: other.id,
          otherStatus: other.status,
        },
        userId: context.userId,
      },
    })
  }

  const submittedAt = new Date()
  const data: Record<string, unknown> = {
    ...(input.data as Record<string, unknown>),
    checklist: input.checklist,
    // Snapshotted like every other answer: the issued PDF embeds these exact photographs, so adding
    // or removing a File row later cannot change what a signed report says was attached.
    photoFileIds: input.photoFileIds,
  }

  const report = await tx.report.create({
    data: {
      id: input.reportId,
      jobId: input.jobId,
      craneId: input.craneId,
      templateId: templateRow.id,
      templateVersion: templateRow.version,
      data: data as Prisma.InputJsonValue,
      status: 'SUBMITTED',
      submittedAt,
      technicianSignedById: context.userId,
      technicianSignerName: input.technicianSignerName,
      technicianSignedAt: submittedAt,
      technicianSignatureFileId: input.technicianSignatureFileId,
      customerSignerName: input.customerSignerName,
      customerSignerDesignation: input.customerSignerDesignation,
      customerSignedAt: input.customerSignatureFileId ? submittedAt : null,
      customerSignatureFileId: input.customerSignatureFileId,
      customerDeclinedReason: input.customerDeclinedReason,
      safeToOperate: safeToOperateCode(data.safeToOperate),
      createdById: context.userId,
    },
  })

  await log({
    entity: 'Report',
    entityId: report.id,
    action: 'CREATE',
    after: {
      jobId: report.jobId,
      craneId: report.craneId,
      templateId: report.templateId,
      templateVersion: report.templateVersion,
      status: report.status,
      safeToOperate: report.safeToOperate,
      documentNumber: report.documentNumber,
    },
  })

  // Findings live as rows so slice 9 can turn one into a follow-up job. The same answers stay in
  // `data.findings` because the issued report has to re-render exactly as signed.
  const findingRows = Array.isArray(data.findings) ? (data.findings as Array<Record<string, unknown>>) : []
  for (const row of findingRows) {
    const severity = SEVERITIES[row.severity as keyof typeof SEVERITIES]
    if (!severity) continue
    const finding = await tx.finding.create({
      data: {
        reportId: report.id,
        craneId: input.craneId,
        component: String(row.component ?? ''),
        description: String(row.description ?? ''),
        severity,
        recommendation: row.recommendation ? String(row.recommendation) : null,
      },
    })
    await log({ entity: 'Finding', entityId: finding.id, action: 'CREATE', after: finding })
  }

  // Parts issued on a job are StockMovements — never a JSON list that stock could drift from
  // (CLAUDE.md rule 10). Since slice 22 they go through `postMovement`, which is the only writer of
  // the ledger and the on-hand level, so issuing from the field now decrements the shelf too.
  for (const used of input.parts) {
    const part = partByNumber.get(used.partNumber)!
    await issuePartForReport(tx, log, context, {
      partId: part.id,
      quantity: used.quantity,
      unitCost: Number(part.cost),
      serialOrBatch: used.serialOrBatch,
      jobId: input.jobId,
      reportId: report.id,
    })
  }

  return { reportId: report.id, status: 'SUBMITTED', submittedAt: submittedAt.toISOString() }
}

/** Standalone submission — the path a future online form uses, and the one integration tests call. */
export async function submitReport(
  context: AuthContext,
  raw: unknown,
  client?: Tx,
): Promise<ReportSummary> {
  assertCan(context, 'report.submit')
  return withAudit(context, (tx, log) => applyReport(context, tx, raw, log), client)
}

/**
 * Reports on one job. Both read capabilities are accepted; the row filter decides which reports the
 * caller may see, so an office role and a technician share the function without sharing the data.
 */
export async function reportsForJob(context: AuthContext, jobId: string) {
  if (!can(context.role, 'report.read.all') && !can(context.role, 'report.read.own')) {
    throw new ForbiddenError()
  }
  return db.report.findMany({
    where: { jobId, ...reportReadWhere(context) },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      craneId: true,
      status: true,
      submittedAt: true,
      approvedAt: true,
      documentNumber: true,
      safeToOperate: true,
      crane: { select: { assetTag: true } },
    },
  }).then((rows) => rows.map((row) => ({ ...row, craneTag: row.crane.assetTag })))
}
