import { z } from 'zod'

/**
 * Input schemas for customers and contacts. Shared by the form, the server action and any future
 * importer, so there is one definition of a valid customer (CLAUDE.md rule 9).
 */

export const CUSTOMER_STATUSES = ['PROSPECT', 'ACTIVE', 'DORMANT'] as const
export const CONTACT_ROLES = ['SITE_CONTACT', 'ACCOUNTS', 'SAFETY_OFFICER', 'DECISION_MAKER'] as const
export const PREFERRED_CHANNELS = ['PHONE', 'EMAIL', 'WHATSAPP', 'SMS'] as const

/**
 * An empty form field arrives as `''`, which means "not provided", not "the empty string". Coercing
 * here means a service never has to ask whether a value is blank.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : null))

/** Required text that still gets trimmed and bounded. */
const requiredText = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max, `Use ${max} characters or fewer.`)

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .optional()
  .transform((value) => (value ? value : null))
  .refine((value) => value === null || z.string().email().safeParse(value).success, {
    message: 'That does not look like an email address.',
  })

/** Singapore UENs are 9–10 characters; other jurisdictions are allowed for now, so it is a soft bound. */
const optionalUen = z
  .string()
  .trim()
  .toUpperCase()
  .max(20)
  .optional()
  .transform((value) => (value ? value : null))

const paymentTerms = z
  .union([z.literal(''), z.coerce.number().int().min(0).max(365)])
  .optional()
  .transform((value) => (value === '' || value === undefined ? 30 : value))

/**
 * A structured billing address rather than a text blob, because it is printed on invoices and may
 * later be sent to an accounting system.
 */
const address = z.object({
  line1: optionalText(120),
  line2: optionalText(120),
  city: optionalText(80),
  postcode: optionalText(20),
  country: optionalText(80),
})

export const customerStatusSchema = z.enum(CUSTOMER_STATUSES)
export const contactRoleSchema = z.enum(CONTACT_ROLES)
export const preferredChannelSchema = z.enum(PREFERRED_CHANNELS)

export const createCustomerSchema = z.object({
  legalName: requiredText(160, 'Enter the customer’s legal name.'),
  tradingName: optionalText(160),
  uen: optionalUen,
  paymentTerms,
  status: customerStatusSchema.default('PROSPECT'),
  notes: optionalText(4000),
  address: address.default({}),
})

export const updateCustomerSchema = createCustomerSchema

/**
 * A contact may belong to the customer in general (no site) or to one site. The service checks that
 * a site id, when given, actually belongs to this customer — a schema cannot see the database.
 */
export const createContactSchema = z.object({
  name: requiredText(120, 'Enter the contact’s name.'),
  role: contactRoleSchema,
  phone: optionalText(40),
  email: optionalEmail,
  preferredChannel: preferredChannelSchema.default('PHONE'),
  /**
   * A checkbox sends nothing when unchecked and `'on'` when checked. `''` and `'false'` are accepted
   * too: a hidden companion field or a form reset can produce them, and reading either as "not
   * checked" is the safe interpretation — the failure mode of the other reading is an accidentally
   * primary contact.
   */
  isPrimary: z
    .union([
      z.literal('on'),
      z.literal('true'),
      z.literal('false'),
      z.literal(''),
      z.boolean(),
      z.undefined(),
    ])
    .transform((value) => value === 'on' || value === 'true' || value === true),
  siteId: optionalText(40),
})

export const updateContactSchema = createContactSchema

/** Filters for the customer list. Anything unrecognised falls back to "no filter". */
export const customerFilterSchema = z.object({
  q: z.string().trim().max(160).optional().default(''),
  status: z
    .union([z.literal(''), customerStatusSchema])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
})

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>
export type CreateContactInput = z.infer<typeof createContactSchema>
export type CustomerFilter = z.infer<typeof customerFilterSchema>
