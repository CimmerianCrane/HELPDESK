import type { Priority, Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { companySlaSchema, companyTargetsFrom, type CompanyTarget } from '@/lib/validation/sla'
import { PRIORITIES } from '@/lib/validation/tickets'
import { parseInput } from '@/lib/validation/parse'
import { withAudit } from '@/server/audit/audit'
import { assertCan } from '@/server/auth/permissions'
import type { AuthContext } from '@/server/auth/types'

/**
 * Response and resolution targets, per priority (brief §4.3).
 *
 * The numbers live in `SlaPolicy` rows, editable by Admin and overridable per contract, because they
 * are contractual rather than technical. This module holds only the arithmetic; nothing here contains
 * a target that somebody negotiated.
 *
 * WHAT THE CLOCK MEASURES, AND WHAT IT DOES NOT:
 *   - Minutes are calendar minutes. There is no working-hours calendar and no public-holiday table.
 *     A P1 raised at 23:50 has thirty minutes, not "thirty minutes from 08:00 tomorrow". That is a
 *     deliberate Phase 1 simplification, recorded in docs/ASSUMPTIONS.md: it makes a target *harder*
 *     to meet, so it errs towards alerting too early rather than too late. Adding a working calendar
 *     later changes this module and nothing else.
 *   - A working timezone does not enter into it. The instant a clock starts and stops is absolute;
 *     the timezone only affects how the deadline is printed.
 */

export interface SlaTargets {
  responseMinutes: number
  resolutionMinutes: number
}

/**
 * Plausible Phase 1 defaults, seeded into `SlaPolicy`. Every one of them is a placeholder: the real
 * targets are per contract, and ASSUMPTIONS.md says so. They are ordered so that P1 is unambiguously
 * tighter than P2 and so on, which is the one property the defaults must have.
 */
export const DEFAULT_SLA_POLICIES: ReadonlyArray<{ priority: Priority } & SlaTargets> = [
  { priority: 'P1', responseMinutes: 30, resolutionMinutes: 240 },
  { priority: 'P2', responseMinutes: 120, resolutionMinutes: 480 },
  { priority: 'P3', responseMinutes: 480, resolutionMinutes: 2880 },
  { priority: 'P4', responseMinutes: 1440, resolutionMinutes: 7200 },
]

/** `met` — a responding timestamp is recorded. Otherwise the deadline decides. */
export type SlaState = 'met' | 'on-time' | 'at-risk' | 'breached'

/** Within this fraction of the window still remaining, a target is shown as at risk rather than on time. */
const AT_RISK_FRACTION = 0.2

export interface SlaWindow {
  /** When the clock started. Null if the thing has not started yet. */
  startedAt: Date | null
  targetMinutes: number
  /** When the response or resolution was actually recorded, if it was. */
  metAt: Date | null
}

export interface SlaResult {
  dueAt: Date | null
  state: SlaState
  /** Milliseconds until the deadline; zero once breached, null if there is no clock. */
  remainingMs: number | null
  /** How long the response took, or how long is left (negative when late). Null if not started. */
  elapsedMs: number | null
}

/** Adds minutes to an instant. Kept separate so a test can pin it without a database. */
export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * 60_000)
}

/**
 * The state of one SLA window at a given instant. Pure, so the arithmetic — which is where this kind
 * of thing goes wrong — is testable without a database or a clock.
 */
