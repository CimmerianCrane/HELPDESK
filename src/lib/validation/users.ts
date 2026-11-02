import { z } from 'zod'

export const ROLES = [
  'ADMIN',
  'DISPATCHER',
  'TECHNICIAN',
  'STOREKEEPER',
  'FINANCE',
  'CUSTOMER',
] as const

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

/**
 * The customer a portal login belongs to (slice 31). Required when the role is CUSTOMER, ignored
 * otherwise — a staff account carrying a customerId would be scoped to that customer by the
 * `customerId` branches in scope.ts, which is a data leak, not a harmless extra field. Both the
 * service and the form refuse the mismatch.
 */
const customerId = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : null))

function withCustomerRule<T extends z.ZodTypeAny>(
  schema: T,
): z.ZodEffects<T, z.output<T>, z.input<T>> {
  return schema.superRefine((value, ctx) => {
    if (value.role === 'CUSTOMER' && !value.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerId'],
        message: 'Choose the customer this portal login belongs to.',
      })
    }
    if (value.role !== 'CUSTOMER' && value.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerId'],
        message: 'Only a Customer account belongs to a customer.',
      })
    }
  })
}

export const createUserSchema = withCustomerRule(
  z.object({
    name: z.string().trim().min(1, 'Enter a name.').max(120),
    email,
    role: roleSchema,
    phone: optionalText(40),
    employeeNo: optionalText(40),
    customerId,
    password,
  }),
)

export const updateUserSchema = withCustomerRule(
  z.object({
    name: z.string().trim().min(1, 'Enter a name.').max(120),
    role: roleSchema,
    phone: optionalText(40),
    customerId,
    // Checkbox: present means active. Absent means deactivated, which is the safe reading.
    isActive: z
      .union([z.literal('on'), z.literal('true'), z.literal('false'), z.boolean(), z.undefined()])
      .transform((value) => value === 'on' || value === 'true' || value === true),
  }),
)

export const setPasswordSchema = z.object({ password })

/** A user changing their own password. The current one is a presence check, not a length rule. */
export const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  password,
})

export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
