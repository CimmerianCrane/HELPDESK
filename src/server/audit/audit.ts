import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { Tx } from '@/lib/db'
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
) {
  assertCan(context, 'audit.read')

  return db.auditLog.findMany({
    where: { entity, entityId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: { select: { id: true, name: true, email: true } } },
  })
}
