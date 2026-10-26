import { randomBytes } from 'node:crypto'
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword, verifyPassword } from './password'
import {
  LOGIN_LIMITS,
  clientIp,
  emailKey,
  ipKey,
  rateLimit,
  resetRateLimit,
} from './rate-limit'

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().min(3),
  password: z.string().min(1),
})

/**
 * A hash of a random value, verified when the account does not exist. Without it a missing account
 * returns immediately while a real one takes ~60ms of scrypt, which tells an attacker which addresses
 * are registered.
 *
 * Generated rather than written out as a constant, so it is provably the same shape as a real hash —
 * same parameters, same key length — and cannot drift out of step if the cost parameters change.
 * Computed once per process, on the first failed lookup.
 */
let decoyHash: Promise<string> | undefined
function decoy(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(32).toString('hex'))
  return decoyHash
}

/**
 * The JWT carries only the user id. Role, technician link and active flag are read from the database
 * on every request by `getAuthContext()`, so revoking access or changing a role takes effect on the
 * next page load rather than whenever a token happens to expire. One primary-key lookup per request
 * is a price worth paying for having no stale-permission window at all.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 12 * 60 * 60 },
  pages: { signIn: '/login' },

  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw)
        if (!parsed.success) return null
        const { email, password } = parsed.data

        const ip = clientIp(request.headers)

        // Both buckets in one round trip rather than two: the database is in another region, and this
        // sits in front of every sign-in.
        const [byEmail, byIp] = await Promise.all([
          rateLimit(emailKey(email), LOGIN_LIMITS.perEmail.limit, LOGIN_LIMITS.perEmail.windowMs),
          rateLimit(ipKey(ip), LOGIN_LIMITS.perIp.limit, LOGIN_LIMITS.perIp.windowMs),
        ])
        if (!byEmail.allowed || !byIp.allowed) return null

        const user = await db.user.findFirst({
          where: { email, isActive: true, deletedAt: null },
          select: { id: true, email: true, name: true, passwordHash: true },
        })

        // Always verify something, so the response time does not reveal whether the account exists.
        const ok = await verifyPassword(password, user?.passwordHash ?? (await decoy()))
        if (!user || !ok) return null

        // Only the email bucket is cleared. Clearing the IP bucket too would let anyone holding one
        // valid login reset the per-address counter between guesses. Both writes are independent, so
        // they go in one round trip: this is the most-run write in the app and the database is in
        // another region.
        await Promise.all([
          resetRateLimit(emailKey(email)),
          db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
        ])

        return { id: user.id, email: user.email, name: user.name }
      },
    }),
  ],

  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id
        // `user` is only present on the sign-in request, so this stays the original sign-in time
        // however often the cookie is re-issued. `getAuthContext` compares it with the last
        // password change, which is how a reset ends the sessions that were already open.
        token.signedInAt = Date.now()
      }
      return token
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub
      if (typeof token.signedInAt === 'number') session.user.signedInAt = token.signedInAt
      return session
    },
  },
})
