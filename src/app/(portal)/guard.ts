import { redirect } from 'next/navigation'
import { requireAuth } from '@/server/auth/context'
import type { AuthContext } from '@/server/auth/types'

/**
 * Each portal page gates itself. A layout's `redirect()` does not stop a page rendering in parallel
 * (Next 15), so a staff login would reach `/portal` and be answered with the service's
 * `ForbiddenError` — a 500 — instead of being sent to their own dashboard.
 *
 * The gate is the customer link, not `portal.read`: Admin holds every capability, so a capability
 * check would wave it through and the next call would throw. Only a customer account has a
 * `customerId`, and that is what every portal service needs anyway.
 */
export async function requirePortalPage(): Promise<AuthContext> {
  const context = await requireAuth()
  if (!context.customerId) redirect('/dashboard')
  return context
}
