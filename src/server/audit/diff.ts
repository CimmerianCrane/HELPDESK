/**
 * Pure audit helpers. Kept free of any database import so the logic can be unit-tested without a
 * generated Prisma client or a running Postgres.
 */

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a === null || a === undefined || b === null || b === undefined) return false
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return false
}

/**
 * Narrows an update to the fields that actually changed, so the audit log stays readable and small.
 * Returns null when nothing changed, which means the caller should not write a row at all.
 */
export function changedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  if (!before || !after) return null

  const from: Record<string, unknown> = {}
  const to: Record<string, unknown> = {}

  for (const key of Object.keys(after)) {
    // updatedAt moves on every write, so it is noise rather than a change worth recording.
    if (key === 'updatedAt') continue
    if (!isEqual(before[key], after[key])) {
      from[key] = before[key]
      to[key] = after[key]
    }
  }

  return Object.keys(to).length > 0 ? { before: from, after: to } : null
}