export function slaState(window: SlaWindow, now: Date): SlaResult {
  const { startedAt, targetMinutes, metAt } = window
  if (!startedAt) return { dueAt: null, state: 'on-time', remainingMs: null, elapsedMs: null }

  const dueAt = addMinutes(startedAt, targetMinutes)

  if (metAt) {
    const took = metAt.getTime() - startedAt.getTime()
    return {
      dueAt,
      // Meeting the target is measured against the deadline, not against how long it took: a
      // response recorded after the deadline is still a breach, even though it exists.
      state: metAt.getTime() <= dueAt.getTime() ? 'met' : 'breached',
      remainingMs: Math.max(0, dueAt.getTime() - now.getTime()),
      elapsedMs: took,
    }
  }

  const remainingMs = dueAt.getTime() - now.getTime()
  if (remainingMs <= 0) {
    return { dueAt, state: 'breached', remainingMs: 0, elapsedMs: remainingMs }
  }

  const state: SlaState =
    remainingMs <= targetMinutes * 60_000 * AT_RISK_FRACTION ? 'at-risk' : 'on-time'
  return { dueAt, state, remainingMs, elapsedMs: -remainingMs }
}

/** The full picture a ticket or job screen shows: response and, when relevant, resolution. */
export interface TicketSla {
  priority: Priority
  response: SlaResult
  resolution: SlaResult
  targets: SlaTargets
}

export function ticketSla(
  ticket: {
    priority: Priority
    reportedAt: Date
    respondedAt: Date | null
    closedAt: Date | null
  },
  targets: SlaTargets,
  now: Date,
): TicketSla {
  return {
    priority: ticket.priority,
    targets,
    response: slaState(
      { startedAt: ticket.reportedAt, targetMinutes: targets.responseMinutes, metAt: ticket.respondedAt },
      now,
    ),
    resolution: slaState(
      { startedAt: ticket.reportedAt, targetMinutes: targets.resolutionMinutes, metAt: ticket.closedAt },
      now,
    ),
  }
}

/**
 * The targets that apply to a priority: a contract override if the contract has one, else the
 * company-wide row. Falls back to the seeded default if no row exists at all, so a missing policy
 * produces a working timer rather than a blank one — but it is a fallback, not a second source of
 * truth.
 */
export async function resolveSlaTargets(
  priority: Priority,
  contractId: string | null = null,
  client: Tx = db,
): Promise<SlaTargets> {
  const rows = await client.slaPolicy.findMany({
    where: {
      priority,
      isActive: true,
      ...(contractId
        ? { OR: [{ contractId }, { contractId: null }] }
        : { contractId: null }),
    },
    select: { contractId: true, responseMinutes: true, resolutionMinutes: true },
  })

  // A contract-specific row wins over the company-wide one.
  const chosen = rows.find((row) => row.contractId === contractId) ?? rows.find((row) => !row.contractId)
  if (chosen) {
    return { responseMinutes: chosen.responseMinutes, resolutionMinutes: chosen.resolutionMinutes }
  }

  const fallback = DEFAULT_SLA_POLICIES.find((policy) => policy.priority === priority)
  return {
    responseMinutes: fallback?.responseMinutes ?? 480,
    resolutionMinutes: fallback?.resolutionMinutes ?? 2880,
  }
}

/**
 * Everyone who should be told about a P1. Dispatchers and administrators: the roles that can put a
 * technician on the road. Not technicians — they are told by dispatch, not by the intake board.
 */
export function isDispatcherRole(role: string): boolean {
  return role === 'DISPATCHER' || role === 'ADMIN'
}

/** Type guard for callers building a `SlaPolicy` row from the defaults above. */
export function slaPolicyRows(
  contractId: string | null = null,
): Array<Prisma.SlaPolicyCreateManyInput> {
  return DEFAULT_SLA_POLICIES.map((policy) => ({
    priority: policy.priority,
    contractId,
    responseMinutes: policy.responseMinutes,
    resolutionMinutes: policy.resolutionMinutes,
    isActive: true,
  }))
}

// ---------------------------------------------------------------------------
// The company-wide targets (slice 30)
// ---------------------------------------------------------------------------

export interface CompanySlaRow extends CompanyTarget {
  /** The `SlaPolicy` row's id, or null when no row exists yet and the fallback is being shown. */
  id: string | null
  /** True when this number is the code fallback rather than a row anybody configured. */
  isFallback: boolean
}

