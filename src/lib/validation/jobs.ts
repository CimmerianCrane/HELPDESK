import { z } from 'zod'

/**
 * Job input rules, shared by actions, forms and (later) route handlers.
 *
 * A job may cover one customer, one site and any number of cranes. The crane list is the only
 * many-valued field and HTML sends it as one entry per checked box, so it is normalised here rather
 * than in every caller.
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

// Spelled out rather than derived from `@prisma/client`: this schema is imported by client
// components, and the Prisma runtime has no business in a browser bundle.
export const jobStatusSchema = z.enum([
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
])

export const onHoldReasonSchema = z.enum([
  'AWAITING_PARTS',
  'AWAITING_CUSTOMER_ACCESS',
  'AWAITING_QUOTE_APPROVAL',
  'AWAITING_AE',
  'WEATHER',
  'OTHER',
])

/** `undefined` (no boxes ticked), `''` (empty hidden input) or one string all mean "none chosen". */
const idListSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    const list = value === undefined ? [] : Array.isArray(value) ? value : [value]
    return [...new Set(list.map((id) => id.trim()).filter(Boolean))]
  })

const craneIdsSchema = idListSchema

export const createJobSchema = z.object({
  customerId: requiredText(40, 'A job belongs to a customer.'),
  /** Optional: the service derives it from the first crane when it is left blank. */
  siteId: optionalText(40),
  jobTypeId: requiredText(40, 'Choose the kind of work.'),
  craneIds: craneIdsSchema,
  ticketId: optionalText(40),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).default('P3'),
  description: optionalText(2000),
  internalNotes: optionalText(4000),
})

/**
 * A job made from a ticket inherits the ticket's customer, site and cranes, so the only decisions
 * left are what kind of work it is, how urgent, and what to tell the technician.
 *
 * One ticket can become several jobs — a breakdown visit and a follow-up load test are different
 * work with different technicians — so conversion takes a list. The cap is a guard against a form
 * that posted a hundred rows, not a business rule.
 */
export const ticketJobSchema = z.object({
  jobTypeId: requiredText(40, 'Choose the kind of work.'),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).default('P3'),
  description: optionalText(2000),
})

export const convertTicketSchema = z.object({
  jobs: z.array(ticketJobSchema).min(1, 'Create at least one job.').max(20),
})

export type TicketJobInput = z.infer<typeof ticketJobSchema>

export const transitionJobSchema = z
  .object({
    status: jobStatusSchema,
    /** Free-text explanation kept on the history row; required by the service when going on hold. */
    note: optionalText(1000),
    onHoldReason: z
      .union([z.literal(''), onHoldReasonSchema])
      .optional()
      .transform((value) => (value === '' || value === undefined ? null : value)),
    /**
     * The part the hold is waiting for (slice 28). Only lawful with `AWAITING_PARTS` — a weather hold
     * waiting on a brake would put the store's reorder list under a job that is not short of it.
     */
    onHoldPartId: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((value) => (value ? value : null)),
    /**
     * Schedules this visit completed (slice 12). Only meaningful on COMPLETED — the service records
     * them in the same transaction as the status change and refuses them against any other target.
     */
    scheduleIds: idListSchema,
  })
  .superRefine((input, ctx) => {
    if (input.status !== 'COMPLETED' && input.scheduleIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduleIds'],
        message: 'Schedules are only recorded when a job is completed.',
      })
    }
    if (input.status === 'ON_HOLD' && !input.onHoldReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['onHoldReason'],
        message: 'Say why the job is on hold.',
      })
    }
    if (input.status !== 'ON_HOLD' && input.onHoldReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['onHoldReason'],
        message: 'A hold reason only applies when the job is on hold.',
      })
    }
    if (input.onHoldPartId && input.onHoldReason !== 'AWAITING_PARTS') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['onHoldPartId'],
        message: 'A part can only be named when the job is waiting for parts.',
      })
    }
  })

export const updateJobSchema = z.object({
  description: optionalText(2000),
  internalNotes: optionalText(4000),
  customerPoRef: optionalText(80),
})

/** How the company-wide list is ordered. Anything else falls back to the working order. */
export const JOB_SORTS = ['default', 'newest', 'scheduled'] as const

/** The three states a job's SLA can be filtered by. `met` is a result, not a thing to search for. */
export const SLA_FILTER_STATES = ['breached', 'at-risk', 'on-time'] as const

/**
 * A whole number out of a query string, or the fallback. Total rather than throwing: a hand-edited
 * `?page=abc` should show page one, not an error page.
 */
export function pageNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : fallback
}

const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .union([z.literal(''), schema])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value))

export const jobFilterSchema = z.object({
  q: z.string().trim().max(160).optional().default(''),
  status: emptyToNull(jobStatusSchema),
  priority: emptyToNull(z.enum(['P1', 'P2', 'P3', 'P4'])),
  customerId: z.string().trim().max(40).optional().default(''),
  jobTypeId: z.string().trim().max(40).optional().default(''),
  /** The ticket screen asks for the jobs raised from one call. */
  ticketId: z.string().trim().max(40).optional().default(''),
  technicianId: z.string().trim().max(40).optional().default(''),
  /** `YYYY-MM-DD`, inclusive of both ends. Read as wall dates in the operating timezone. */
  from: z.string().trim().max(10).optional().default(''),
  to: z.string().trim().max(10).optional().default(''),
  sla: emptyToNull(z.enum(SLA_FILTER_STATES)),
  sort: emptyToNull(z.enum(JOB_SORTS)),
})

/** A named set of filters. The query is kept as it will be replayed — a link, not a parsed shape. */
export const savedJobFilterSchema = z.object({
  name: z.string().trim().min(1, 'Give the filter a name.').max(60, 'Use 60 characters or fewer.'),
  query: z.string().trim().max(500).optional().default(''),
})

export type CreateJobInput = z.infer<typeof createJobSchema>
export type TransitionJobInput = z.infer<typeof transitionJobSchema>
export type JobFilter = z.infer<typeof jobFilterSchema>
export type JobSort = (typeof JOB_SORTS)[number]
export type SavedJobFilterInput = z.infer<typeof savedJobFilterSchema>
