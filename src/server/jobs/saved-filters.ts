import { db, type Tx } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import { savedJobFilterSchema } from '@/lib/validation/jobs'
import { NotFoundError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import type { AuthContext } from '@/server/auth/types'

/**
 * Saved job-list filters (brief §8).
 *
 * These are a convenience, not business data: no audit row, because nothing here changes a job or a
 * customer and an audit log full of "Bernard renamed his filter" buries the entries that matter.
 *
 * Every read and write is filtered by `userId` rather than by a scope helper. That is not an
 * exception to CLAUDE.md rule 1 — it is the rule applied at its narrowest: a saved filter belongs to
 * exactly the person who made it, so the row filter is the owner, always.
 */

export interface SavedJobFilter {
  id: string
  name: string
  query: string
}

export async function listSavedJobFilters(
  context: AuthContext,
  client: Tx = db,
): Promise<SavedJobFilter[]> {
  assertCan(context, 'job.read.all')

  return client.savedJobFilter.findMany({
    where: { userId: context.userId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, query: true },
  })
}

/** Creates one, or replaces the query of the same name — saving the same view twice should not fail. */
export async function saveJobFilter(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<SavedJobFilter> {
  assertCan(context, 'job.read.all')
  const input = parseInput(savedJobFilterSchema, raw)

  return client.savedJobFilter.upsert({
    where: { userId_name: { userId: context.userId, name: input.name } },
    create: { userId: context.userId, name: input.name, query: input.query },
    update: { query: input.query },
    select: { id: true, name: true, query: true },
  })
}

export async function deleteJobFilter(
  context: AuthContext,
  filterId: string,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'job.read.all')

  const { count } = await client.savedJobFilter.deleteMany({
    where: { id: filterId, userId: context.userId },
  })
  // Somebody else's filter is not found, not forbidden: a 403 would confirm it exists.
  if (count === 0) throw new NotFoundError('No such saved filter.')
}
