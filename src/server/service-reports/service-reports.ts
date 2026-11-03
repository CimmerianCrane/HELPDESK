import { createHash, randomUUID } from 'node:crypto'
import type { CraneType, Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { CRANE_TYPE_LABELS } from '@/lib/cranes/labels'
import { parseInput } from '@/lib/validation/parse'
import {
  buildServiceReportContent,
  serviceReportContentSchema,
  updateServiceReportSchema,
  type ServiceReportContent,
} from '@/lib/validation/service-report'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError } from '@/server/auth/errors'
import { assertCan, can } from '@/server/auth/permissions'
import { jobReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { nextServiceReportNumber } from '@/server/documents/sequence'
import { renderServiceReportPdf } from '@/server/documents/service-report'
import { getSettings } from '@/server/settings/settings'
import { storage } from '@/server/storage/storage'

/**
 * The Service Report for a site visit (slice 39).
 *
 * One per job. It is built from the visit's graded checklists — one `Report` per crane, each with a
 * 1–4 rating and a comment on every answered line — into prose the customer files, and the office may
 * reword any sentence before approving. On approval it takes the visit's `SR<yy><mm><nnn>` number and
 * its PDF is stored; after that it is immutable, like every issued document (CLAUDE.md rules 4 and 5).
 *
 * **Why a job-level row and not a Report.** A report is signed against one crane and has a signature
 * of its own. A Service Report covers every crane on the job, is built from the checklists rather
 * than typed, and its prose is editable until approval — three differences that would have made one
 * table serve two documents badly. See `docs/PLAN-SLICES.md` §7.25.
 */

export interface ServiceReportParagraphView {
  component: string
  grade: number | null
  comment: string | null
  text: string
}

export interface ServiceReportCraneView {
  craneId: string
  assetTag: string
  type: string | null
  paragraphs: ServiceReportParagraphView[]
}

export interface ServiceReportView {
  id: string | null
  jobId: string
  status: 'DRAFT' | 'APPROVED'
  documentNumber: string | null
  approvedAt: Date | null
  cranes: ServiceReportCraneView[]
  /** Cranes on the job with no graded checklist yet — the office needs to see what is still missing. */
  missingCranes: Array<{ craneId: string; assetTag: string }>
}

function isServiceJob(jobType: { isServiceReport: boolean } | null): boolean {
  return jobType?.isServiceReport === true
}

/**
 * The job and every graded checklist on it, narrowed to the caller's scope.
 *
 * `assertCan(context, 'report.read.all')` and not a new capability: a Service Report is made of the
 * reports it summarises, so whoever may read the visit's reports may read what they became. The
 * technician who filled the forms does not read the issued prose back through this screen — their
 * record is the checklist they signed.
 */
async function loadJob(context: AuthContext, jobId: string, client: Tx) {
  const job = await client.job.findFirst({
    where: { id: jobId, ...jobReadWhere(context) },
    select: {
      id: true,
      number: true,
      customerId: true,
      jobType: { select: { isServiceReport: true } },
      customer: { select: { legalName: true, tradingName: true } },
      site: { select: { name: true, address: true } },
      cranes: {
        select: {
          crane: {
            select: {
              id: true,
              assetTag: true,
              type: true,
              reports: {
                where: { status: { in: ['SUBMITTED', 'APPROVED', 'AMENDED'] } },
                orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
                select: { data: true },
              },
            },
          },
        },
      },
      serviceReport: {
        select: {
          id: true,
          status: true,
          content: true,
          documentNumber: true,
          approvedAt: true,
        },
      },
    },
  })
  if (!job) throw new NotFoundError('No such job.')
  return job
}

function addressLines(address: unknown): string[] {
  if (!address || typeof address !== 'object') return []
  return Object.values(address as Record<string, unknown>).filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  )
}

/**
 * The Service Report for a job, as it stands: the approved document if there is one, otherwise the
 * draft built from the checklists on file. A job that is not a Service Report has none.
 */
