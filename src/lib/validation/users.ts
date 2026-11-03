import { z } from 'zod'

export const ROLES = ['ADMIN', 'DISPATCHER', 'TECHNICIAN', 'STOREKEEPER', 'FINANCE'] as const

export const roleSchema = z.enum(ROLES)

/** Empty form fields arrive as `''`. Treat that as "not provided" rather than as a value. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null))

const password = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(200, 'That is longer than any password needs to be.')

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Enter an email address.')
  .email('That does not look like an email address.')
  .max(200)

export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  email,
  role: roleSchema,
  phone: optionalText(40),
  employeeNo: optionalText(40),
  password,
})

export const updateUserSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  role: roleSchema,
  phone: optionalText(40),
  // Checkbox: present means active. Absent means deactivated, which is the safe reading.
  isActive: z
    .union([z.literal('on'), z.literal('true'), z.literal('false'), z.boolean(), z.undefined()])
    .transform((value) => value === 'on' || value === 'true' || value === true),
})

export const setPasswordSchema = z.object({ password })

/** A user changing their own password. The current one is a presence check, not a length rule. */
export const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  password,
})

export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
