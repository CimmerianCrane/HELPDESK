import type { Prisma, Role } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import {
  changeOwnPasswordSchema,
  createUserSchema,
  setPasswordSchema,
  updateUserSchema,
} from '@/lib/validation/users'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError, ValidationError } from '@/server/auth/errors'
import { hashPassword, verifyPassword } from '@/server/auth/password'
import { assertCan } from '@/server/auth/permissions'
import type { AuthContext } from '@/server/auth/types'

/**
 * User administration. Every function takes the caller's context as its first argument and asserts
 * the capability itself, so there is no way to reach this module without an identity and no way for
 * a caller to skip the check.
 *
 * The optional `client` lets a caller supply an open transaction — the same one the mutation and its
 * audit row must share. Omit it and the service opens its own.
 */

export interface UserSummary {
  id: string
  name: string
  email: string
  role: Role
  phone: string | null
  isActive: boolean
  lastLoginAt: Date | null
  createdAt: Date
  technicianId: string | null
  employeeNo: string | null
}

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  phone: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  technician: { select: { id: true, employeeNo: true } },
} satisfies Prisma.UserSelect

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>

function toSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    phone: row.phone,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    technicianId: row.technician?.id ?? null,
    employeeNo: row.technician?.employeeNo ?? null,
  }
}

/**
 * The fields of a user that belong in the audit log. Built by hand rather than by spreading the
 * record: the password hash must never reach the log, and a column added later should not start
 * appearing in the trail just because somebody spread the object.
 */
function auditSnapshot(row: {
  name: string
  email: string
  role: Role
  phone: string | null
  isActive: boolean
}): Record<string, unknown> {
  return {
    name: row.name,
    email: row.email,
    role: row.role,
    phone: row.phone,
    isActive: row.isActive,
  }
}

export async function listUsers(context: AuthContext, client: Tx = db): Promise<UserSummary[]> {
  assertCan(context, 'user.manage')

  const rows = await client.user.findMany({
    where: { deletedAt: null },
    select: userSelect,
    orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { name: 'asc' }],
  })
  return rows.map(toSummary)
}

export async function getUser(
  context: AuthContext,
  userId: string,
  client: Tx = db,
): Promise<UserSummary> {
  assertCan(context, 'user.manage')

  const row = await client.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: userSelect,
  })
  if (!row) throw new NotFoundError('No such user.')
  return toSummary(row)
}

export async function createUser(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<UserSummary> {
  assertCan(context, 'user.manage')
  const input = parseInput(createUserSchema, raw)

  const existing = await client.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  })
  if (existing) throw new RuleError('That email address is already in use.')

  // Hashing is deliberately outside the transaction: it takes ~60ms of CPU and holding a database
  // transaction open for it would be rude to everyone else.
  const passwordHash = await hashPassword(input.password)

  const created = await withAudit(
    context,
    async (tx, log) => {
      const user = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          role: input.role,
          phone: input.phone,
          passwordHash,
        },
        select: { id: true },
      })

      // A technician login is useless without its Technician row: job and report scoping resolve
      // through JobTechnician, so without this the user would sign in and see nothing at all.
      if (input.role === 'TECHNICIAN') {
        await tx.technician.create({
          data: {
            userId: user.id,
            phone: input.phone,
            employeeNo: input.employeeNo,
          },
        })
      }

      const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: userSelect })
      await log({
        entity: 'User',
        entityId: user.id,
        action: 'CREATE',
        after: auditSnapshot(fresh),
      })
      return fresh
    },
    client,
  )

  return toSummary(created)
}

