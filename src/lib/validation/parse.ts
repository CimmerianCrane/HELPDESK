import type { z } from 'zod'
import { ValidationError } from '@/server/auth/errors'

/**
 * Validates raw input and, on failure, throws a ValidationError the form can render field by field.
 * Every service entry point uses this, so validation happens once, at the boundary, in one shape
 * (CLAUDE.md rule 9).
 */
export function parseInput<Schema extends z.ZodTypeAny>(
  schema: Schema,
  raw: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(raw)
  if (result.success) return result.data

  const flat = result.error.flatten()
  const fields: Record<string, string[]> = {}
  for (const [field, messages] of Object.entries(flat.fieldErrors)) {
    if (messages?.length) fields[field] = messages
  }

  // A refinement on the whole object rather than one field — surfaced against the form, not a field.
  if (flat.formErrors.length > 0) fields._form = flat.formErrors

  throw new ValidationError(fields)
}

/**
 * FormData -> a plain object, so a Zod schema sees the strings a browser actually sends and each
 * field can decide how to coerce (checkbox presence, empty string as null, and so on).
 */
export function formValues(formData: FormData): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {}
  for (const [key, value] of formData.entries()) {
    if (typeof value !== 'string') continue
    const existing = values[key]
    if (existing === undefined) values[key] = value
    else if (Array.isArray(existing)) existing.push(value)
    else values[key] = [existing, value]
  }
  return values
}

/**
 * As `formValues`, but a dotted name becomes a nested object: `address.city` arrives as
 * `{ address: { city } }`. HTML has no nested inputs, so a structured column (a JSON address, for
 * instance) needs this to be validated by the same `z.object` shape the service uses.
 *
 * A name with no dot is left at the top level. Grouping is one level deep, which is all the forms
 * here need; extend it only when a real form needs more.
 */
export function formValuesNested(formData: FormData): Record<string, unknown> {
  const flat = formValues(formData)
  const values: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(flat)) {
    const dot = key.indexOf('.')
    if (dot === -1) {
      values[key] = value
      continue
    }

    const group = key.slice(0, dot)
    const field = key.slice(dot + 1)
    const existing = values[group]
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      ;(existing as Record<string, unknown>)[field] = value
    } else {
      values[group] = { [field]: value }
    }
  }

  return values
}
