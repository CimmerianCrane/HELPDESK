import { headers } from 'next/headers'
import { cache } from 'react'
import { db } from '@/lib/db'
import { auth } from './config'
import { ForbiddenError, UnauthorizedError } from './errors'
import { can, type Capability } from './permissions'
import { clientIp } from './rate-limit'
import { sessionIsCurrent } from './session'
import type { AuthContext } from './types'

/**
 * Builds the caller's identity for this request, reading role and technician link from the database
 * rather than from the token. That is a deliberate cost: it means disabling a user or changing their
 * role takes effect on their next request, and there is no window in which a stale token grants
 * access that has since been withdrawn.
 *
 * Returns null rather than throwing, for callers that render differently when signed out.
 *
 * Wrapped in `cache` so a layout and the page inside it share one lookup per request. Every request
 * needs the caller's role, and the database is in another region — doing this twice per page render
 * would be paying that round trip for nothing.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null

  const user = await db.user.findFirst({
    where: { id: userId, isActive: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      passwordChangedAt: true,
      technician: { select: { id: true } },
    },
  })
  if (!user) return null

  // An administrator resetting a password ends the session that was open at the time — otherwise the
  // token is good for another twelve hours and the reset does nothing to whoever is holding it.
  if (!sessionIsCurrent(session.user.signedInAt, user.passwordChangedAt)) return null

  const requestHeaders = await headers()

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    technicianId: user.technician?.id ?? null,
    ip: clientIp(requestHeaders),
    userAgent: requestHeaders.get('user-agent'),
  }
})

/** Use in pages and services that cannot proceed without a signed-in user. */
export async function requireAuth(): Promise<AuthContext> {
  const context = await getAuthContext()
  if (!context) throw new UnauthorizedError()
  return context
}

/**
 * The check every mutating service call starts with. Capability only — services must *also* apply the
 * matching filter from scope.ts to their queries. Holding `job.read.own` says nothing about which
 * jobs are yours.
 */
export async function requireCapability(capability: Capability): Promise<AuthContext> {
  const context = await requireAuth()
  if (!can(context.role, capability)) throw new ForbiddenError()
  return context
}

export { can } from './permissions'
export type { Capability } from './permissions'
