import type { Prisma } from '@prisma/client'
import { createHash, randomUUID } from 'node:crypto'
import { db, type Tx } from '@/lib/db'
import { formatDateTime } from '@/lib/format'
import { templateSchema } from '@/lib/templates/schema'
import {
  amendReportSchema,
  approveReportSchema,
  returnReportSchema,
} from '@/lib/validation/approval'
import { parseInput } from '@/lib/validation/parse'
import { withAudit } from '@/server/audit/audit'
import { ForbiddenError, NotFoundError, RuleError } from '@/server/auth/errors'
import { assertCan, can } from '@/server/auth/permissions'
import { reportReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { nextDocumentNumber } from '@/server/documents/sequence'
import { renderReportPdf } from '@/server/documents/render'
import { emailAdapter } from '@/server/email/email'
import { storage } from '@/server/storage/storage'
import { getSettings } from '@/server/settings/settings'
import { CRANE_TYPE_LABELS } from '@/lib/cranes/labels'

/**
 * Approval, the lock, and the PDF (slice 9).
 *
 * Approving is one transaction: the number, the rendered PDF, the File row, the status, the job move
 * to REVIEWED and the audit entries either all land or none do. The one thing that happens outside it
 * is the email, for the same reason `notify.ts` sends after writing its rows — a report that is
 * approved and stored but whose mail failed is recoverable; a mail about an approval that rolled back
 * is a lie. `emailedToCustomerAt` is the retry marker the daily cron sweeps.
 *
 * **Locking is by status, not by a flag.** Every mutation here checks the status inside the
 * transaction, so an approved report cannot be edited, and the only way to change one is `amendReport`,
 * which writes a new report that points at it (CLAUDE.md rules 4 and 5).
 */

/**
 * A report and the job/crane context the PDF needs, narrowed to the caller's scope.
 *
 * Exported for the slice-9 test, which re-renders an issued report after its template is superseded:
 * it has to render through exactly the loader approval used, or it would be proving something about a
 * second query rather than about the document that was issued.
 */
export async function loadReport(context: AuthContext, tx: Tx, reportId: string) {
  return tx.report.findFirst({
    where: { id: reportId, ...reportReadWhere(context) },
    include: {
      template: { select: { id: true, name: true, version: true, schema: true } },
      crane: true,
      findings: true,
      amendmentOf: { select: { id: true, status: true } },
      job: {
        select: {
          id: true,
          number: true,
          customerId: true,
          jobType: { select: { name: true } },
          customer: {
            select: {
              legalName: true,
              tradingName: true,
              contacts: {
                where: { deletedAt: null },
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                select: { email: true },
              },
            },
          },
          site: { select: { name: true, address: true } },
        },
      },
    },
  })
}

export type LoadedReport = NonNullable<Awaited<ReturnType<typeof loadReport>>>

function addressLines(address: unknown): string[] {
  if (!address || typeof address !== 'object') return []
  return Object.values(address as Record<string, unknown>)
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
}

/**
 * Renders the document for a report as it is stored. Exported because the slice-9 test re-renders an
 * approved report after its template has been superseded, which is the whole claim being defended:
 * `templateVersion` and `data` decide the output, not whatever the template says today.
 */
export async function renderStoredReport(
  report: LoadedReport,
  options: { documentNumber: string; issuedAt: Date; timeZone: string; client?: Tx },
): Promise<Buffer> {
  const client = options.client ?? db
  const template = templateSchema.safeParse(report.template.schema)
  if (!template.success) {
    throw new RuleError('This report was written against a template that no longer parses.')
  }

  const data = (report.data ?? {}) as Record<string, unknown>
  const photoIds = Array.isArray(data.photoFileIds) ? (data.photoFileIds as string[]) : []

  // The File rows are looked up by the ids snapshotted on the report, never by "photos on the job",
  // so a photograph added after signing cannot appear on an issued document.
  const fileIds = [
    ...photoIds,
    ...(report.technicianSignatureFileId ? [report.technicianSignatureFileId] : []),
    ...(report.customerSignatureFileId ? [report.customerSignatureFileId] : []),
  ]
  const files =
    fileIds.length > 0
      ? await client.file.findMany({
          where: { id: { in: fileIds }, deletedAt: null },
          select: { id: true, storageKey: true },
        })
      : []
  const keyById = new Map(files.map((file) => [file.id, file.storageKey]))

  // A missing image must not remove a whole issued document: the text is the evidence, the picture is
  // a record of it, and the PDF says what could not be found rather than failing to render at all.
  const bytesFor = async (fileId: string | null): Promise<Uint8Array | null> => {
    const key = fileId ? keyById.get(fileId) : undefined
    if (!key) return null
    try {
      return await storage().get(key)
    } catch {
      return null
    }
  }

  const photos = (await Promise.all(photoIds.map(bytesFor))).filter(
    (bytes): bytes is Uint8Array => bytes !== null,
  )

  return renderReportPdf({
    documentNumber: options.documentNumber,
    template: template.data,
    templateVersion: report.templateVersion,
    data,
    issuedAt: options.issuedAt,
    timeZone: options.timeZone,
    job: { number: report.job.number, typeName: report.job.jobType.name },
    customer: {
      name: report.job.customer.tradingName ?? report.job.customer.legalName,
      siteName: report.job.site.name,
      siteAddress: addressLines(report.job.site.address),
    },
    crane: {
      assetTag: report.crane.assetTag,
      type: CRANE_TYPE_LABELS[report.crane.type],
      brand: report.crane.brand,
      model: report.crane.model,
      serialNumber: report.crane.serialNumber,
      swlKg: Number(report.crane.swlKg),
      yearOfManufacture: report.crane.yearOfManufacture,
      statutoryRegistrationNo: report.crane.statutoryRegistrationNo,
      locationOnSite: report.crane.locationOnSite,
    },
    signatures: {
      technician: await bytesFor(report.technicianSignatureFileId),
      customer: await bytesFor(report.customerSignatureFileId),
    },
    photos,
    signers: {
      technicianName: report.technicianSignerName ?? '',
      technicianSignedAt: report.technicianSignedAt,
      customerName: report.customerSignerName,
      customerDesignation: report.customerSignerDesignation,
      customerSignedAt: report.customerSignedAt,
      customerDeclinedReason: report.customerDeclinedReason,
    },
    findings: report.findings.map((finding) => ({
      component: finding.component,
      description: finding.description,
      severity: finding.severity,
      recommendation: finding.recommendation,
    })),
    safeToOperate: report.safeToOperate,
    amendmentLabel: report.amendmentOfId
      ? `Amendment to a previous issue${report.amendmentReason ? `: ${report.amendmentReason}` : ''}`
      : '',
  })
}

export interface ApprovalResult {
  reportId: string
  documentNumber: string
  pdfFileId: string
  emailedToCustomerAt: Date | null
  emailSkippedReason: string | null
}

/**
 * Approves a submitted report: number, PDF, lock, job to REVIEWED, and the customer told.
 *
 * The customer email is the brief's "email to the customer on job close" (§6.7). It is sent after the
 * transaction commits, so a send failure leaves the report approved with `emailedToCustomerAt` null —
 * which is exactly the row the daily cron picks up.
 */
export async function approveReport(
  context: AuthContext,
  reportId: string,
  raw: unknown = {},
  client?: Tx,
): Promise<ApprovalResult> {
  assertCan(context, 'report.approve')
  parseInput(approveReportSchema, raw)

  const result = await withAudit(
    context,
    async (tx, log) => {
      const report = await loadReport(context, tx, reportId)
      if (!report) throw new NotFoundError('No such report.')

      if (report.status !== 'SUBMITTED') {
        throw new RuleError(
          report.status === 'AMENDED'
            ? 'This report has been replaced by an amendment.'
            : `A ${report.status.toLowerCase()} report cannot be approved.`,
        )
      }
      const settings = await getSettings()
      const approvedAt = new Date()
      const documentNumber = await nextDocumentNumber(tx, 'REPORT', {
        at: approvedAt,
        timeZone: settings.timezone,
      })

      const pdf = await renderStoredReport(report, {
        documentNumber,
        issuedAt: approvedAt,
        timeZone: settings.timezone,
        client: tx,
      })

      // The PDF is stored before the report points at it, and both are in this transaction: the File
      // row exists for exactly as long as the report that owns it, which is what stops a rollback from
      // leaving an orphan document with a number already spent.
      const pdfFileId = randomUUID()
      const storageKey = `reports/${report.id}/${pdfFileId}.pdf`
      await storage().put(storageKey, new Uint8Array(pdf), 'application/pdf')

      const file = await tx.file.create({
        data: {
          id: pdfFileId,
          entity: 'Report',
          entityId: report.id,
          kind: 'REPORT_PDF',
          filename: `${documentNumber}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: pdf.byteLength,
          storageKey,
          sha256: createHash('sha256').update(pdf).digest('hex'),
          uploadedById: context.userId,
          jobId: report.jobId,
        },
      })
      await log({ entity: 'File', entityId: file.id, action: 'CREATE', after: file })

      const approved = await tx.report.update({
        where: { id: report.id },
        data: {
          status: 'APPROVED',
          documentNumber,
          pdfFileId: pdfFileId,
          approvedAt,
          approvedById: context.userId,
          returnReason: null,
        },
      })
      await log({
        entity: 'Report',
        entityId: report.id,
        action: 'UPDATE',
        before: { status: report.status, documentNumber: null, pdfFileId: null },
        after: {
          status: approved.status,
          documentNumber: approved.documentNumber,
          pdfFileId: approved.pdfFileId,
          approvedById: approved.approvedById,
        },
      })

      // An amendment replaces the report it corrects. The original is never rewritten — it keeps its
      // number and its PDF — it is only marked as superseded.
      if (report.amendmentOf?.id) {
        const original = await tx.report.update({
          where: { id: report.amendmentOf.id },
          data: { status: 'AMENDED' },
        })
        await log({
          entity: 'Report',
          entityId: original.id,
          action: 'UPDATE',
          before: { status: 'APPROVED' },
          after: { status: original.status, supersededBy: report.id },
        })
      }

      // A report is what finishes the work: the job moves COMPLETED → REVIEWED so the office's next
      // move is invoicing. Only from COMPLETED, because a job may already have been reviewed and a
      // second approval must not rewrite the lifecycle.
      const job = await tx.job.findUniqueOrThrow({
        where: { id: report.jobId },
        select: { status: true, reviewedAt: true },
      })
      if (job.status === 'COMPLETED') {
        const reviewedAt = job.reviewedAt ?? approvedAt
        await tx.job.update({
          where: { id: report.jobId },
          data: { status: 'REVIEWED', reviewedAt },
        })
        await tx.jobStatusHistory.create({
          data: {
            jobId: report.jobId,
            fromStatus: 'COMPLETED',
            toStatus: 'REVIEWED',
            reason: `Report ${documentNumber} approved`,
            changedById: context.userId,
          },
        })
        await log({
          entity: 'Job',
          entityId: report.jobId,
          action: 'UPDATE',
          before: { status: job.status },
          after: { status: 'REVIEWED' },
        })
      }

      return {
        reportId: report.id,
        jobId: report.jobId,
        documentNumber,
        pdfFileId,
        approvedAt,
        report,
      }
    },
    client,
  )

  // Outside the transaction: the customer is told only about something that definitely happened.
  const recipient = result.report.job.customer.contacts.find((contact) => contact.email)
  const email = await sendIssuedReport({
    to: recipient?.email ?? null,
    jobNumber: result.report.job.number,
    documentNumber: result.documentNumber,
    party: result.report.job.customer.tradingName ?? result.report.job.customer.legalName,
    approvedAt: result.approvedAt,
    timeZone: (await getSettings()).timezone,
  })

  if (email.sentAt) {
    // Through the caller's client when there is one: the transaction is still open then, and a write
    // through `db` would wait on the row the transaction itself holds.
    await (client ?? db).report.update({
      where: { id: result.reportId },
      data: { emailedToCustomerAt: email.sentAt },
    })
  }

  return {
    reportId: result.reportId,
    documentNumber: result.documentNumber,
    pdfFileId: result.pdfFileId,
    emailedToCustomerAt: email.sentAt,
    emailSkippedReason: email.skippedReason,
  }
}

/**
 * Sends the "your report is ready" mail. Returns rather than throws: a dead mail server must not undo
 * an approval, and the null `emailedToCustomerAt` is the record that it still has to go.
 */
async function sendIssuedReport(input: {
  to: string | null
  jobNumber: string
  documentNumber: string
  party: string
  approvedAt: Date
  timeZone: string
}): Promise<{ sentAt: Date | null; skippedReason: string | null }> {
  if (!input.to) {
    return { sentAt: null, skippedReason: 'The customer has no contact with an email address.' }
  }

  const result = await emailAdapter().send({
    to: input.to,
    subject: `Report ${input.documentNumber} — ${input.jobNumber}`,
    text: [
      `${input.party},`,
      '',
      `The report for job ${input.jobNumber} has been approved and issued on ${formatDateTime(input.approvedAt, input.timeZone)}.`,
      `Document number: ${input.documentNumber}.`,
      '',
      'It is available from the Cimmerian Crane helpdesk. This is a company inspection report; it is',
      'not a statutory certificate of test and examination.',
    ].join('\n'),
  })

  return result.ok
    ? { sentAt: new Date(), skippedReason: null }
    : { sentAt: null, skippedReason: result.error ?? 'The email could not be sent.' }
}

/** Sends a report back to the technician with a reason. It stays unnumbered and unapproved. */
export async function returnReport(
  context: AuthContext,
  reportId: string,
  raw: unknown,
  client?: Tx,
): Promise<void> {
  assertCan(context, 'report.approve')
  const input = parseInput(returnReportSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.report.findFirst({
        where: { id: reportId, ...reportReadWhere(context) },
        select: { id: true, status: true },
      })
      if (!before) throw new NotFoundError('No such report.')
      if (before.status !== 'SUBMITTED') {
        throw new RuleError('Only a submitted report can be sent back.')
      }

      const after = await tx.report.update({
        where: { id: reportId },
        data: { status: 'RETURNED', returnReason: input.reason },
      })
      await log({
        entity: 'Report',
        entityId: reportId,
        action: 'UPDATE',
        before: { status: before.status },
        after: { status: after.status, returnReason: after.returnReason },
      })
    },
    client,
  )
}

/**
 * Starts a correction. The amendment is a **copy** of the original's answers, status DRAFT, pointing
 * at the report it corrects — copying rather than referencing is what lets the office edit it without
 * touching the document that was already issued.
 *
 * It is submitted through the same path as any other report (`submitAmendment`), so nothing about the
 * amendment escapes the validation the original went through.
 */
export async function amendReport(
  context: AuthContext,
  raw: unknown,
  client?: Tx,
): Promise<{ amendmentId: string; reportId: string }> {
  assertCan(context, 'report.amend')
  const input = parseInput(amendReportSchema, raw)

  return withAudit(
    context,
    async (tx, log) => {
      const original = await tx.report.findFirst({
        where: { id: input.reportId, ...reportReadWhere(context) },
        include: { amendments: { select: { id: true, status: true } } },
      })
      if (!original) throw new NotFoundError('No such report.')

      if (original.status !== 'APPROVED') {
        throw new RuleError('Only an issued report is corrected by amendment.')
      }
      // At most one live amendment: a second open correction of the same report is two people fixing
      // the same thing, and whichever was approved second would silently win.
      if (original.amendments.some((entry) => entry.status !== 'AMENDED')) {
        throw new RuleError('An amendment of this report is already open.')
      }

      const amendment = await tx.report.create({
        data: {
          jobId: original.jobId,
          craneId: original.craneId,
          templateId: original.templateId,
          templateVersion: original.templateVersion,
          data: original.data as Prisma.InputJsonValue,
          status: 'DRAFT',
          technicianSignedById: original.technicianSignedById,
          technicianSignerName: original.technicianSignerName,
          technicianSignedAt: original.technicianSignedAt,
          technicianSignatureFileId: original.technicianSignatureFileId,
          customerSignerName: original.customerSignerName,
          customerSignerDesignation: original.customerSignerDesignation,
          customerSignedAt: original.customerSignedAt,
          customerSignatureFileId: original.customerSignatureFileId,
          customerDeclinedReason: original.customerDeclinedReason,
          safeToOperate: original.safeToOperate,
          amendmentOfId: original.id,
          amendmentReason: input.reason,
          createdById: context.userId,
        },
      })
      await log({
        entity: 'Report',
        entityId: amendment.id,
        action: 'CREATE',
        after: {
          amendmentOfId: original.id,
          amendmentReason: amendment.amendmentReason,
          documentNumber: null,
        },
      })

      return { amendmentId: amendment.id, reportId: original.id }
    },
    client,
  )
}

/**
 * Submits an amendment for approval. The answers were copied, not re-entered, so this is the office
 * confirming the correction — it does not ask a technician to sign the same visit twice.
 */
export async function submitAmendment(
  context: AuthContext,
  reportId: string,
  client?: Tx,
): Promise<void> {
  assertCan(context, 'report.amend')

  await withAudit(
    context,
    async (tx, log) => {
      const report = await tx.report.findFirst({
        where: { id: reportId, ...reportReadWhere(context) },
        select: { id: true, status: true, amendmentOfId: true },
      })
      if (!report) throw new NotFoundError('No such report.')
      if (!report.amendmentOfId) throw new RuleError('That report is not an amendment.')
      if (report.status !== 'DRAFT') throw new RuleError('That amendment has already been submitted.')

      const after = await tx.report.update({
        where: { id: report.id },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      })
      await log({
        entity: 'Report',
        entityId: report.id,
        action: 'UPDATE',
        before: { status: report.status },
        after: { status: after.status },
      })
    },
    client,
  )
}

export interface QueueRow {
  id: string
  status: 'SUBMITTED' | 'RETURNED'
  submittedAt: Date | null
  safeToOperate: string | null
  jobNumber: string
  jobId: string
  craneTag: string
  customerName: string
  jobTypeName: string
  technicianName: string | null
}

/**
 * What the office has to decide about. Submitted first (oldest first, because a customer is waiting),
 * then what was sent back so it can be chased.
 */
export async function reportsQueue(context: AuthContext): Promise<QueueRow[]> {
  assertCan(context, 'report.approve')

  const rows = await db.report.findMany({
    where: {
      ...reportReadWhere(context),
      status: { in: ['SUBMITTED', 'RETURNED'] },
    },
    orderBy: [{ status: 'asc' }, { submittedAt: 'asc' }],
    take: 200,
    select: {
      id: true,
      status: true,
      submittedAt: true,
      safeToOperate: true,
      technicianSignerName: true,
      job: {
        select: {
          id: true,
          number: true,
          jobType: { select: { name: true } },
          customer: { select: { legalName: true, tradingName: true } },
        },
      },
      crane: { select: { assetTag: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    status: row.status as 'SUBMITTED' | 'RETURNED',
    submittedAt: row.submittedAt,
    safeToOperate: row.safeToOperate,
    jobNumber: row.job.number,
    jobId: row.job.id,
    craneTag: row.crane.assetTag,
    customerName: row.job.customer.tradingName ?? row.job.customer.legalName,
    jobTypeName: row.job.jobType.name,
    technicianName: row.technicianSignerName,
  }))
}

/** One report with everything its screen needs, or a 404 the caller cannot tell from "not yours". */
export async function getReport(context: AuthContext, reportId: string) {
  if (
    !can(context.role, 'report.read.all') &&
    !can(context.role, 'report.read.own') &&
    !context.customerId
  ) {
    throw new ForbiddenError()
  }

  const report = await db.report.findFirst({
    where: { id: reportId, ...reportReadWhere(context) },
    include: {
      template: { select: { name: true, version: true, schema: true } },
      crane: { select: { id: true, assetTag: true, swlKg: true } },
      findings: true,
      amendmentOf: { select: { id: true, documentNumber: true, status: true } },
      amendments: { select: { id: true, status: true, documentNumber: true } },
      job: {
        select: {
          id: true,
          number: true,
          status: true,
          jobType: { select: { name: true } },
          customer: { select: { id: true, legalName: true, tradingName: true } },
        },
      },
    },
  })
  if (!report) throw new NotFoundError('No such report.')
  return report
}

/**
 * A short-lived link to the issued PDF, or null when there is not one yet.
 *
 * Looked up through the report rather than taking a file id from the caller, so a URL to anybody
 * else's document cannot be requested by guessing. Reads are scoped the same way every other read is.
 */
export async function issuedPdfUrl(
  context: AuthContext,
  reportId: string,
): Promise<string | null> {
  const report = await db.report.findFirst({
    where: { id: reportId, ...reportReadWhere(context) },
    select: { pdfFileId: true },
  })
  if (!report?.pdfFileId) return null

  const file = await db.file.findUnique({
    where: { id: report.pdfFileId },
    select: { storageKey: true },
  })
  if (!file) return null

  try {
    const url = await storage().signedDownloadUrl(file.storageKey)
    // Supabase returns an absolute URL; the disk driver returns a path. Relative is fine in a page.
    return url
  } catch {
    return null
  }
}

/** Every report on a crane, newest first — the crane timeline (brief §5). */
export async function craneReportTimeline(context: AuthContext, craneId: string) {
  if (!can(context.role, 'report.read.all') && !context.customerId) {
    return []
  }
  return db.report.findMany({
    where: { craneId, ...reportReadWhere(context) },
    orderBy: [{ approvedAt: 'desc' }, { submittedAt: 'desc' }, { createdAt: 'desc' }],
    take: 100,
    select: {
      id: true,
      status: true,
      documentNumber: true,
      submittedAt: true,
      approvedAt: true,
      safeToOperate: true,
      amendmentOfId: true,
      job: { select: { id: true, number: true, jobType: { select: { name: true } } } },
    },
  })
}
