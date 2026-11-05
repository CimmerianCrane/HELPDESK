import type { JobStatus, OnHoldReason } from '@prisma/client'

/**
 * The job lifecycle (brief §4.2), as data and pure functions.
 *
 * `Enquiry/Ticket → Triage → Quote (optional) → Scheduled → Dispatched → In Progress → Completed →
 * Reviewed → Invoiced → Closed`, plus On Hold and Cancelled. Two things make this more than a list:
 *
 *   - **Not every transition is legal.** Skipping from NEW straight to CLOSED would erase the record
 *     of what happened, and moving backwards after invoicing would misstate work that has been
 *     billed. The service refuses anything not in `ALLOWED_TRANSITIONS`; the UI only offers what
 *     will be accepted, but the map is the rule.
 *   - **On Hold requires a reason.** Enforced here *and* by a database CHECK constraint, so a future
 *     code path cannot put a job on hold without saying why (CLAUDE.md rule 7).
 *
 * Quote is optional: a repeat servicing job goes TRIAGED → SCHEDULED without stopping at QUOTED.
 */

export const JOB_STATUSES: readonly JobStatus[] = [
  'NEW',
  'TRIAGED',
  'QUOTED',
  'APPROVED',
  'SCHEDULED',
  'DISPATCHED',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'REVIEWED',
  'INVOICED',
  'CLOSED',
  'CANCELLED',
] as const

/**
 * Where a job may go from each status. Cancelled and Closed are terminal: a closed job is a finished
 * record, and reopening it would change what an invoice and a report already refer to.
 *
 * COMPLETED → IN_PROGRESS exists for rework after a supervisor review; REVIEWED → COMPLETED is the
 * same decision made one step later.
 */
export const ALLOWED_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  NEW: ['TRIAGED', 'CANCELLED'],
  TRIAGED: ['QUOTED', 'APPROVED', 'SCHEDULED', 'CANCELLED'],
  QUOTED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['DISPATCHED', 'ON_HOLD', 'CANCELLED'],
  DISPATCHED: ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['SCHEDULED', 'DISPATCHED', 'IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['REVIEWED', 'IN_PROGRESS'],
  REVIEWED: ['INVOICED', 'COMPLETED'],
  INVOICED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
}

export const ON_HOLD_REASONS: readonly OnHoldReason[] = [
  'AWAITING_PARTS',
  'AWAITING_CUSTOMER_ACCESS',
  'AWAITING_QUOTE_APPROVAL',
  'AWAITING_AE',
  'WEATHER',
  'OTHER',
] as const

/** Everyone who may move a job. Office roles; the technician PWA gets its own, narrower rule later. */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/** The statuses the UI should offer for a job currently in `from`. */
export function nextStatuses(from: JobStatus): readonly JobStatus[] {
  return ALLOWED_TRANSITIONS[from]
}

/**
 * Whether dispatch may be sent. A SCHEDULED job moves to DISPATCHED; an already-dispatched one is
 * re-sent (a technician who lost the email) without pretending it is a new lifecycle step.
 */
export function canDispatch(from: JobStatus): boolean {
  return from === 'DISPATCHED' || canTransition(from, 'DISPATCHED')
}

export function isTerminal(status: JobStatus): boolean {
  return status === 'CLOSED' || status === 'CANCELLED'
}

export function requiresOnHoldReason(to: JobStatus): boolean {
  return to === 'ON_HOLD'
}

/**
 * The timestamp field a status stamps, if any. Used by the transition service so the columns are
 * always filled by the same rule rather than by whoever wrote the last status handler.
 */
export function timestampFieldFor(
  status: JobStatus,
): 'respondedAt' | 'onSiteAt' | 'completedAt' | 'reviewedAt' | 'invoicedAt' | 'closedAt' | null {
  switch (status) {
    case 'TRIAGED':
      return 'respondedAt'
    case 'IN_PROGRESS':
      return 'onSiteAt'
    case 'COMPLETED':
      return 'completedAt'
    case 'REVIEWED':
      return 'reviewedAt'
    case 'INVOICED':
      return 'invoicedAt'
    case 'CLOSED':
    case 'CANCELLED':
      return 'closedAt'
    default:
      return null
  }
}
