import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import type { Tx } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import { withAudit } from '@/server/audit/audit'
import { isAppError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import type { AuthContext } from '@/server/auth/types'
import { applyReport, type ReportSummary } from '@/server/reports/reports'

/**
 * The phone's outbox, applied by the server (slice 8).
 *
 * Every queued mutation carries an id the phone generated before it went offline. The receipt and
 * the data it describes are written in one transaction, so a retry that the phone could not confirm
 * is a no-op: the second call finds the receipt and returns the first result instead of creating a
 * second report. This is the whole reason the id is client-generated.
 */

export const syncRequestSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        kind: z.literal('report.submit'),
        // A record, not `z.unknown()`: an unknown-typed key is inferred as optional.
        payload: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1)
    .max(20),
})

export interface OutboxItem {
  id: string
  kind: 'report.submit'
  payload: unknown
}

export interface OutboxResult {
  id: string
  ok: boolean
  result?: ReportSummary
  error?: string
}

export function parseSyncRequest(raw: unknown): { items: OutboxItem[] } {
  return parseInput(syncRequestSchema, raw)
}

export async function applyTechSync(
  context: AuthContext,
  items: OutboxItem[],
  client?: Tx,
): Promise<OutboxResult[]> {
  assertCan(context, 'report.submit')

  const results: OutboxResult[] = []
  for (const item of items) {
    try {
      const summary = await withAudit(
        context,
        async (tx, log) => {
          const receipt = await tx.syncReceipt.findUnique({
            where: { id: item.id },
            select: { resultSummary: true },
          })
          if (receipt) {
            return receipt.resultSummary as unknown as ReportSummary
          }

          const applied = await applyReport(context, tx, item.payload, log)
          await tx.syncReceipt.create({
            data: {
              id: item.id,
              userId: context.userId,
              endpoint: 'report.submit',
              resultSummary: applied as unknown as Prisma.InputJsonValue,
            },
          })
          return applied
        },
        client,
      )

      results.push({ id: item.id, ok: true, result: summary })
    } catch (error) {
      // One bad report must not hold up the next one. Each item has its own transaction, so the
      // phone can retry only what failed.
      if (isAppError(error)) {
        results.push({ id: item.id, ok: false, error: error.message })
        continue
      }
      throw error
    }
  }

  return results
}
