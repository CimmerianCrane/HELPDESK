import { z } from 'zod'
import { CRANE_TYPES } from './cranes'
import { SCHEDULE_TYPES } from './schedules'

/**
 * Input rules for compliance rules (brief §7, slice 14).
 *
 * A rule is configuration, never code (CLAUDE.md rule 2): the interval, whether an Authorised
 * Examiner is required, and the reference it came from are all typed in by the office team. The two
 * fields the schema insists on are `sourceReference` and `reviewedAt`, because a rule nobody can
 * check against a circular, reviewed on a date nobody wrote down, is a regulatory fact we invented.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : null))

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A date input read as UTC midnight — the same convention every other date in the app uses. */
function isoDayToUtc(value: string): Date | null {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10) === value ? date : null
}

const day = z
  .union([z.literal(''), z.string().regex(ISO_DAY, 'Use a date like 2026-10-26.')])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value))
  .superRefine((value, ctx) => {
    if (value !== null && isoDayToUtc(value) === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'That is not a real date.' })
    }
  })
  .transform((value) => (value === null ? null : isoDayToUtc(value)))

/** The record of when the rule was last looked at is mandatory (brief §7.1). */
const reviewedAt = z
  .string()
  .trim()
  .min(1, 'Say when the rule was last reviewed.')
  .superRefine((value, ctx) => {
    if (!ISO_DAY.test(value) || isoDayToUtc(value) === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use a date like 2026-10-26.' })
    }
  })
  .transform((value) => isoDayToUtc(value) as Date)

const intervalMonths = z
  .union([
    z.literal(''),
    z.coerce.number().int().min(1, 'At least one month.').max(120, 'Ten years at most.'),
  ])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value))

const checkbox = z
  .union([z.literal('on'), z.literal('true'), z.literal(''), z.undefined()])
  .transform((value) => value === 'on' || value === 'true')

const ruleFields = {
  craneType: z.enum(CRANE_TYPES, { errorMap: () => ({ message: 'Choose the kind of crane.' }) }),
  scheduleType: z.enum(SCHEDULE_TYPES, {
    errorMap: () => ({ message: 'Choose the kind of obligation.' }),
  }),
  intervalMonths,
  requiresAE: checkbox,
  isActive: checkbox,
  effectiveFrom: day,
  effectiveTo: day,
  sourceReference: z
    .string()
    .trim()
    .min(3, 'Say where the rule comes from — a circular number, a publication date, who reviewed it.')
    .max(300, 'Use 300 characters or fewer.'),
  reviewedAt,
  notes: optionalText(2000),
}

function checkEffectiveDates(
  input: { effectiveFrom: Date | null; effectiveTo: Date | null },
  ctx: z.RefinementCtx,
) {
  if (input.effectiveFrom && input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effectiveTo'],
      message: 'A rule cannot stop applying before it starts.',
    })
  }
}

export const createComplianceRuleSchema = z.object(ruleFields).superRefine(checkEffectiveDates)

export const updateComplianceRuleSchema = z.object(ruleFields).superRefine(checkEffectiveDates)

export type CreateComplianceRuleInput = z.infer<typeof createComplianceRuleSchema>
export type UpdateComplianceRuleInput = z.infer<typeof updateComplianceRuleSchema>

/**
 * Is this rule the one in force? Pure, so the admin list, the adoption check and its tests all ask
 * the same question instead of each writing its own comparison.
 *
 * `effectiveTo` is inclusive of the day it names: a rule that ends on 12/09/2025 still applied to a
 * service done that morning.
 */
export function isRuleInForce(
  rule: { isActive: boolean; effectiveFrom: Date | null; effectiveTo: Date | null },
  now: Date = new Date(),
): boolean {
  if (!rule.isActive) return false
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (rule.effectiveFrom && rule.effectiveFrom.getTime() > today) return false
  if (rule.effectiveTo && rule.effectiveTo.getTime() < today) return false
  return true
}
