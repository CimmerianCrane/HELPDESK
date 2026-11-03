import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, NotFoundError, RuleError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  archiveContact,
  archiveCustomer,
  createContact,
  createCustomer,
  getCustomer,
  listCustomers,
  updateContact,
  updateCustomer,
} from '@/server/customers/customers'
import { inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * The customer service against the real database, inside a transaction that always rolls back.
 * Passing the test's transaction in means the service joins it rather than committing.
 */

function contextFor(
  user: { id: string; name: string; email: string; role: Role },
  overrides: Partial<AuthContext> = {},
): AuthContext {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    technicianId: null,
    ip: '203.0.113.7',
    userAgent: 'vitest',
    ...overrides,
  }
}

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${role.toLowerCase()}-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

function customerInput(overrides: Record<string, unknown> = {}) {
  const suffix = testSuffix()
  return {
    legalName: `Test Customer ${suffix}`,
    status: 'ACTIVE',
    ...overrides,
  }
}

describe('permissions', () => {
  it('refuses to list customers for a technician', async () => {
    await inRolledBackTx(async (tx) => {
      const technician = await makeUser(tx, 'TECHNICIAN')
      await expect(listCustomers(contextFor(technician), {}, tx)).rejects.toBeInstanceOf(
        ForbiddenError,
      )
    })
  })

  it('refuses to create a customer for a storekeeper, who only sees cranes and stock', async () => {
    await inRolledBackTx(async (tx) => {
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      await expect(
        createCustomer(contextFor(storekeeper), customerInput(), tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('lets a finance user read but not write', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = await makeUser(tx, 'FINANCE')

      await expect(listCustomers(contextFor(finance), {}, tx)).resolves.toBeInstanceOf(Array)
      await expect(
        createCustomer(contextFor(finance), customerInput(), tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})

describe('row-level scope', () => {
  it('cannot fetch a customer that does not exist', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      await expect(getCustomer(contextFor(admin), 'no-such-customer', tx)).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })
  })
})

describe('creating and updating', () => {
  it('creates a customer and records it in the audit log', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const created = await createCustomer(contextFor(admin), customerInput(), tx)

      const entry = await tx.auditLog.findFirst({
        where: { entity: 'Customer', entityId: created.id, action: 'CREATE' },
      })
      expect(entry).not.toBeNull()
      expect(entry?.userId).toBe(admin.id)
    })
  })

  it('refuses a duplicate legal name, whatever the case', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const name = `Duplicate ${testSuffix()} Pte Ltd`

      await createCustomer(contextFor(admin), { legalName: name }, tx)

      await expect(
        createCustomer(contextFor(admin), { legalName: name.toUpperCase() }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('records only the fields that changed on an update', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const created = await createCustomer(contextFor(admin), customerInput(), tx)

      await updateCustomer(
        contextFor(admin),
        created.id,
        { legalName: created.legalName, status: 'DORMANT', paymentTerms: 45 },
        tx,
      )

      const entry = await tx.auditLog.findFirst({
        where: { entity: 'Customer', entityId: created.id, action: 'UPDATE' },
      })
      expect(entry).not.toBeNull()
      // The name never changed, so it must not clutter the trail.
      expect(entry?.before).not.toHaveProperty('legalName')
      expect(entry?.before).toMatchObject({ status: 'ACTIVE' })
      expect(entry?.after).toMatchObject({ status: 'DORMANT', paymentTerms: 45 })
    })
  })

  it('refuses to rename a customer to another customer’s name', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const first = await createCustomer(contextFor(admin), customerInput(), tx)
      const second = await createCustomer(contextFor(admin), customerInput(), tx)

      await expect(
        updateCustomer(contextFor(admin), second.id, { legalName: first.legalName }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('archives rather than deletes, and hides the customer from the list', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const created = await createCustomer(contextFor(admin), customerInput(), tx)

      await archiveCustomer(contextFor(admin), created.id, tx)

      const row = await tx.customer.findUniqueOrThrow({ where: { id: created.id } })
      expect(row.deletedAt).not.toBeNull()

      const listed = await listCustomers(contextFor(admin), { q: created.legalName }, tx)
      expect(listed).toHaveLength(0)
    })
  })
})

describe('contacts', () => {
  it('replaces the previous primary contact rather than keeping two', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const context = contextFor(admin)
      const customer = await createCustomer(context, customerInput(), tx)

      const first = await createContact(
        context,
        customer.id,
        { name: 'First', role: 'SITE_CONTACT', isPrimary: 'on' },
        tx,
      )
      const second = await createContact(
        context,
        customer.id,
        { name: 'Second', role: 'ACCOUNTS', isPrimary: 'on' },
        tx,
      )

      const detail = await getCustomer(context, customer.id, tx)
      const primaries = detail.contacts.filter((contact) => contact.isPrimary)
      expect(primaries).toHaveLength(1)
      expect(primaries[0]?.id).toBe(second.id)
      expect(detail.contacts.find((contact) => contact.id === first.id)?.isPrimary).toBe(false)
    })
  })

  it('refuses a site that belongs to a different customer', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const context = contextFor(admin)
      const mine = await createCustomer(context, customerInput(), tx)
      const other = await createCustomer(context, customerInput(), tx)

      const otherSite = await tx.site.create({
        data: { customerId: other.id, name: `Their Site ${testSuffix()}` },
      })

      await expect(
        createContact(
          context,
          mine.id,
          { name: 'Wrong Site', role: 'SITE_CONTACT', siteId: otherSite.id },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('rejects an empty contact name at the validation boundary', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const context = contextFor(admin)
      const customer = await createCustomer(context, customerInput(), tx)

      await expect(
        createContact(context, customer.id, { name: '  ', role: 'SITE_CONTACT' }, tx),
      ).rejects.toThrow()
    })
  })

  it('archives a contact without deleting it', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const context = contextFor(admin)
      const customer = await createCustomer(context, customerInput(), tx)
      const contact = await createContact(
        context,
        customer.id,
        { name: 'Leaving Soon', role: 'SITE_CONTACT', isPrimary: 'on' },
        tx,
      )

      await archiveContact(context, customer.id, contact.id, tx)

      const row = await tx.contact.findUniqueOrThrow({ where: { id: contact.id } })
      expect(row.deletedAt).not.toBeNull()
      expect(row.isPrimary).toBe(false)

      const detail = await getCustomer(context, customer.id, tx)
      expect(detail.contacts).toHaveLength(0)
    })
  })

  it('updates a contact through its parent customer only', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const context = contextFor(admin)
      const customer = await createCustomer(context, customerInput(), tx)
      const other = await createCustomer(context, customerInput(), tx)

      const contact = await createContact(
        context,
        customer.id,
        { name: 'Mary', role: 'SITE_CONTACT' },
        tx,
      )

      // The right contact id with the wrong parent customer must not be reachable.
      await expect(
        updateContact(context, other.id, contact.id, { name: 'Hijacked', role: 'ACCOUNTS' }, tx),
      ).rejects.toBeInstanceOf(NotFoundError)

      const updated = await updateContact(
        context,
        customer.id,
        contact.id,
        { name: 'Mary Goh', role: 'DECISION_MAKER', phone: '9123 4567' },
        tx,
      )
      expect(updated.name).toBe('Mary Goh')
      expect(updated.role).toBe('DECISION_MAKER')
      expect(updated.phone).toBe('9123 4567')
    })
  })
})
