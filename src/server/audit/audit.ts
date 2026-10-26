import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { Tx } from '@/lib/db'
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
 */
export async function withAudit<T>(
  context: AuditContext,
  fn: (tx: Tx, log: AuditLogger) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
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
  })
}

/** Reads the trail for one record — powers the "who changed what" panel (brief §11). */
export async function auditTrail(entity: string, entityId: string, limit = 50) {
  return db.auditLog.findMany({
    where: { entity, entityId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: { select: { id: true, name: true, email: true } } },
  })
}
