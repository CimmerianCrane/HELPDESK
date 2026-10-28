import type { CraneType, Prisma, ScheduleType } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import {
  createComplianceRuleSchema,
  isRuleInForce,
  updateComplianceRuleSchema,
} from '@/lib/validation/compliance'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import type { AuthContext } from '@/server/auth/types'

/**
 * Compliance rules (brief §7, slice 14). **Configuration, never code.**
 *
 * This file holds no regulatory fact: every interval, every "an AE is required" and every citation
 * is a row an administrator typed and the audit log names them for. The reason the model insists on
 * `sourceReference` and `reviewedAt` is so a question about a crane can be answered with "because of
 * this circular, reviewed on this date" rather than "because the app says so".
 *
 * **Both capabilities are real and different.** The admin screen — every rule, including the ones
 * that have stopped applying — needs `compliancerule.manage`, because it is the configuration itself.
 * A dispatcher configuring a crane's obligations only needs to see the rules in force for that kind
 * of crane, so `rulesForCraneType` asks for `schedule.manage`: they can adopt a rule without being
 * able to write one.
 */

export interface ComplianceRuleSummary {
  id: string
  craneType: CraneType
  scheduleType: ScheduleType
  intervalMonths: number | null
  requiresAE: boolean
  isActive: boolean
  effectiveFrom: Date | null
  effectiveTo: Date | null
  sourceReference: string
  reviewedAt: Date | null
  notes: string | null
  /** In force today, by `isRuleInForce`. Computed on read — nothing stores it. */
  inForce: boolean
  /** Live schedules currently based on this rule. Says what deactivating it would strand. */
  adoptedCount: number
}

const ruleSelect = {
  id: true,
  craneType: true,
  scheduleType: true,
  intervalMonths: true,
  requiresAE: true,
  isActive: true,
  effectiveFrom: true,
  effectiveTo: true,
  sourceReference: true,
  reviewedAt: true,
  notes: true,
} satisfies Prisma.ComplianceRuleSelect

type RuleRow = Prisma.ComplianceRuleGetPayload<{ select: typeof ruleSelect }>

function toSummary(row: RuleRow, adoptedCount: number, now: Date): ComplianceRuleSummary {
  return { ...row, inForce: isRuleInForce(row, now), adoptedCount }
}

