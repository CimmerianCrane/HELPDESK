import { z } from 'zod'

/**
 * The supplier book (brief §9, slice 27).
 *
 * A supplier is not deleted, only retired (`deletedAt`), because the parts that prefer it and the
 * purchase orders raised from it must keep naming something. Retiring one that still supplies a part
 * is refused rather than silently leaving that part in a reorder group nothing can order from.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : null))

export const supplierFields = {
  name: z.string().trim().min(1, 'Give the supplier a name.').max(160, 'Use 160 characters or fewer.'),
  contactName: optionalText(120),
  phone: optionalText(40),
  email: z
    .union([z.literal(''), z.string().trim().email('That is not an email address.')])
    .optional()
    .transform((value) => (value ? value : null)),
  /** What the reorder screen tells the store when an order is raised: roughly how long it takes. */
  leadTimeDays: z
    .union([
      z.literal(''),
      z.undefined(),
      z.coerce.number().int('Use whole days.').min(0).max(365, 'Use 365 days or fewer.'),
    ])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
  notes: optionalText(2000),
  /** Checkbox: present means active. Absent means retired, which is the safe reading. */
  isActive: z
    .union([z.literal('on'), z.literal('true'), z.literal('false'), z.boolean(), z.undefined()])
    .transform((value) => value === 'on' || value === 'true' || value === true),
}

export const createSupplierSchema = z.object(supplierFields)
export const updateSupplierSchema = z.object(supplierFields)

export type SupplierInput = z.infer<typeof createSupplierSchema>
