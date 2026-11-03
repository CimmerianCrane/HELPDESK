import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { auditTrail } from '@/server/audit/audit'
import { ForbiddenError, NotFoundError, RuleError, ValidationError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { hashPassword, verifyPassword } from '@/server/auth/password'
import {
  changeOwnPassword,
  createUser,
  getUser,
  listUsers,
  setUserPassword,
  updateUser,
} from '@/server/users/users'
import { inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * The user service, exercised against the real database inside a transaction that always rolls back.
 * Passing the test's transaction into the service is what makes that possible — the mutation and its
 * audit row join the test's transaction rather than opening their own.
 */

async function makeUser(tx: Tx, role: Role, overrides: Record<string, unknown> = {}) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${role.toLowerCase()}-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
      ...overrides,
    },
  })
}

function contextFor(user: { id: string; name: string; email: string; role: Role }): AuthContext {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    technicianId: null,
    ip: '203.0.113.7',
    userAgent: 'vitest',
  }
}

/** Deactivate every administrator that already exists, so "the last admin" means what the test says. */
async function neutraliseExistingAdmins(tx: Tx) {
  await tx.user.updateMany({
    where: { role: 'ADMIN', isActive: true },
    data: { isActive: false },
  })
}

describe('permissions', () => {
  it('refuses to list users for a technician', async () => {
    await inRolledBackTx(async (tx) => {
      const technician = await makeUser(tx, 'TECHNICIAN')
      await expect(listUsers(contextFor(technician), tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('refuses to list users for a storekeeper', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      await expect(listUsers(contextFor(storekeeper), tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('refuses to create a user for a dispatcher', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      await expect(
        createUser(
          contextFor(dispatcher),
          {
            name: 'Sneaky',
            email: `sneaky-${testSuffix()}@example.test`,
            role: 'ADMIN',
            password: 'a-long-enough-password',
          },
          tx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('refuses to read a single user for a finance user', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = await makeUser(tx, 'FINANCE')
      const target = await makeUser(tx, 'TECHNICIAN')
      await expect(getUser(contextFor(finance), target.id, tx)).rejects.toBeInstanceOf(
        ForbiddenError,
      )
    })
  })
})

describe('reading the audit trail', () => {
  it('refuses a role that does not hold audit.read', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const target = await makeUser(tx, 'DISPATCHER')

      await expect(auditTrail(contextFor(storekeeper), 'User', target.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      )
    })
  })

  it('lets an administrator read it', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      // Read-only, and an id no row carries: what is under test is the check, not the contents.
      await expect(auditTrail(contextFor(admin), 'User', 'no-such-user')).resolves.toEqual([])
    })
  })
})

describe('creating a user', () => {
  it('creates the account and records it in the audit log', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const email = `new-${testSuffix()}@example.test`

      const created = await createUser(
        contextFor(admin),
        {
          name: 'New Dispatcher',
          email,
          role: 'DISPATCHER',
          phone: '+65 9123 4567',
          password: 'a-long-enough-password',
        },
        tx,
      )

      expect(created.id).toBeTruthy()
      expect(created.email).toBe(email)
      expect(created.role).toBe('DISPATCHER')
      expect(created.isActive).toBe(true)

      const trail = await tx.auditLog.findMany({ where: { entity: 'User', entityId: created.id } })
      expect(trail).toHaveLength(1)
      expect(trail[0].action).toBe('CREATE')
      expect(trail[0].userId).toBe(admin.id)
      expect(trail[0].ip).toBe('203.0.113.7')
    })
  })

  /**
   * The password hash is the one field that must never reach the audit log — the log is readable by
   * every administrator, and a leaked scrypt hash is still a leaked credential.
   */
  it('never writes the password or its hash to the audit log', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const password = 'unique-password-value-1234'

      const created = await createUser(
        contextFor(admin),
        {
          name: 'Audited User',
          email: `audited-${testSuffix()}@example.test`,
          role: 'FINANCE',
          password,
        },
        tx,
      )

      const trail = await tx.auditLog.findMany({ where: { entity: 'User', entityId: created.id } })
      const recorded = JSON.stringify(trail)

      expect(recorded).not.toContain(password)
      expect(recorded).not.toContain('scrypt$')
      expect(recorded).not.toContain('passwordHash')
    })
  })

  it('creates a technician record alongside a technician login', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')

      const created = await createUser(
        contextFor(admin),
        {
          name: 'Field Tech',
          email: `field-${testSuffix()}@example.test`,
          role: 'TECHNICIAN',
          employeeNo: 'T-100',
          password: 'a-long-enough-password',
        },
        tx,
      )

      // Without this row the technician would sign in and every scoped query would return nothing.
      expect(created.technicianId).toBeTruthy()
      expect(created.employeeNo).toBe('T-100')
    })
  })

  it('does not create a technician record for an office role', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')

      const created = await createUser(
        contextFor(admin),
        {
          name: 'Office Person',
          email: `office-${testSuffix()}@example.test`,
          role: 'FINANCE',
          employeeNo: 'IGNORED',
          password: 'a-long-enough-password',
        },
        tx,
      )

      expect(created.technicianId).toBeNull()
    })
  })

  it('rejects an email address that is already in use', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const existing = await makeUser(tx, 'DISPATCHER')

      await expect(
        createUser(
          contextFor(admin),
          { name: 'Duplicate', email: existing.email, role: 'FINANCE', password: 'a-long-enough-password' },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('rejects a password shorter than twelve characters, naming the field', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')

      const error = await createUser(
        contextFor(admin),
        {
          name: 'Too Short',
          email: `short-${testSuffix()}@example.test`,
          role: 'FINANCE',
          password: 'short',
        },
        tx,
      ).catch((thrown: unknown) => thrown)

      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).fields.password?.[0]).toContain('12 characters')
    })
  })

  it('rejects a missing name', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const error = await createUser(
        contextFor(admin),
        { name: '   ', email: `nameless-${testSuffix()}@example.test`, role: 'FINANCE', password: 'a-long-enough-password' },
        tx,
      ).catch((thrown: unknown) => thrown)

      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).fields.name).toBeTruthy()
    })
  })
})