/**
 * The four company-wide targets, one per priority, in priority order.
 *
 * The read deliberately unions the rows with `DEFAULT_SLA_POLICIES` rather than calling
 * `resolveSlaTargets`: the screen has to *show* the fallback the app is actually using and say so,
 * or an administrator would edit a number while a different one was in force. `resolveSlaTargets`
 * answers "what applies"; this answers "what is configured, and what would apply if nothing were".
 *
 * Only `contractId: null` rows are read. Contract targets are the customer page's and are edited
 * there — showing them here would invite editing one customer's terms from the company screen.
 */
export async function getCompanySlaTargets(
  context: AuthContext,
  client: Tx = db,
): Promise<CompanySlaRow[]> {
  assertCan(context, 'sla.manage')

  const rows = await client.slaPolicy.findMany({
    where: { contractId: null, isActive: true },
    select: { id: true, priority: true, responseMinutes: true, resolutionMinutes: true },
  })
  const byPriority = new Map(rows.map((row) => [row.priority, row]))

  return PRIORITIES.map((priority) => {
    const row = byPriority.get(priority)
    const fallback = DEFAULT_SLA_POLICIES.find((policy) => policy.priority === priority)!
    return {
      priority,
      id: row?.id ?? null,
      isFallback: !row,
      responseMinutes: row?.responseMinutes ?? fallback.responseMinutes,
      resolutionMinutes: row?.resolutionMinutes ?? fallback.resolutionMinutes,
    }
  })
}

/**
 * Writes all four company-wide targets at once, inside one transaction with one audit row per
 * priority that actually changed.
 *
 * `upsert` on `[priority, contractId]` looks like the obvious write and is not: Postgres treats every
 * NULL `contractId` as distinct, so the unique key would let a second company-wide P1 row in and
 * `resolveSlaTargets` would then have two answers to pick between. The rows are therefore matched by
 * `findFirst` — the same reason the seed does — and updated by id, created only when missing.
 *
 * A priority's row is never deleted and never zeroed: `isActive` is not the switch here, because
 * deactivating the only company-wide P1 row silently moves every job on that priority onto the code
 * fallback. Editing the number is the switch.
 */
export async function updateCompanySlaTargets(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<CompanySlaRow[]> {
  assertCan(context, 'sla.manage')
  const targets = companyTargetsFrom(parseInput(companySlaSchema, raw))

  await withAudit(
    context,
    async (tx, log) => {
      const existing = await tx.slaPolicy.findMany({
        where: { contractId: null },
        select: {
          id: true,
          priority: true,
          responseMinutes: true,
          resolutionMinutes: true,
          isActive: true,
        },
      })
      const byPriority = new Map(existing.map((row) => [row.priority, row]))

      for (const target of targets) {
        const before = byPriority.get(target.priority)

        if (!before) {
          const row = await tx.slaPolicy.create({
            data: { ...target, contractId: null, isActive: true },
            select: { id: true },
          })
          await log({
            entity: 'SlaPolicy',
            entityId: row.id,
            action: 'CREATE',
            after: { ...target },
          })
          continue
        }

        const row = await tx.slaPolicy.update({
          where: { id: before.id },
          data: {
            responseMinutes: target.responseMinutes,
            resolutionMinutes: target.resolutionMinutes,
            // A deactivated row is brought back into force by an edit rather than left dark while
            // the screen shows a number that is not the one applying.
            isActive: true,
          },
          select: { id: true },
        })
        await log({
          entity: 'SlaPolicy',
          entityId: row.id,
          action: 'UPDATE',
          before: {
            priority: before.priority,
            responseMinutes: before.responseMinutes,
            resolutionMinutes: before.resolutionMinutes,
            isActive: before.isActive,
          },
          after: {
            priority: target.priority,
            responseMinutes: target.responseMinutes,
            resolutionMinutes: target.resolutionMinutes,
            isActive: true,
          },
        })
      }
    },
    client,
  )

  return getCompanySlaTargets(context, client)
}
