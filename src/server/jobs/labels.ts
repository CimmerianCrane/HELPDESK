import type { JobStatus, OnHoldReason } from '@prisma/client'

/** How a job's state is written on screen. One place, so list, detail and history agree. */

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  NEW: 'New',
  TRIAGED: 'Triaged',
  QUOTED: 'Quoted',
  APPROVED: 'Approved',
  SCHEDULED: 'Scheduled',
  DISPATCHED: 'Dispatched',
  IN_PROGRESS: 'In progress',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  REVIEWED: 'Reviewed',
  INVOICED: 'Invoiced',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
}

export const JOB_STATUS_DESCRIPTIONS: Record<JobStatus, string> = {
  NEW: 'Raised, not yet looked at by the office.',
  TRIAGED: 'Looked at: somebody has decided what kind of work this is.',
  QUOTED: 'A quote has been sent; waiting on the customer.',
  APPROVED: 'The customer has approved the work; it needs a date.',
  SCHEDULED: 'A date and a technician are set.',
  DISPATCHED: 'The technician has been sent the details.',
  IN_PROGRESS: 'On site and working.',
  ON_HOLD: 'Stopped, for a reason that is recorded.',
  COMPLETED: 'The work is done and the report is submitted.',
  REVIEWED: 'A supervisor has approved the report.',
  INVOICED: 'Billed. Waiting for payment before it closes.',
  CLOSED: 'Finished and settled. Nothing further happens.',
  CANCELLED: 'It is not going ahead.',
}

export const ON_HOLD_REASON_LABELS: Record<OnHoldReason, string> = {
  AWAITING_PARTS: 'Awaiting parts',
  AWAITING_CUSTOMER_ACCESS: 'Awaiting customer access',
  AWAITING_QUOTE_APPROVAL: 'Awaiting quote approval',
  AWAITING_AE: 'Awaiting Authorised Examiner',
  WEATHER: 'Weather',
  OTHER: 'Other',
}