export async function serviceReportForJob(
  context: AuthContext,
  jobId: string,
  client: Tx = db,
): Promise<ServiceReportView | null> {
  assertCan(context, 'report.read.all')
  const job = await loadJob(context, jobId, client)
  if (!isServiceJob(job.jobType)) return null

  const missingCranes: Array<{ craneId: string; assetTag: string }> = []
  const graded = job.cranes.flatMap(({ crane }) => {
    // A crane's checklist may be re-submitted after a return; the newest submitted one is the record.
    const latest = crane.reports[0]
    if (!latest) {
      missingCranes.push({ craneId: crane.id, assetTag: crane.assetTag })
      return []
    }
    return [{ craneId: crane.id, assetTag: crane.assetTag, type: CRANE_TYPE_LABELS[crane.type], data: latest.data }]
  })

  const built = buildServiceReportContent(graded).cranes
  if (built.length === 0) missingCranes.push(...graded.map(({ craneId, assetTag }) => ({ craneId, assetTag })))

  // An approved document is the record; the checklists are history. Never rebuild over it.
  const stored = job.serviceReport
  const content = stored ? serviceReportContentSchema.safeParse(stored.content) : null

  return {
    id: stored?.id ?? null,
    jobId: job.id,
    status: stored?.status ?? 'DRAFT',
    documentNumber: stored?.documentNumber ?? null,
    approvedAt: stored?.approvedAt ?? null,
    cranes: content?.success ? content.data.cranes : built,
    missingCranes,
  }
}

/**
 * Writes (or rewrites) the draft the office is editing.
 *
 * Generated on first sight from the checklists, then the office's own words. Rewriting a draft is
 * allowed; rewriting an approved one is not — that is what an amendment is for, and this document has
 * no amendment path yet, so it refuses rather than pretending.
 */
export async function saveServiceReport(
  context: AuthContext,
  jobId: string,
  raw: unknown,
  client?: Tx,
): Promise<{ id: string }> {
  assertCan(context, 'report.approve')
  const input = parseInput(updateServiceReportSchema, raw)

  return withAudit(
    context,
    async (tx, log) => {
      const job = await loadJob(context, jobId, tx)
      if (!isServiceJob(job.jobType)) {
        throw new RuleError('This job type does not issue a Service Report.')
      }
      if (job.serviceReport?.status === 'APPROVED') {
        throw new RuleError('This Service Report has been issued and cannot be edited.')
      }

      const content = editableContent(job.cranes, input.content)
      const row = job.serviceReport
        ? await tx.serviceReport.update({
            where: { id: job.serviceReport.id },
            data: { content: content as Prisma.InputJsonValue },
          })
        : await tx.serviceReport.create({
            data: { jobId, content: content as Prisma.InputJsonValue, status: 'DRAFT' },
          })

      await log({
        entity: 'ServiceReport',
        entityId: row.id,
        action: job.serviceReport ? 'UPDATE' : 'CREATE',
        before: job.serviceReport ? { content: job.serviceReport.content } : null,
        after: { content: row.content },
      })
      return { id: row.id }
    },
    client,
  )
}

/**
 * The office may reword a sentence, never rename a crane or invent one.
 *
 * The form posts the crane's asset tag and type as blanks on purpose: those are facts about the job,
 * so they are re-read here from the job's own cranes and the incoming words are kept only for the
 * cranes that are actually on it. A crane id that is not on the job drops its paragraphs.
 */
function editableContent(
  jobCranes: Array<{ crane: { id: string; assetTag: string; type: CraneType } }>,
  input: ServiceReportContent,
): ServiceReportContent {
  const byId = new Map(jobCranes.map(({ crane }) => [crane.id, crane]))
  const cranes = input.cranes.flatMap((crane) => {
    const actual = byId.get(crane.craneId)
    if (!actual) return []
    return [
      {
        craneId: actual.id,
        assetTag: actual.assetTag,
        type: CRANE_TYPE_LABELS[actual.type],
        paragraphs: crane.paragraphs,
      },
    ]
  })
  return serviceReportContentSchema.parse({ cranes })
}

export interface ServiceReportApproval {
  id: string
  documentNumber: string
  pdfFileId: string
}

/**
 * Issues the Service Report: its SR number, its PDF, and the lock.
 *
 * The number is issued here, in the approval month, which is the rule the office uses for every
 * numbered document. Nothing else moves: the job's lifecycle is driven by the per-crane reports
 * (`approveReport`), and a Service Report summarises work that has already been reviewed.
 */
