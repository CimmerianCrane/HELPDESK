import type { CraneStatus, CraneType } from '@prisma/client'

/**
 * How a crane is written on screen, on a label and in a printed report.
 *
 * These live in `lib/` rather than beside the crane service because a client component renders them
 * — the "add a crane" form shows the type list. The token generator next door needs `node:crypto`
 * and cannot be bundled for the browser, so the two are kept in separate modules; keeping them
 * together meant the form dragged a Node module into the client build.
 *
 * The database values are for the database. Nothing a person reads should have to say `OUT_OF_SERVICE`.
 */

export const CRANE_TYPE_LABELS: Record<CraneType, string> = {
  OVERHEAD: 'Overhead crane',
  GANTRY: 'Gantry crane',
  JIB: 'Jib crane',
  MOBILE: 'Mobile crane',
  TOWER: 'Tower crane',
  HOIST: 'Hoist',
  OTHER: 'Other',
}

export const CRANE_STATUS_LABELS: Record<CraneStatus, string> = {
  IN_SERVICE: 'In service',
  RESTRICTED: 'Restricted — do not operate',
  OUT_OF_SERVICE: 'Out of service',
  DECOMMISSIONED: 'Decommissioned',
}

/** Shown beside the status so a dispatcher knows what it means for scheduling, not just the word. */
export const CRANE_STATUS_DESCRIPTIONS: Record<CraneStatus, string> = {
  IN_SERVICE: 'Available for work.',
  RESTRICTED: 'A defect or open finding is blocking it. It must not be operated until cleared.',
  OUT_OF_SERVICE: 'Temporarily withdrawn, for example awaiting a part.',
  DECOMMISSIONED: 'Retired. Kept for its history; no new work should be raised.',
}