describe('changing a user', () => {
  it('records only the fields that changed', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const target = await makeUser(tx, 'DISPATCHER')

      await updateUser(
        contextFor(admin),
        target.id,
        { name: target.name, role: 'DISPATCHER', phone: '', isActive: 'on' },
        tx,
      )

      // Roles and phone are unchanged and the phone was already null, so there is nothing to record.
      const trail = await tx.auditLog.findMany({ where: { entity: 'User', entityId: target.id } })
      expect(trail).toHaveLength(0)
    })
  })

  it('records a role change once', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const target = await makeUser(tx, 'DISPATCHER')

      await updateUser(
        contextFor(admin),
        target.id,
        { name: target.name, role: 'STOREKEEPER', phone: '', isActive: 'on' },
        tx,
      )

      const trail = await tx.auditLog.findMany({ where: { entity: 'User', entityId: target.id } })
      expect(trail).toHaveLength(1)

      const after = trail[0].after as Record<string, unknown>
      const before = trail[0].before as Record<string, unknown>
      expect(after.role).toBe('STOREKEEPER')
      expect(before.role).toBe('DISPATCHER')
      // Only the changed field is in the snapshot.
      expect(Object.keys(after)).toEqual(['role'])
    })
  })

  it('stops an administrator changing their own role', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')

      await expect(
        updateUser(
          contextFor(admin),
          admin.id,
          { name: admin.name, role: 'DISPATCHER', phone: '', isActive: 'on' },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('stops an administrator deactivating themselves', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')

      await expect(
        updateUser(
          contextFor(admin),
          admin.id,
          { name: admin.name, role: 'ADMIN', phone: '', isActive: undefined },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('stops the last active administrator being demoted', async () => {
    await inRolledBackTx(async (tx) => {
      await neutraliseExistingAdmins(tx)

      const target = await makeUser(tx, 'ADMIN')
      const actor = await makeUser(tx, 'ADMIN')
      // The actor's session is still live but their account has been deactivated, which is exactly
      // the situation that makes the target the last one standing.
      await tx.user.update({ where: { id: actor.id }, data: { isActive: false } })

      await expect(
        updateUser(
          contextFor(actor),
          target.id,
          { name: target.name, role: 'DISPATCHER', phone: '', isActive: 'on' },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('stops the last active administrator being deactivated', async () => {
    await inRolledBackTx(async (tx) => {
      await neutraliseExistingAdmins(tx)

      const target = await makeUser(tx, 'ADMIN')
      const actor = await makeUser(tx, 'ADMIN')
      await tx.user.update({ where: { id: actor.id }, data: { isActive: false } })

      await expect(
        updateUser(
          contextFor(actor),
          target.id,
          { name: target.name, role: 'ADMIN', phone: '', isActive: undefined },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('allows demoting an administrator when another active administrator remains', async () => {
    await inRolledBackTx(async (tx) => {
      await neutraliseExistingAdmins(tx)

      const actor = await makeUser(tx, 'ADMIN')
      const target = await makeUser(tx, 'ADMIN')

      const updated = await updateUser(
        contextFor(actor),
        target.id,
        { name: target.name, role: 'DISPATCHER', phone: '', isActive: 'on' },
        tx,
      )

      expect(updated.role).toBe('DISPATCHER')
    })
  })
})

describe('resetting a password', () => {
  it('changes the hash and records that it happened, without recording it', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const target = await makeUser(tx, 'TECHNICIAN')
      const newPassword = 'another-long-password-99'

      await setUserPassword(contextFor(admin), target.id, { password: newPassword }, tx)

      const after = await tx.user.findUniqueOrThrow({ where: { id: target.id } })
      expect(after.passwordHash).not.toBe('placeholder-not-a-real-hash')
      expect(after.passwordHash.startsWith('scrypt$')).toBe(true)
      // This is what ends a session that was already signed in — see auth/session.ts.
      expect(after.passwordChangedAt).toBeInstanceOf(Date)

      const trail = await tx.auditLog.findMany({ where: { entity: 'User', entityId: target.id } })
      expect(trail).toHaveLength(1)
      const recorded = JSON.stringify(trail)
      expect(recorded).not.toContain(newPassword)
      expect(recorded).not.toContain(after.passwordHash)
    })
  })

  it('refuses when the caller is not an administrator', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const target = await makeUser(tx, 'TECHNICIAN')

      await expect(
        setUserPassword(contextFor(storekeeper), target.id, { password: 'a-long-enough-password' }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})

describe('changing your own password', () => {
  /** A user who can actually sign in, which is what `changeOwnPassword` verifies against. */
  async function makeUserWithPassword(tx: Tx, role: Role, password: string) {
    const user = await makeUser(tx, role)
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } })
    return user
  }

  it('verifies the current password before replacing it, and records no password', async () => {
    await inRolledBackTx(async (tx) => {
      const user = await makeUserWithPassword(tx, 'TECHNICIAN', 'the-old-password-11')
      const newPassword = 'the-new-password-22'

      await changeOwnPassword(
        contextFor(user),
        { currentPassword: 'the-old-password-11', password: newPassword },
        tx,
      )

      const after = await tx.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(await verifyPassword(newPassword, after.passwordHash)).toBe(true)
      expect(await verifyPassword('the-old-password-11', after.passwordHash)).toBe(false)
      expect(after.passwordChangedAt).toBeInstanceOf(Date)

      const trail = await tx.auditLog.findMany({ where: { entity: 'User', entityId: user.id } })
      expect(trail).toHaveLength(1)
      const recorded = JSON.stringify(trail)
      expect(recorded).not.toContain(newPassword)
      expect(recorded).not.toContain(after.passwordHash)
    })
  })

  it('refuses the wrong current password and leaves the stored hash alone', async () => {
    await inRolledBackTx(async (tx) => {
      const user = await makeUserWithPassword(tx, 'DISPATCHER', 'the-old-password-11')
      const before = await tx.user.findUniqueOrThrow({ where: { id: user.id } })

      await expect(
        changeOwnPassword(
          contextFor(user),
          { currentPassword: 'not-the-password', password: 'the-new-password-22' },
          tx,
        ),
      ).rejects.toBeInstanceOf(ValidationError)

      const after = await tx.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(after.passwordHash).toBe(before.passwordHash)
    })
  })

  it('refuses to set the password it is already', async () => {
    await inRolledBackTx(async (tx) => {
      const user = await makeUserWithPassword(tx, 'ADMIN', 'the-old-password-11')

      await expect(
        changeOwnPassword(
          contextFor(user),
          { currentPassword: 'the-old-password-11', password: 'the-old-password-11' },
          tx,
        ),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  it('takes the account from the caller, never from the input', async () => {
    await inRolledBackTx(async (tx) => {
      const caller = await makeUserWithPassword(tx, 'TECHNICIAN', 'the-old-password-11')
      const victim = await makeUserWithPassword(tx, 'ADMIN', 'the-old-password-11')
      const victimHash = (await tx.user.findUniqueOrThrow({ where: { id: victim.id } })).passwordHash

      // A `userId` in the body is ignored; there is no way to name another account at all.
      await changeOwnPassword(
        contextFor(caller),
        {
          currentPassword: 'the-old-password-11',
          password: 'the-new-password-22',
          userId: victim.id,
        },
        tx,
      )

      expect((await tx.user.findUniqueOrThrow({ where: { id: victim.id } })).passwordHash).toBe(
        victimHash,
      )
    })
  })

  it('refuses an inactive account', async () => {
    await inRolledBackTx(async (tx) => {
      const user = await makeUserWithPassword(tx, 'TECHNICIAN', 'the-old-password-11')
      await tx.user.update({ where: { id: user.id }, data: { isActive: false } })

      await expect(
        changeOwnPassword(
          contextFor(user),
          { currentPassword: 'the-old-password-11', password: 'the-new-password-22' },
          tx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})