export async function updateUser(
  context: AuthContext,
  userId: string,
  raw: unknown,
  client: Tx = db,
): Promise<UserSummary> {
  assertCan(context, 'user.manage')
  const input = parseInput(updateUserSchema, raw)

  const updated = await withAudit(
    context,
    async (tx, log) => {
      // Lock the active administrators for the rest of this transaction. Without it, two admins could
      // demote each other at the same instant, each seeing the other still active, and leave the
      // company with no administrator at all.
      await lockActiveAdmins(tx)

      const before = await tx.user.findFirst({ where: { id: userId, deletedAt: null } })
      if (!before) throw new NotFoundError('No such user.')

      if (userId === context.userId && input.role !== before.role) {
        throw new RuleError('You cannot change your own role. Ask another administrator to do it.')
      }
      if (userId === context.userId && !input.isActive) {
        throw new RuleError('You cannot deactivate your own account.')
      }

      const isLosingAdmin = before.role === 'ADMIN' && (input.role !== 'ADMIN' || !input.isActive)
      if (isLosingAdmin && (await isLastActiveAdmin(tx, userId))) {
        throw new RuleError(
          'This is the only active administrator. Give another user the Admin role first.',
        )
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          name: input.name,
          role: input.role,
          phone: input.phone,
          isActive: input.isActive,
        },
      })

      const after = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: userSelect })
      await log({
        entity: 'User',
        entityId: userId,
        action: 'UPDATE',
        before: auditSnapshot(before),
        after: auditSnapshot(after),
      })
      return after
    },
    client,
  )

  return toSummary(updated)
}

/**
 * Administrators issue a temporary password and hand it over; the user changes it themselves later.
 * The audit row records that the password changed, and never the password or its hash.
 *
 * Stamping `passwordChangedAt` is what ends any session that was already open: `getAuthContext`
 * refuses a token issued before it. A reset that leaves the old token working for another twelve
 * hours is not a reset.
 */
export async function setUserPassword(
  context: AuthContext,
  userId: string,
  raw: unknown,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'user.manage')
  const { password } = parseInput(setPasswordSchema, raw)
  const passwordHash = await hashPassword(password)

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.user.findFirst({ where: { id: userId, deletedAt: null } })
      if (!before) throw new NotFoundError('No such user.')

      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      })
      await log({
        entity: 'User',
        entityId: userId,
        action: 'UPDATE',
        before: { passwordChanged: false },
        after: { passwordChanged: true, changedByAdmin: context.userId },
      })
    },
    client,
  )
}

/**
 * A user changing their own password. Deliberately takes no capability: this is the one write every
 * role may make, and only to their own row — the id comes from `context.userId` and is never read
 * from the request, so there is nothing for a caller to point at somebody else.
 *
 * The current password is required because a session left open on a shared site tablet is exactly the
 * situation this screen exists for. It stamps `passwordChangedAt` like an admin reset, which ends
 * every other session through `sessionIsCurrent` — including the one that made the change, so the
 * form signs the user back in rather than leaving them on a dead token.
 */
export async function changeOwnPassword(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<void> {
  const input = parseInput(changeOwnPasswordSchema, raw)

  const user = await client.user.findFirst({
    where: { id: context.userId, isActive: true, deletedAt: null },
    select: { id: true, passwordHash: true },
  })
  if (!user) throw new NotFoundError('No such user.')

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new ValidationError({ currentPassword: ['That is not your current password.'] })
  }
  if (input.currentPassword === input.password) {
    throw new ValidationError({ password: ['Choose a password you have not used here.'] })
  }

  const passwordHash = await hashPassword(input.password)

  await withAudit(
    context,
    async (tx, log) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, passwordChangedAt: new Date() },
      })
      await log({
        entity: 'User',
        entityId: user.id,
        action: 'UPDATE',
        before: { passwordChanged: false },
        after: { passwordChanged: true, changedByAdmin: false },
      })
    },
    client,
  )
}

// ---------------------------------------------------------------------------

async function lockActiveAdmins(tx: Tx): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE role = 'ADMIN' AND "isActive" = true AND "deletedAt" IS NULL FOR UPDATE`
}

async function isLastActiveAdmin(tx: Tx, excludingUserId: string): Promise<boolean> {
  const others = await tx.user.count({
    where: {
      role: 'ADMIN',
      isActive: true,
      deletedAt: null,
      id: { not: excludingUserId },
    },
  })
  return others === 0
}
