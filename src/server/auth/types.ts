import type { Role } from '@prisma/client'

export type { Role }

/**
 * Who is making this request, and from where. Built once per request by `getAuthContext()`, and
 * passed to every service. Services never accept a caller-supplied identity — that is what makes the
 * server-side authorization checks meaningful.
 */
export interface AuthContext {
  userId: string
  /** For the header and audit trails. Never used for an authorization decision. */
  name: string
  email: string
  role: Role
  /** Set for TECHNICIAN logins, so "own jobs" can be scoped without a second lookup. */
  technicianId: string | null
  ip: string | null
  userAgent: string | null
}

/** A request that has not been authenticated yet, or one made by a background job. */
export type MaybeAuthContext = AuthContext | null