/** How many live schedules each rule is behind, in one query rather than one per row. */
async function adoptedCounts(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx.craneSchedule.groupBy({
    by: ['ruleId'],
    where: { deletedAt: null, ruleId: { not: null } },
    _count: { _all: true },
  })
  return new Map(rows.map((row) => [row.ruleId as string, row._count._all]))
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every rule, for the administrator's screen. Superseded rules stay — that is the point of them. */
export async function listComplianceRules(
  context: AuthContext,
  client: Tx = db,
  now: Date = new Date(),
): Promise<ComplianceRuleSummary[]> {
  assertCan(context, 'compliancerule.manage')

  const [rows, counts] = await Promise.all([
    client.complianceRule.findMany({
      select: ruleSelect,
      orderBy: [{ craneType: 'asc' }, { scheduleType: 'asc' }, { effectiveFrom: 'desc' }],
    }),
    adoptedCounts(client),
  ])

  return rows.map((row) => toSummary(row, counts.get(row.id) ?? 0, now))
}

/**
 * The rules in force for one kind of crane, for the schedule form's "base this on a rule" select.
 * Only in-force rules are offered: adopting a superseded circular would be recording the wrong
 * obligation and there is nothing on screen that would say so.
 */
export async function rulesForCraneType(
  context: AuthContext,
  craneType: CraneType,
  client: Tx = db,
  now: Date = new Date(),
): Promise<ComplianceRuleSummary[]> {
  assertCan(context, 'schedule.manage')

  const rows = await client.complianceRule.findMany({
    where: { craneType, isActive: true },
    select: ruleSelect,
    orderBy: [{ scheduleType: 'asc' }, { effectiveFrom: 'desc' }],
  })
  return rows
    .filter((row) => isRuleInForce(row, now))
    .map((row) => toSummary(row, 0, now))
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * A second rule in force for the same crane type and kind of obligation is two answers to one
 * question, and `CraneSchedule.ruleId` would then record whichever was adopted first. Superseding a
 * rule means ending the old one (`effectiveTo`, or untick *In force*) — never leaving both live.
 */
function findOverlap(
  rows: { id: string; effectiveFrom: Date | null; effectiveTo: Date | null; sourceReference: string }[],
  candidate: { id?: string; effectiveFrom: Date | null; effectiveTo: Date | null },
) {
  const from = candidate.effectiveFrom?.getTime() ?? Number.NEGATIVE_INFINITY
  const to = candidate.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY

  return rows.find((row) => {
    if (row.id === candidate.id) return false
    const rowFrom = row.effectiveFrom?.getTime() ?? Number.NEGATIVE_INFINITY
    const rowTo = row.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY
    return rowFrom <= to && from <= rowTo
  })
}

async function assertNoOverlap(
  tx: Tx,
  input: {
    id?: string
    craneType: CraneType
    scheduleType: ScheduleType
    isActive: boolean
    effectiveFrom: Date | null
    effectiveTo: Date | null
  },
) {
  if (!input.isActive) return

  const live = await tx.complianceRule.findMany({
    where: { craneType: input.craneType, scheduleType: input.scheduleType, isActive: true },
    select: { id: true, effectiveFrom: true, effectiveTo: true, sourceReference: true },
  })
  const clash = findOverlap(live, input)
  if (clash) {
    throw new RuleError(
      `“${clash.sourceReference}” already covers this crane type and obligation for those dates. End that rule (give it an end date, or untick In force) before adding the one that replaces it — keeping both in force means the app cannot say which applies.`,
    )
  }
}

export async function createComplianceRule(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<ComplianceRuleSummary> {
  assertCan(context, 'compliancerule.manage')
  const input = parseInput(createComplianceRuleSchema, raw)

  const created = await withAudit(
    context,
    async (tx, log) => {
      await assertNoOverlap(tx, { ...input })

      const row = await tx.complianceRule.create({
        data: {
          craneType: input.craneType,
          scheduleType: input.scheduleType,
          intervalMonths: input.intervalMonths,
          requiresAE: input.requiresAE,
          isActive: input.isActive,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo,
          sourceReference: input.sourceReference,
          reviewedAt: input.reviewedAt,
          reviewedById: context.userId,
          notes: input.notes,
        },
        select: ruleSelect,
      })
      await log({ entity: 'ComplianceRule', entityId: row.id, action: 'CREATE', after: auditShape(row) })
      return row
    },
    client,
  )

  return toSummary(created, 0, new Date())
}

export async function updateComplianceRule(
  context: AuthContext,
  ruleId: string,
  raw: unknown,
  client: Tx = db,
): Promise<ComplianceRuleSummary> {
  assertCan(context, 'compliancerule.manage')
  const input = parseInput(updateComplianceRuleSchema, raw)

  const updated = await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.complianceRule.findUnique({ where: { id: ruleId }, select: ruleSelect })
      if (!before) throw new NotFoundError('No such rule.')

      await assertNoOverlap(tx, { id: ruleId, ...input })

      const row = await tx.complianceRule.update({
        where: { id: ruleId },
        data: {
          craneType: input.craneType,
          scheduleType: input.scheduleType,
          intervalMonths: input.intervalMonths,
          requiresAE: input.requiresAE,
          isActive: input.isActive,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo,
          sourceReference: input.sourceReference,
          reviewedAt: input.reviewedAt,
          // Re-reviewing is an edit; `reviewedById` follows whoever last signed it off.
          reviewedById: context.userId,
          notes: input.notes,
        },
        select: ruleSelect,
      })

      await log({
        entity: 'ComplianceRule',
        entityId: ruleId,
        action: 'UPDATE',
        before: auditShape(before),
        after: auditShape(row),
      })
      return row
    },
    client,
  )

  const counts = await adoptedCounts(client)
  return toSummary(updated, counts.get(ruleId) ?? 0, new Date())
}

/**
 * The columns an audit row records. `requiresAE` is the one that decides whether a crane is waiting
 * on an Authorised Examiner or on us, so a change to it is a fact worth reading years later.
 */
function auditShape(row: RuleRow): Record<string, unknown> {
  return {
    craneType: row.craneType,
    scheduleType: row.scheduleType,
    intervalMonths: row.intervalMonths,
    requiresAE: row.requiresAE,
    isActive: row.isActive,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    sourceReference: row.sourceReference,
    reviewedAt: row.reviewedAt,
    notes: row.notes,
  }
}
