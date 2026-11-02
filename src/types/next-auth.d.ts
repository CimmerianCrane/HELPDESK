import type { DefaultSession } from 'next-auth'

/**
 * The session carries the user id and when the token was issued. Everything else — role, technician
 * link, active flag, last password change — is read from the database per request in
 * `getAuthContext()`, so there is nothing else to put here.
 */
declare module 'next-auth' {
  interface Session {
    user: { id: string; signedInAt?: number } & DefaultSession['user']
  }
}
