import type { Priority, Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'

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

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const

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
