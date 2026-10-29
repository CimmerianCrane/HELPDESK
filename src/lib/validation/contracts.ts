import { z } from 'zod'
import { PRIORITIES } from './tickets'

/**
 * Input rules for a customer's contracts (brief §5, §8; Phase 4, slice 29).
 *
 * A contract is the customer's terms of trade: its type, its term, what it covers and the response
 * and resolution targets negotiated for it. The targets are written as `SlaPolicy` rows carrying the
 * contract's id, which is the one table `resolveSlaTargets` reads — so a contract's targets have a
 * single home and cannot drift from what a new job snapshots.
 */

export const CONTRACT_TYPES = ['AMC', 'ADHOC', 'WARRANTY', 'RENTAL'] as const

export const CONTRACT_TYPE_LABELS: Record<(typeof CONTRACT_TYPES)[number], string> = {
  AMC: 'Annual maintenance contract',
  ADHOC: 'Ad hoc arrangement',
  WARRANTY: 'Warranty / callback',
  RENTAL: 'Equipment rental',
}

export type ContractTypeValue = (typeof CONTRACT_TYPES)[number]
export type ContractPriority = (typeof PRIORITIES)[number]

/** Minutes, or null for "no override — follow the company-wide row for this priority". */
export type SlaTarget = { responseMinutes: number; resolutionMinutes: number }

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : null))

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A date input, read as UTC midnight — the convention every other date form uses. */
function isoDayToUtc(value: string): Date | null {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10) === value ? date : null
}

const optionalDay = z
  .union([z.literal(''), z.string().regex(ISO_DAY, 'Use a date like 2026-10-26.')])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value))
  .superRefine((value, ctx) => {
    if (value !== null && isoDayToUtc(value) === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'That is not a real date.' })
    }
  })
  .transform((value) => (value === null ? null : isoDayToUtc(value)))

const includedVisits = z
  .union([
    z.literal(''),
    z.undefined(),
    z.coerce.number().int('Use whole visits.').min(0).max(1000, 'Use 1000 visits or fewer.'),
  ])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value))

/** An empty number box means "no override", not zero minutes. */
const minutes = z
  .union([
    z.literal(''),
    z.undefined(),
    z.coerce
      .number()
      .int('Use whole minutes.')
      .min(1, 'A target must be at least a minute.')
      .max(60 * 24 * 365, 'That is more than a year.'),
  ])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value))

/** Repeating checkboxes arrive as a bare string when only one is ticked. */
const coveredCraneIds = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (value === undefined) return []
    const list = Array.isArray(value) ? value : [value]
    return [...new Set(list.map((id) => id.trim()).filter(Boolean))]
  })

const contractFields = {
  type: z.enum(CONTRACT_TYPES, {
    errorMap: () => ({ message: 'Choose the kind of contract.' }),
  }),
  reference: optionalText(80),
  startDate: optionalDay,
  endDate: optionalDay,
  renewalDate: optionalDay,
  includedVisits,
  scopeNotes: optionalText(4000),
  coveredCraneIds,
  slaP1Response: minutes,
  slaP1Resolution: minutes,
  slaP2Response: minutes,
  slaP2Resolution: minutes,
  slaP3Response: minutes,
  slaP3Resolution: minutes,
  slaP4Response: minutes,
  slaP4Resolution: minutes,
}

export type ContractInput = z.infer<z.ZodObject<typeof contractFields>>

const SLA_FIELD_PREFIX = 'sla' as const
const SLA_FIELD_SUFFIX = { response: 'Response', resolution: 'Resolution' } as const

/** The form's flat fields as the pairs the service writes, one entry per priority. */
export function slaOverridesFrom(input: ContractInput): Partial<Record<ContractPriority, SlaTarget>> {
  const overrides: Partial<Record<ContractPriority, SlaTarget>> = {}
  for (const priority of PRIORITIES) {
    const response = input[`${SLA_FIELD_PREFIX}${priority}${SLA_FIELD_SUFFIX.response}`]
    const resolution = input[`${SLA_FIELD_PREFIX}${priority}${SLA_FIELD_SUFFIX.resolution}`]
    if (response !== null && resolution !== null) {
      overrides[priority] = { responseMinutes: response, resolutionMinutes: resolution }
    }
  }
  return overrides
}

function checkDates(
  input: { startDate: Date | null; endDate: Date | null; renewalDate: Date | null },
  ctx: z.RefinementCtx,
) {
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'A contract cannot end before it starts.',
    })
  }
  if (input.startDate && input.renewalDate && input.renewalDate < input.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['renewalDate'],
      message: 'The renewal date cannot come before the start date.',
    })
  }
}

/**
 * A priority needs both numbers or neither: `SlaPolicy` holds a response and a resolution per row,
 * so half a pair would leave the other number undefined at the moment it matters.
 */
function checkSla(input: ContractInput, ctx: z.RefinementCtx) {
  for (const priority of PRIORITIES) {
    const response = input[`${SLA_FIELD_PREFIX}${priority}${SLA_FIELD_SUFFIX.response}`]
    const resolution = input[`${SLA_FIELD_PREFIX}${priority}${SLA_FIELD_SUFFIX.resolution}`]
    if (response === null && resolution === null) continue
    if (response === null || resolution === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [`${SLA_FIELD_PREFIX}${priority}${SLA_FIELD_SUFFIX.response}`],
        message: 'Give both a response and a resolution time, or leave both blank.',
      })
      continue
    }
    if (resolution < response) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [`${SLA_FIELD_PREFIX}${priority}${SLA_FIELD_SUFFIX.resolution}`],
        message: 'Resolution cannot be quicker than the response.',
      })
    }
  }
}

export const createContractSchema = z
  .object(contractFields)
  .superRefine((input, ctx) => {
    checkDates(input, ctx)
    checkSla(input, ctx)
  })

export const updateContractSchema = createContractSchema

/** A renewal counts as "coming up" inside this window, the way certificates do at 90 days. */
export const RENEWAL_WINDOW_DAYS = 90

export type RenewalState = 'none' | 'due' | 'overdue'

/** Derived from the clock, never stored — a renewal date is a fact and this is an opinion of it. */
export function renewalState(
  renewalDate: Date | null,
  now: Date = new Date(),
): RenewalState {
  if (!renewalDate) return 'none'
  const days = Math.round(
    (Date.UTC(renewalDate.getUTCFullYear(), renewalDate.getUTCMonth(), renewalDate.getUTCDate()) -
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) /
      86_400_000,
  )
  if (days < 0) return 'overdue'
  return days <= RENEWAL_WINDOW_DAYS ? 'due' : 'none'
}

/**
 * Does this contract cover this job's cranes? A contract that names no cranes covers the whole
 * customer — the usual AMC — and one that names cranes covers only those.
 */
export function contractCoversCranes(
  coveredCraneIds: readonly string[],
  jobCraneIds: readonly string[],
): boolean {
  if (coveredCraneIds.length === 0) return true
  return jobCraneIds.some((id) => coveredCraneIds.includes(id))
}
