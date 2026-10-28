import { z } from 'zod'

/**
 * Input rules for a crane's recurring obligations (brief §8, slice 12).
 *
 * Kept apart from `cranes.ts` so a form can import the schedule types without pulling in the crane
 * schema's date handling, and spelled out rather than derived from `@prisma/client` because client
 * components render these lists.
 */

export const SCHEDULE_TYPES = [
  'MONTHLY_SERVICE',
  'ANNUAL_EXAMINATION',
  'LOAD_TEST',
  'HOIST_EXAMINATION',
  'LIFTING_GEAR_EXAM',
  'REGISTRATION_OTHER',
  'OTHER',
] as const

export const SCHEDULE_TYPE_LABELS: Record<(typeof SCHEDULE_TYPES)[number], string> = {
  MONTHLY_SERVICE: 'Monthly service',
  ANNUAL_EXAMINATION: 'Annual examination',
  LOAD_TEST: 'Load test',
  HOIST_EXAMINATION: 'Hoist examination',
  LIFTING_GEAR_EXAM: 'Lifting gear examination',
  REGISTRATION_OTHER: 'Registration / other',
  OTHER: 'Other',
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : null))

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A calendar day typed into a date input, read as UTC midnight so it prints as the same day in any
 * zone — the same convention `cranes.ts` uses for a registration date.
 */
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

/**
 * The interval is optional because a one-off obligation (`REGISTRATION_OTHER`, `OTHER`) has no
 * cadence; when it is present the next due date is derived from it and cannot be typed by hand.
 */
const intervalMonths = z
  .union([z.literal(''), z.coerce.number().int().min(1, 'At least one month.').max(120, 'Ten years at most.')])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value))

/** `90,60,30` or `90, 60, 30`. Empty means "use the setting's default", which is why it is not an error. */
const reminderOffsets = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((days) => Number.isInteger(days) && days > 0 && days <= 3650),
  )
  .transform((days) => [...new Set(days)].sort((a, b) => b - a))

/**
 * `craneId` is in the create shape only: editing cannot move a schedule to another crane, because a
 * schedule belongs to the machine it was raised against and moving it would silently rewrite that
 * crane's history.
 */
const scheduleFields = {
  scheduleType: z.enum(SCHEDULE_TYPES, {
    errorMap: () => ({ message: 'Choose the kind of obligation.' }),
  }),
  intervalMonths,
  lastDoneDate: optionalDay,
  nextDueDate: optionalDay,
  reminderOffsets: reminderOffsets,
  autoCreateDraftJob: z
    .union([z.literal('on'), z.literal('true'), z.literal(''), z.undefined()])
    .transform((value) => value === 'on' || value === 'true'),
  /**
   * The kind of work the reminder scan raises when this falls due (slice 15). Only meaningful with
   * `autoCreateDraftJob`; which job type completes which obligation is the office's call, never the
   * code's (CLAUDE.md rule 2).
   */
  draftJobTypeId: optionalText(40),
  /**
   * The compliance rule this obligation is based on (slice 14). The kind of obligation and the
   * interval then come from the rule, not from the form — a schedule "based on" a rule but running
   * on a different cadence would be a citation that does not describe the work.
   */
  ruleId: z
    .union([z.literal(''), z.string().trim().max(40)])
    .optional()
    .transform((value) => (value ? value : null)),
  notes: optionalText(2000),
}

/** The interval and a typed date are alternatives; one of the two has to be there. */
function checkDueBasis(
  input: {
    intervalMonths: number | null
    nextDueDate: Date | null
    ruleId: string | null
    autoCreateDraftJob: boolean
    draftJobTypeId: string | null
  },
  ctx: z.RefinementCtx,
) {
  // A draft job with no kind of work cannot be raised, so the pair is required together rather than
  // discovered by the cron failing once the obligation is already due.
  if (input.autoCreateDraftJob && !input.draftJobTypeId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['draftJobTypeId'],
      message: 'Choose the kind of work to raise, or untick the draft job.',
    })
  }

  // A rule supplies the interval, so "one of the two" is already satisfied by it.
  if (input.ruleId) return
  if (input.intervalMonths && input.nextDueDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nextDueDate'],
      message: 'With an interval set, the next due date comes from the last done date. Leave it blank.',
    })
  }
  if (!input.intervalMonths && !input.nextDueDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nextDueDate'],
      message: 'Give an interval, or the date this is next due.',
    })
  }
}
export const createScheduleSchema = z
  .object({
    craneId: z.string().trim().min(1, 'Choose a crane.').max(40),
    ...scheduleFields,
  })
  .superRefine(checkDueBasis)

export const updateScheduleSchema = z.object(scheduleFields).superRefine(checkDueBasis)

export const scheduleFilterSchema = z.object({
  q: z.string().trim().max(160).optional().default(''),
  /** `overdue` | `30` | `60` | `90` | `none` (no date) | '' for everything. */
  due: z
    .union([z.literal(''), z.enum(['overdue', '30', '60', '90', 'none'] as const)])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
  scheduleType: z
    .union([z.literal(''), z.enum(SCHEDULE_TYPES)])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
})

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>
export type ScheduleFilter = z.infer<typeof scheduleFilterSchema>
