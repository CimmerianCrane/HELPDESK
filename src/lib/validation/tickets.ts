import { z } from 'zod'

/**
 * Input schemas for tickets. A ticket is what the phone call becomes: the customer's words, who is
 * reporting them, and the machine it is about. Everything else — the jobs it spawns, the technician
 * who attends — happens later.
 */

export const TICKET_SOURCES = ['PHONE', 'EMAIL', 'WHATSAPP', 'WEB', 'PORTAL'] as const
export const TICKET_STATUSES = ['NEW', 'TRIAGED', 'CONVERTED', 'CLOSED', 'CANCELLED'] as const
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const

/** Empty means "not provided" — the same coercion the other schemas use. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : null))

const requiredText = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max, `Use ${max} characters or fewer.`)

export const prioritySchema = z.enum(PRIORITIES)
export const ticketSourceSchema = z.enum(TICKET_SOURCES)
export const ticketStatusSchema = z.enum(TICKET_STATUSES)

export const createTicketSchema = z.object({
  source: ticketSourceSchema,
  customerId: requiredText(40, 'A ticket belongs to a customer.'),
  siteId: optionalText(40),
  craneId: optionalText(40),
  description: requiredText(4000, 'Describe what was reported.'),
  priority: prioritySchema.default('P3'),
  triageNotes: optionalText(4000),
})

/**
 * Triage is a separate operation from recording the call. The description is the customer's account
 * and is not rewritten here; what triage adds is the priority and what we decided to do about it.
 */
export const triageTicketSchema = z.object({
  priority: prioritySchema,
  status: z.enum(['NEW', 'TRIAGED']).default('TRIAGED'),
  triageNotes: optionalText(4000),
})

/** A description or crane can be corrected, and a ticket can be closed or cancelled with a note. */
export const updateTicketSchema = z.object({
  description: requiredText(4000, 'Describe what was reported.'),
  siteId: optionalText(40),
  craneId: optionalText(40),
  triageNotes: optionalText(4000),
})

export const closeTicketSchema = z.object({
  outcome: z.enum(['CLOSED', 'CANCELLED'], {
    errorMap: () => ({ message: 'Choose whether the ticket was closed or cancelled.' }),
  }),
  note: optionalText(1000),
})

export const ticketFilterSchema = z.object({
  q: z.string().trim().max(160).optional().default(''),
  status: z
    .union([z.literal(''), ticketStatusSchema])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
  priority: z
    .union([z.literal(''), prioritySchema])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
  customerId: z.string().trim().max(40).optional().default(''),
})

export type CreateTicketInput = z.infer<typeof createTicketSchema>
export type TicketFilter = z.infer<typeof ticketFilterSchema>
