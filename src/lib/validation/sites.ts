import { z } from 'zod'

/**
 * Input schemas for customer sites. A site exists so a crane, a job and a ticket all point at the
 * same physical place: the address where someone has to turn up, plus the things a technician needs
 * to know before they get through the gate.
 */

/** Empty means "not provided" — see the note in customers.ts; the same coercion applies here. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : null))

const requiredText = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max, `Use ${max} characters or fewer.`)

export const siteAddressSchema = z.object({
  line1: optionalText(120),
  line2: optionalText(120),
  city: optionalText(80),
  postcode: optionalText(20),
  country: optionalText(80),
})

/**
 * Coordinates are optional and typed by hand, so they arrive as strings and may be blank. The bounds
 * are the real ones; a transposed pair is caught here rather than showing up as a site in the ocean.
 */
const coordinate = (limit: number, message: string) =>
  z
    .union([z.literal(''), z.coerce.number().min(-limit, message).max(limit, message)])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value))

export const createSiteSchema = z.object({
  customerId: requiredText(40, 'A site belongs to a customer.'),
  name: requiredText(120, 'Give the site a name.'),
  address: siteAddressSchema.default({}),
  accessNotes: optionalText(2000),
  inductionRequirements: optionalText(2000),
  operatingHours: optionalText(500),
  latitude: coordinate(90, 'Latitude must be between -90 and 90.'),
  longitude: coordinate(180, 'Longitude must be between -180 and 180.'),
})

export const updateSiteSchema = createSiteSchema

/** Filters for the site list. An unrecognised value falls back to "no filter" rather than throwing. */
export const siteFilterSchema = z.object({
  q: z.string().trim().max(160).optional().default(''),
  customerId: z.string().trim().max(40).optional().default(''),
})

export type CreateSiteInput = z.infer<typeof createSiteSchema>
export type SiteFilter = z.infer<typeof siteFilterSchema>
