import type { Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { ForbiddenError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import {
  certificateReadWhere,
  customerReadWhere,
  jobReadWhere,
  reportReadWhere,
} from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'

/**
 * The customer portal's read layer (slice 31).
 *
 * It adds no new queries for anything the office already reads: every portal page calls the *same*
 * service the office calls — `listCranes`, `listCertificates`, `craneReportTimeline`,
 * `issuedPdfUrl` — and the `customerId` branches in scope.ts decide what comes back. That is the
 * whole design. A second query written only for the portal is a second place for the scoping rule
 * to be got wrong, and the one an audit is least likely to open.
 *
 * The jobs list is the exception, and only because `listJobs` is gated on `job.read.all` — the
 * company-wide list. A customer is scoped to their own jobs by `jobReadWhere`, exactly as a
 * technician's list is, so it reads directly.
 *
 * `portal.read` is the capability. It exists so the portal shell has one thing to consent to, and
 * so a future "portal off for this account" is a capability change rather than a role change.
 */

export interface PortalJob {
  id: string
  number: string
  status: string
  priority: string
  jobTypeName: string
  siteName: string | null
  cranes: string[]
  raisedAt: Date | null
  visitAt: Date | null
  completedAt: Date | null
}

export interface PortalSummary {
  customerName: string
  /** Jobs not yet finished — what the customer is waiting on. */
  openJobs: number
  cranes: number
  /** Certificates already lapsed or lapsing within the 90-day window. */
  certificatesDueSoon: number
  /** The most recent work, for the overview. */
  recent: PortalJob[]
}

/**
 * The account this login belongs to.
 *
 * A CUSTOMER login with no `customerId` is refused rather than scoped to everything: that is the
 * fail-closed rule the scope filters already apply, said once at the edge so a page does not have to
 * remember it.
 */
export function requirePortalCustomer(context: AuthContext): string {
  assertCan(context, 'portal.read')
  if (!context.customerId) {
    throw new ForbiddenError('This account is not linked to a customer.')
  }
  return context.customerId
}

/** Statuses where the work is over and the customer is no longer waiting on it. */
const FINISHED = ['COMPLETED', 'REVIEWED', 'INVOICED', 'CLOSED', 'CANCELLED'] as const

const portalJobSelect = {
  id: true,
  number: true,
  status: true,
  priority: true,
  reportedAt: true,
  scheduledStart: true,
  completedAt: true,
  jobType: { select: { name: true } },
  site: { select: { name: true } },
  cranes: {
    select: { crane: { select: { assetTag: true } } },
    orderBy: { crane: { assetTag: 'asc' } },
  },
} satisfies Prisma.JobSelect

type PortalJobRow = Prisma.JobGetPayload<{ select: typeof portalJobSelect }>

function toPortalJob(row: PortalJobRow): PortalJob {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    priority: row.priority,
    jobTypeName: row.jobType.name,
    siteName: row.site?.name ?? null,
    cranes: row.cranes.map((entry) => entry.crane.assetTag),
    raisedAt: row.reportedAt,
    visitAt: row.scheduledStart,
    completedAt: row.completedAt,
  }
}

/**
 * This customer's jobs, newest first. `activeOnly` is the overview's "what am I waiting on"; the
 * customer never needs the archive of closed work to be paginated here — a warm account has tens of
 * jobs, not thousands, and a cap keeps the page honest either way.
 */
export async function portalJobs(
  context: AuthContext,
  options: { activeOnly?: boolean; take?: number } = {},
  client: Tx = db,
): Promise<PortalJob[]> {
  assertCan(context, 'portal.read')
  const rows = await client.job.findMany({
    where: {
      ...jobReadWhere(context),
      ...(options.activeOnly ? { status: { notIn: [...FINISHED] } } : {}),
    },
    select: portalJobSelect,
    orderBy: [{ reportedAt: 'desc' }, { number: 'desc' }],
    take: options.take ?? 50,
  })
  return rows.map(toPortalJob)
}

/** One job, if it belongs to this customer. `jobReadWhere` is the whole check. */
export async function portalJob(
  context: AuthContext,
  jobId: string,
  client: Tx = db,
): Promise<PortalJob | null> {
  assertCan(context, 'portal.read')
  const row = await client.job.findFirst({
    where: { id: jobId, ...jobReadWhere(context) },
    select: portalJobSelect,
  })
  return row ? toPortalJob(row) : null
}

/** An issued report, as the customer sees it. Only approved ones exist from here. */
export interface PortalReport {
  id: string
  documentNumber: string | null
  approvedAt: Date | null
  craneTag: string
  jobNumber: string
  jobId: string
  safeToOperate: string | null
}

/**
 * The reports a customer may read: approved (issued) ones on their own cranes, nothing else.
 *
 * `reportReadWhere` decides the rows — a CUSTOMER login is scoped to their cranes — but the *status*
 * filter is this function's own, because a technician's scope also reaches drafts and a customer
 * must never see a report the office has not signed off. A report in any other status has no
 * document number and no PDF, so showing it would be showing a customer an unfinished page.
 */
export async function portalReports(
  context: AuthContext,
  options: { jobId?: string; craneId?: string; take?: number } = {},
  client: Tx = db,
): Promise<PortalReport[]> {
  assertCan(context, 'portal.read')
  const rows = await client.report.findMany({
    where: {
      ...reportReadWhere(context),
      status: 'APPROVED',
      ...(options.jobId ? { jobId: options.jobId } : {}),
      ...(options.craneId ? { craneId: options.craneId } : {}),
    },
    select: {
      id: true,
      documentNumber: true,
      approvedAt: true,
      safeToOperate: true,
      crane: { select: { assetTag: true } },
      job: { select: { id: true, number: true } },
    },
    orderBy: [{ approvedAt: 'desc' }, { createdAt: 'desc' }],
    take: options.take ?? 100,
  })
  return rows.map((row) => ({
    id: row.id,
    documentNumber: row.documentNumber,
    approvedAt: row.approvedAt,
    safeToOperate: row.safeToOperate,
    craneTag: row.crane.assetTag,
    jobNumber: row.job.number,
    jobId: row.job.id,
  }))
}

/**
 * The overview numbers. Each one is counted through the same scoped read the list uses, so a tile
 * can never say four while the list behind it shows three.
 */
export async function portalSummary(
  context: AuthContext,
  now: Date = new Date(),
  client: Tx = db,
): Promise<PortalSummary> {
  const customerId = requirePortalCustomer(context)

  const [customer, openJobs, cranes, certificates, recent] = await Promise.all([
    client.customer.findFirst({
      where: { id: customerId, ...customerReadWhere(context) },
      select: { legalName: true, tradingName: true },
    }),
    client.job.count({ where: { ...jobReadWhere(context), status: { notIn: [...FINISHED] } } }),
    client.crane.count({ where: { customerId, deletedAt: null } }),
    // Counted through the same scope filter the certificate list uses, so the tile and the list
    // cannot disagree. The 90-day window is a date question, not a column.
    client.certificate.count({
      where: {
        ...certificateReadWhere(context),
        OR: [
          { expiryDate: { lte: addDays(now, 90) } },
          { expiryDate: null, nextDueDate: { lte: addDays(now, 90) } },
        ],
      },
    }),
    portalJobs(context, { take: 8 }, client),
  ])

  return {
    customerName: customer?.tradingName ?? customer?.legalName ?? 'Your account',
    openJobs,
    cranes,
    certificatesDueSoon: certificates,
    recent,
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}
