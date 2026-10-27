import type { AuditLog, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { Tx } from '@/lib/db'
import { addDays, wallTimeToUtc } from '@/lib/time'
import { assertCan } from '@/server/auth/permissions'
import type { AuthContext } from '@/server/auth/types'
import { changedFields } from './diff'

export { changedFields }

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE'

/** Who did it and from where. Built once per request by the context factory. */
export interface AuditContext {
  userId?: string | null
  ip?: string | null
  userAgent?: string | null
}

export interface AuditEntry {
  entity: string
  entityId: string
  action: AuditAction
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

export type AuditLogger = (entry: AuditEntry) => Promise<void>

/**
 * Runs a mutation and its audit row in one transaction: either both commit or neither does.
 * This is the only correct way to write business data (CLAUDE.md rule 6).
 *
 *   await withAudit(ctx, async (tx, log) => {
 *     const job = await tx.job.create({ data: input })
 *     await log({ entity: 'Job', entityId: job.id, action: 'CREATE', after: job })
 *     return job
 *   })
 *
 * Pass `client` when the caller already has a transaction open. The work then joins that transaction
 * instead of starting a second one, which keeps the whole operation atomic and lets a test run
 * everything inside `inRolledBackTx` and leave no rows behind.
 */
export async function withAudit<T>(
  context: AuditContext,
  fn: (tx: Tx, log: AuditLogger) => Promise<T>,
  client?: Tx,
): Promise<T> {
  const run = async (tx: Tx): Promise<T> => {
    const log: AuditLogger = async (entry) => {
      let { before, after } = entry

      // For updates, record only what changed — and skip the row entirely if nothing did.
      if (entry.action === 'UPDATE') {
        const narrowed = changedFields(before, after)
        if (!narrowed) return
        before = narrowed.before
        after = narrowed.after
      }

      const toJson = (value: Record<string, unknown> | null | undefined) =>
        value == null ? undefined : (value as unknown as Prisma.InputJsonValue)

      await tx.auditLog.create({
        data: {
          entity: entry.entity,
          entityId: entry.entityId,
          action: entry.action,
          before: toJson(before),
          after: toJson(after),
          userId: context.userId ?? undefined,
          ip: context.ip ?? undefined,
          userAgent: context.userAgent ?? undefined,
        },
      })
    }

    return fn(tx, log)
  }

  // 15s rather than Prisma's 5s default: these transactions are short, but the database may be in a
  // different region from the app, and a request that fails at five seconds because of latency rather
  // than a real problem is worse than one that waits.
  return client ? run(client) : db.$transaction(run, { timeout: 15_000, maxWait: 10_000 })
}

/**
 * Reads the trail for one record — powers the "who changed what" panel (brief §11).
 *
 * Takes the caller's identity like every other read in `src/server`, and for the same reason: the
 * trail holds a before/after snapshot of every record it covers, so which role may read it is a
 * permission question, not a UI question. `audit.read` is the answer, and it lives in the map with
 * everyone else's capabilities.
 */
export async function auditTrail(
  context: AuthContext,
  entity: string,
  entityId: string,
  limit = 50,
  client: Tx = db,
) {
  assertCan(context, 'audit.read')

  return client.auditLog.findMany({
    where: { entity, entityId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: { select: { id: true, name: true, email: true } } },
  })
}

export interface AuditSearch {
  entity?: string
  entityId?: string
  userId?: string
  /** `YYYY-MM-DD` wall dates, inclusive of both ends. */
  from?: string
  to?: string
  take?: number
}

/** The largest page the viewer will render. The audit log is append-only and grows forever. */
export const AUDIT_PAGE_SIZE = 100

/**
 * The cross-entity audit search behind the audit viewer (brief §11).
 *
 * Deliberately unfiltered by row scope: `audit.read` is the admin capability, and an administrator
 * who could see only their own entries would not have an audit log. The capability is the gate and
 * it is checked before any query runs.
 */
export async function searchAuditLog(
  context: AuthContext,
  filters: AuditSearch,
  timezone: string,
  client: Tx = db,
): Promise<{
  rows: Array<AuditLog & { user: { id: string; name: string; email: string } | null }>
  truncated: boolean
}> {
  assertCan(context, 'audit.read')

  const take = Math.min(filters.take ?? AUDIT_PAGE_SIZE, AUDIT_PAGE_SIZE)
  const createdAt = dateRange(filters.from, filters.to, timezone)

  const rows = await client.auditLog.findMany({
    where: {
      ...(filters.entity ? { entity: filters.entity } : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(createdAt ? { createdAt } : {}),
    },
    orderBy: { createdAt: 'desc' },
    // One more than asked for, so "there is more" is a fact rather than a guess.
    take: take + 1,
    include: { user: { select: { id: true, name: true, email: true } } },
  })

  return { rows: rows.slice(0, take), truncated: rows.length > take }
}

function dateRange(
  from: string | undefined,
  to: string | undefined,
  timezone: string,
): { gte?: Date; lt?: Date } | null {
  if (!from && !to) return null

  const startOf = (value: string): Date | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
    if (!match) return null
    return wallTimeToUtc(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0, timezone)
  }

  const gte = from ? startOf(from) : null
  const end = to ? startOf(to) : null
  // The `to` day counts in full, so the exclusive bound is midnight the following day.
  const lt = end ? addDays(end, 1) : null

  return {
    ...(gte ? { gte } : {}),
    ...(lt ? { lt } : {}),
  }
}

/** The entity names the services actually write, for the viewer's filter. Grep `entity: '` to check. */
export const AUDIT_ENTITIES = [
  'Customer',
  'Contact',
  'Site',
  'Crane',
  'Ticket',
  'Job',
  'Report',
  'Finding',
  'StockMovement',
  'Technician',
  'OnCallShift',
  'File',
  'User',
] as const

export type AuditLogRow = Awaited<ReturnType<typeof searchAuditLog>>['rows'][number]

export interface AuditEntityLabel {
  entity: string
  entityId: string
  label: string
  href: string | null
}

/** Where an audited record lives, for the viewer's link. Only entities with an office screen. */
const ENTITY_HREFS: Record<string, (id: string) => string> = {
  Job: (id) => `/jobs/${id}`,
  Crane: (id) => `/cranes/${id}`,
  Customer: (id) => `/customers/${id}`,
  Site: (id) => `/sites/${id}`,
  Ticket: (id) => `/tickets/${id}`,
  Report: (id) => `/reports/${id}`,
  User: (id) => `/admin/users/${id}`,
}

/**
 * Human labels for the rows an audit entry points at — `Crane 01J…` is not a useful viewer cell, and
 * an id is what an office user will read as "nothing". One query per entity type present, not one per
 * row, so a 100-row page costs at most seven lookups.
 */
export async function auditEntityLabels(
  context: AuthContext,
  rows: readonly { entity: string; entityId: string }[],
  client: Tx = db,
): Promise<Map<string, AuditEntityLabel>> {
  assertCan(context, 'audit.read')

  const idsFor = (entity: string) => [
    ...new Set(rows.filter((row) => row.entity === entity).map((row) => row.entityId)),
  ]
  const present = (entity: string) => rows.some((row) => row.entity === entity)

  const [jobs, cranes, customers, sites, tickets, reports, users] = await Promise.all([
    present('Job')
      ? client.job.findMany({ where: { id: { in: idsFor('Job') } }, select: { id: true, number: true } })
      : [],
    present('Crane')
      ? client.crane.findMany({
          where: { id: { in: idsFor('Crane') } },
          select: { id: true, assetTag: true },
        })
      : [],
    present('Customer')
      ? client.customer.findMany({
          where: { id: { in: idsFor('Customer') } },
          select: { id: true, legalName: true },
        })
      : [],
    present('Site')
      ? client.site.findMany({ where: { id: { in: idsFor('Site') } }, select: { id: true, name: true } })
      : [],
    present('Ticket')
      ? client.ticket.findMany({
          where: { id: { in: idsFor('Ticket') } },
          select: { id: true, number: true },
        })
      : [],
    present('Report')
      ? client.report.findMany({
          where: { id: { in: idsFor('Report') } },
          select: { id: true, documentNumber: true },
        })
      : [],
    present('User')
      ? client.user.findMany({
          where: { id: { in: idsFor('User') } },
          select: { id: true, name: true },
        })
      : [],
  ])

  const labels = new Map<string, AuditEntityLabel>()
  const put = (entity: string, id: string, label: string) =>
    labels.set(`${entity}:${id}`, {
      entity,
      entityId: id,
      label,
      href: ENTITY_HREFS[entity]?.(id) ?? null,
    })

  for (const row of jobs) put('Job', row.id, row.number)
  for (const row of cranes) put('Crane', row.id, row.assetTag)
  for (const row of customers) put('Customer', row.id, row.legalName)
  for (const row of sites) put('Site', row.id, row.name)
  for (const row of tickets) put('Ticket', row.id, row.number)
  // An unissued report has no number yet; its job is the only useful handle it has.
  for (const row of reports) put('Report', row.id, row.documentNumber ?? 'Draft report')
  for (const row of users) put('User', row.id, row.name)

  return labels
}