export async function approveServiceReport(
  context: AuthContext,
  jobId: string,
  client?: Tx,
): Promise<ServiceReportApproval> {
  assertCan(context, 'report.approve')

  return withAudit(
    context,
    async (tx, log) => {
      const job = await loadJob(context, jobId, tx)
      if (!isServiceJob(job.jobType)) {
        throw new RuleError('This job type does not issue a Service Report.')
      }
      if (job.serviceReport?.status === 'APPROVED') {
        throw new RuleError(`This Service Report was issued as ${job.serviceReport.documentNumber}.`)
      }

      const missing = job.cranes.filter(({ crane }) => {
        const latest = crane.reports[0]
        return !latest
      })
      if (missing.length > 0) {
        throw new RuleError(
          `Grade the checklist for ${missing.map((entry) => entry.crane.assetTag).join(', ')} first.`,
        )
      }

      const content = job.serviceReport
        ? serviceReportContentSchema.parse(job.serviceReport.content)
        : buildServiceReportContent(
            job.cranes.map(({ crane }) => ({
              craneId: crane.id,
              assetTag: crane.assetTag,
              type: CRANE_TYPE_LABELS[crane.type],
              data: crane.reports[0]!.data,
            })),
          )
      if (content.cranes.length === 0) {
        throw new RuleError('There is nothing graded to put on a Service Report yet.')
      }

      const settings = await getSettings(tx)
      const approvedAt = new Date()
      const documentNumber = await nextServiceReportNumber(tx, {
        at: approvedAt,
        timeZone: settings.timezone,
      })

      const pdf = await renderServiceReportPdf({
        documentNumber,
        content,
        issuedAt: approvedAt,
        timeZone: settings.timezone,
        job: { number: job.number },
        customer: {
          name: job.customer.tradingName ?? job.customer.legalName,
          siteName: job.site.name,
          siteAddress: addressLines(job.site.address),
        },
      })

      const pdfFileId = randomUUID()
      const storageKey = `service-reports/${jobId}/${pdfFileId}.pdf`
      await storage().put(storageKey, new Uint8Array(pdf), 'application/pdf')

      const file = await tx.file.create({
        data: {
          id: pdfFileId,
          entity: 'ServiceReport',
          entityId: job.serviceReport?.id ?? jobId,
          kind: 'REPORT_PDF',
          filename: `${documentNumber}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: pdf.byteLength,
          storageKey,
          sha256: createHash('sha256').update(pdf).digest('hex'),
          uploadedById: context.userId,
          jobId,
        },
      })
      await log({ entity: 'File', entityId: file.id, action: 'CREATE', after: file })

      const row = job.serviceReport
        ? await tx.serviceReport.update({
            where: { id: job.serviceReport.id },
            data: {
              status: 'APPROVED',
              content: content as Prisma.InputJsonValue,
              documentNumber,
              pdfFileId,
              approvedAt,
              approvedById: context.userId,
            },
          })
        : await tx.serviceReport.create({
            data: {
              jobId,
              status: 'APPROVED',
              content: content as Prisma.InputJsonValue,
              documentNumber,
              pdfFileId,
              approvedAt,
              approvedById: context.userId,
            },
          })

      await log({
        entity: 'ServiceReport',
        entityId: row.id,
        action: job.serviceReport ? 'UPDATE' : 'CREATE',
        before: job.serviceReport ? { status: job.serviceReport.status } : null,
        after: { status: row.status, documentNumber: row.documentNumber, pdfFileId: row.pdfFileId },
      })

      return { id: row.id, documentNumber, pdfFileId }
    },
    client,
  )
}

/** The issued PDF's link, or null while the document is still a draft. */
export async function serviceReportPdfUrl(
  context: AuthContext,
  jobId: string,
): Promise<string | null> {
  if (!can(context.role, 'report.read.all')) return null
  const row = await db.serviceReport.findFirst({
    where: { jobId, job: { ...jobReadWhere(context) }, pdfFileId: { not: null } },
    select: { pdfFileId: true },
  })
  if (!row?.pdfFileId) return null

  const file = await db.file.findUnique({
    where: { id: row.pdfFileId },
    select: { storageKey: true },
  })
  if (!file) return null
  try {
    return await storage().signedDownloadUrl(file.storageKey)
  } catch {
    return null
  }
}
