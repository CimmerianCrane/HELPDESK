import { z } from 'zod'

/**
 * Where stock sits (brief §9, slice 23).
 *
 * `LocationType` is the schema's enum — warehouse, bin, van, customer site — and it is spelled out
 * here because a client component renders these labels. A bin optionally sits inside a warehouse
 * (`parentId`); neither `parentId` nor `siteId` is a foreign key in the database, so a location can
 * name a customer site without the storekeeper needing to see the customer register.
 */

export const LOCATION_TYPES = ['WAREHOUSE', 'BIN', 'VAN', 'CUSTOMER_SITE'] as const
export type LocationTypeName = (typeof LOCATION_TYPES)[number]

export const LOCATION_TYPE_LABELS: Record<LocationTypeName, string> = {
  WAREHOUSE: 'Warehouse',
  BIN: 'Bin',
  VAN: 'Van',
  CUSTOMER_SITE: 'Customer site',
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : null))

export const locationFields = {
  name: z.string().trim().min(1, 'Give the location a name.').max(120, 'Use 120 characters or fewer.'),
  type: z.enum(LOCATION_TYPES, {
    errorMap: () => ({ message: 'Choose what kind of location it is.' }),
  }),
  /** A bin inside a warehouse. Checked to exist in the service — the column has no foreign key. */
  parentId: optionalText(40),
  /** Checkbox: present means active. Absent means retired, which is the safe reading. */
  isActive: z
    .union([z.literal('on'), z.literal('true'), z.literal('false'), z.boolean(), z.undefined()])
    .transform((value) => value === 'on' || value === 'true' || value === true),
}

export const createLocationSchema = z.object(locationFields)
export const updateLocationSchema = z.object(locationFields)
