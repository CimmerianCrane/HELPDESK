import { z } from 'zod'

/**
 * Input rules and the status flow for a finding (brief §4.2, §6.4, slice 16).
 *
 * A finding is a defect a technician recorded on a report. It is not a job: it is the office's list of
 * things a customer still owes an answer on. The flow below is the whole rule set, kept as data and
 * pure functions so the service, the buttons and the tests all read the same map.
 *
 * `DECLINED_BY_CUSTOMER` is terminal, and it is the one transition that carries a signed
 * acknowledgement — a customer refusing a recommended critical repair is a liability record, not a
 * formality (brief §6.4).
 */

export const FINDING_STATUSES = [
  'OPEN',
  'QUOTED',
  'SCHEDULED',
  'RECTIFIED',
  'DECLINED_BY_CUSTOMER',
] as const

export type FindingStatusName = (typeof FINDING_STATUSES)[number]

export const FINDING_STATUS_LABELS: Record<FindingStatusName, string> = {
  OPEN: 'Open',
  QUOTED: 'Quoted',
  SCHEDULED: 'Scheduled',
  RECTIFIED: 'Rectified',
  DECLINED_BY_CUSTOMER: 'Declined by customer',
}

export const FINDING_SEVERITIES = ['CRITICAL', 'MAJOR', 'MINOR', 'OBSERVATION'] as const

export type FindingSeverityName = (typeof FINDING_SEVERITIES)[number]

export const FINDING_SEVERITY_LABELS: Record<FindingSeverityName, string> = {
  CRITICAL: 'Critical',
  MAJOR: 'Major',
  MINOR: 'Minor',
  OBSERVATION: 'Observation',
}

/**
 * Where a finding may go from each status.
 *
 * A finding starts OPEN when the report is submitted. `QUOTED` is the office having priced it,
 * `SCHEDULED` the work being on a job, `RECTIFIED` the work being recorded as done. Anything that was
 * not acted on goes to `DECLINED_BY_CUSTOMER` — never deleted, because "we told them and they said
 * no" is the record that protects both sides.
 */
export const ALLOWED_FINDING_TRANSITIONS: Record<
  FindingStatusName,
  readonly FindingStatusName[]
> = {
  OPEN: ['QUOTED', 'SCHEDULED', 'RECTIFIED', 'DECLINED_BY_CUSTOMER'],
  QUOTED: ['SCHEDULED', 'RECTIFIED', 'DECLINED_BY_CUSTOMER'],
  SCHEDULED: ['RECTIFIED', 'DECLINED_BY_CUSTOMER'],
  RECTIFIED: [],
  DECLINED_BY_CUSTOMER: [],
}

export function canMoveFinding(
  from: FindingStatusName,
  to: FindingStatusName,
): boolean {
  return ALLOWED_FINDING_TRANSITIONS[from].includes(to)
}

/** The statuses the UI should offer for a finding currently in `from`. */
export function nextFindingStatuses(from: FindingStatusName): readonly FindingStatusName[] {
  return ALLOWED_FINDING_TRANSITIONS[from]
}

/**
 * Is this finding still owed an answer?
 *
 * "Open" in the sense the crane page uses it — everything except the two terminal states. A finding
 * that is QUOTED or SCHEDULED is still outstanding work; only RECTIFIED and DECLINED close it.
 */
export function isFindingOpen(status: FindingStatusName): boolean {
  return status !== 'RECTIFIED' && status !== 'DECLINED_BY_CUSTOMER'
}

/** A severity the office should treat as urgent when it spawns a follow-up job. */
export function isUrgentSeverity(severity: FindingSeverityName): boolean {
  return severity === 'CRITICAL' || severity === 'MAJOR'
}

/**
 * The priority a follow-up job gets from the finding's severity.
 *
 * This is a default the office may override on the form; it is not a regulatory rule. Critical and
 * major defects are P2 — degraded operation, not necessarily crane-down — because the crane was
 * already returned to a recorded state by the inspection that found them. Anything lower is routine.
 */
export function priorityForSeverity(severity: FindingSeverityName): 'P1' | 'P2' | 'P3' | 'P4' {
  // Never P1: the crane was returned to service by the inspection that recorded the finding, and a
  // P1 raises a dispatch alert. The office can raise the priority by hand if the crane is down.
  if (severity === 'CRITICAL' || severity === 'MAJOR') return 'P2'
  return 'P3'
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : null))

const requiredText = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max, `Use ${max} characters or fewer.`)

export const findingStatusSchema = z.enum(FINDING_STATUSES)

/**
 * The status form. Declining is not an option here: it needs a name, a signature and a date, so it
 * goes through `acknowledgeDeclineSchema` and nowhere else. Leaving it out of this enum means a form
 * cannot post a declined finding without one.
 */
export const updateFindingStatusSchema = z.object({
  status: z.enum(['OPEN', 'QUOTED', 'SCHEDULED', 'RECTIFIED']),
  /** Free text: the quote reference, or why the work is not happening yet. */
  note: optionalText(1000),
})

/**
 * The signed acknowledgement a customer gives when they decline a recommended critical repair
 * (brief §6.4). The signature is uploaded through the ordinary signed-URL route and arrives here as a
 * File id, so the bytes never pass through a function body.
 */
export const acknowledgeDeclineSchema = z.object({
  name: requiredText(200, 'Whose acknowledgement is this?'),
  /** `YYYY-MM-DD`; read as UTC midnight like every other date in the app. */
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-28.'),
  note: optionalText(1000),
  signatureFileId: z.string().uuid('A signature is required for a declined repair.'),
})

export interface DeclineInput {
  status?: string
  note?: string
  name?: string
  date?: string
  signatureFileId?: string
}

/**
 * The one-click follow-up job (brief §4.2).
 *
 * `description` is prefilled from the finding by the form but stays editable: what the technician
 * wrote and what the customer should be told are not always the same sentence.
 */
export const createFollowUpJobSchema = z.object({
  findingId: requiredText(40, 'Choose a finding.'),
  jobTypeId: requiredText(40, 'Choose the kind of work.'),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']),
  description: optionalText(2000),
})

export type CreateFollowUpJobInput = z.infer<typeof createFollowUpJobSchema>

/**
 * A customer's signature on a declined repair, uploaded through the same signed-URL route the phone
 * uses. It belongs to the finding, not the job, because the acknowledgement is about the defect.
 */
export const findingSignatureUploadSchema = z.object({
  id: z.string().uuid(),
  findingId: requiredText(40, 'Choose a finding.'),
  kind: z.literal('FINDING_SIGNATURE'),
  filename: z.string().trim().min(1).max(200),
  mimeType: z.literal('image/png'),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024, 'Files must be 5 MB or smaller.'),
})

export type FindingSignatureUploadInput = z.infer<typeof findingSignatureUploadSchema>

export type UpdateFindingStatusInput = z.infer<typeof updateFindingStatusSchema>
export type AcknowledgeDeclineInput = z.infer<typeof acknowledgeDeclineSchema>
