import { z } from 'zod'
import { isLocalDateTime, localWallToUtc } from '@/lib/time'

/**
 * Scheduling input rules (brief §4.4), shared by the board, the forms and the services.
 *
 * Two things these schemas deliberately do *not* decide: whether a technician is competent for the
 * work, and whether they are already busy. Both need rows from the database, so they live in
 * `src/server/schedule/board.ts` and are applied by the service — the form can only warn.
 *
 * A `datetime-local` input carries no zone, so what it means depends on the operating timezone. The
 * schema therefore validates the *shape* of the value (it is checked and shared with the browser) and
 * the service converts it with `localWallToUtc`. Reading it as UTC in a schema would make the time a
 * dispatcher typed depend on the server's locale.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : null))

const requiredText = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max, `Use ${max} characters or fewer.`)

/** A wall-clock date and time: `2026-10-26T08:30`. Resolved against the operating timezone later. */
const wallClock = (message: string) =>
  z
    .string()
    .trim()
    .min(1, message)
    .refine(isLocalDateTime, 'That is not a date and time.')

/**
 * The pair is compared as wall clock only when both ends are given, which is the comparison the user
 * made. A schema cannot know the zone, so the service repeats the check on the converted instants —
 * the two agree everywhere except across a daylight-saving change, where the second check wins.
 */
function endsAfter(
  start: string,
  end: string,
): boolean {
  return end > start
}

/** Converts a validated local pair into instants in the caller's timezone. */
export function localSpan(
  start: string,
  end: string,
  timeZone: string,
): { start: Date; end: Date } {
  return { start: localWallToUtc(start, timeZone), end: localWallToUtc(end, timeZone) }
}

export const boardViewSchema = z.enum(['day', 'week'])

export const boardFilterSchema = z.object({
  view: z
    .union([z.literal(''), boardViewSchema])
    .optional()
    .transform((value) => (value === 'week' ? 'week' : 'day') as 'day' | 'week'),
  /** `YYYY-MM-DD`; `parseIsoDay` falls back to today rather than throwing. */
  date: z.string().trim().max(10).optional().default(''),
  /** Empty means every technician on the board. */
  technicianId: z.string().trim().max(40).optional().default(''),
})

/** Assigning somebody to a job. The service checks competency and clashes and returns warnings. */
export const assignTechnicianSchema = z.object({
  technicianId: requiredText(40, 'Choose a technician.'),
  /** The lead is who the job is dispatched to when there is more than one. */
  isLead: z
    .union([z.literal('on'), z.literal('true'), z.boolean()])
    .optional()
    .transform((value) => value === true || value === 'on' || value === 'true'),
  /**
   * Set when the dispatcher has seen a warning and chosen to go ahead anyway. Without it, a
   * competency block or an existing double-booking stops the assignment.
   */
  override: z
    .union([z.literal('on'), z.literal('true'), z.boolean()])
    .optional()
    .transform((value) => value === true || value === 'on' || value === 'true'),
  overrideReason: optionalText(500),
})

export const unassignTechnicianSchema = z.object({
  technicianId: requiredText(40, 'Choose a technician.'),
})

/**
 * A card dragged from one cell to another.
 *
 * The board sends what the drop means — *this person*, *this day* — not a pair of dates: the clock
 * time on the card is preserved, because a dispatcher moving a visit from Tuesday to Wednesday means
 * the same 08:00, not midnight. An empty `day` leaves the dates alone, which is how a card is moved
 * between technicians inside one day.
 */
export const moveCardSchema = z.object({
  /** Empty or `unassigned` takes everybody off. */
  technicianId: z.string().trim().max(40).optional().default(''),
  /** `YYYY-MM-DD`, the day the card was dropped on. Empty means "the day it is already on". */
  day: z
    .string()
    .trim()
    .regex(/^$|^\d{4}-\d{2}-\d{2}$/, 'That is not a day.')
    .optional()
    .default(''),
  override: z
    .union([z.literal('on'), z.literal('true'), z.boolean()])
    .optional()
    .transform((value) => value === true || value === 'on' || value === 'true'),
  overrideReason: optionalText(500),
})

/**
 * Moving a visit. There is no required duration: a job's `scheduledEnd` is what the technician was
 * told, so shortening a visit is a legitimate reschedule and not a special case.
 */
export const rescheduleSchema = z
  .object({
    scheduledStart: wallClock('Say when the visit starts.'),
    scheduledEnd: wallClock('Say when the visit ends.'),
  })
  .superRefine((input, ctx) => {
    if (!endsAfter(input.scheduledStart, input.scheduledEnd)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduledEnd'],
        message: 'The visit has to end after it starts.',
      })
    }
  })

/**
 * A priority bump. The reason is mandatory: this displaces work a customer was already told about,
 * and the question asked a fortnight later is always "why did Tuesday's service move" (CLAUDE.md
 * rule 7). The two jobs are named so the record stands without joining through the audit trail.
 */
export const bumpSchema = z.object({
  incomingJobId: requiredText(40, 'Say which job is taking the slot.'),
  reason: requiredText(500, 'Record why the scheduled job is being displaced.'),
})

/** Leave. `endAt` is exclusive, as everywhere else: coming back at 08:00 means leave ends then. */
export const unavailabilitySchema = z
  .object({
    technicianId: requiredText(40, 'Choose a technician.'),
    startAt: wallClock('Say when the leave starts.'),
    endAt: wallClock('Say when the leave ends.'),
    reason: optionalText(200),
  })
  .superRefine((input, ctx) => {
    if (!endsAfter(input.startAt, input.endAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endAt'],
        message: 'Leave has to end after it starts.',
      })
    }
  })

export const onCallShiftSchema = z
  .object({
    technicianId: requiredText(40, 'Choose a technician.'),
    startAt: wallClock('Say when the shift starts.'),
    endAt: wallClock('Say when the shift ends.'),
    notes: optionalText(500),
  })
  .superRefine((input, ctx) => {
    if (!endsAfter(input.startAt, input.endAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endAt'],
        message: 'A shift has to end after it starts.',
      })
    }
  })

/**
 * Booking a resource onto a job. A blank span means "the job's own scheduled window" — a test weight
 * is on site for the visit — so both ends come from the job and are filled in by the service.
 *
 * Both-or-neither is enforced here: a booking with a start and no end would occupy the resource
 * forever, which is how a block becomes invisible rather than obvious.
 */
export const bookResourceSchema = z
  .object({
    resourceId: requiredText(40, 'Choose a resource.'),
    startAt: z.string().trim().optional().default(''),
    endAt: z.string().trim().optional().default(''),
  })
  .superRefine((input, ctx) => {
    if (input.startAt && !input.endAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endAt'],
        message: 'Give both ends of the booking, or neither to use the job’s own dates.',
      })
    }
    if (!input.startAt && input.endAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startAt'],
        message: 'Give both ends of the booking, or neither to use the job’s own dates.',
      })
    }
    if (input.startAt && !isLocalDateTime(input.startAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startAt'],
        message: 'That is not a date and time.',
      })
    }
    if (input.endAt && !isLocalDateTime(input.endAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endAt'],
        message: 'That is not a date and time.',
      })
    }
    if (
      input.startAt &&
      input.endAt &&
      isLocalDateTime(input.startAt) &&
      isLocalDateTime(input.endAt) &&
      !endsAfter(input.startAt, input.endAt)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endAt'],
        message: 'The booking has to end after it starts.',
      })
    }
  })

/** The round view (slice 35): one day, optionally one technician, as the board's filter reads it. */
export const routeFilterSchema = z.object({
  date: z.string().trim().max(10).optional().default(''),
  technicianId: z.string().trim().max(40).optional().default(''),
})

export type BoardFilter = z.infer<typeof boardFilterSchema>
export type RouteFilter = z.infer<typeof routeFilterSchema>
export type RescheduleInput = z.infer<typeof rescheduleSchema>
export type BumpInput = z.infer<typeof bumpSchema>
export type UnavailabilityInput = z.infer<typeof unavailabilitySchema>
export type OnCallShiftInput = z.infer<typeof onCallShiftSchema>
export type BookResourceInput = z.infer<typeof bookResourceSchema>
