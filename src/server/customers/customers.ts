import type { CustomerStatus, Prisma } from '@prisma/client'
import { cache } from 'react'
import { db, type Tx } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import {
  createContactSchema,
  createCustomerSchema,
  customerFilterSchema,
  updateContactSchema,
  updateCustomerSchema,
  type CustomerFilter,
} from '@/lib/validation/customers'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { customerReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'

/**
 * Customers and their contacts (brief §12.3). Every function takes the caller's context first and
 * asserts its own capability, and every read spreads `customerReadWhere(context)` into the `where` —
 * a capability without a scope filter is a bug (CLAUDE.md rule 1).
 *
 * A contact is always reached through its customer, never by id alone, so the customer scope covers
 * contacts without a second filter.
 */

export interface Address {
  line1: string | null
  line2: string | null
  city: string | null
  postcode: string | null
  country: string | null
}

export interface CustomerSummary {
  id: string
  legalName: string
  tradingName: string | null
  uen: string | null
  status: CustomerStatus
  paymentTerms: number | null
  contactCount: number
  siteCount: number
  createdAt: Date
}

/** Everything the edit form needs, so the form never has to re-read the summary's derived counts. */
export interface CustomerEditable extends CustomerSummary {
  notes: string | null
  billingAddress: Address | null
}

export interface CustomerDetail extends CustomerEditable {
  contacts: ContactSummary[]
}

export interface ContactSummary {
  id: string
  name: string
  role: 'SITE_CONTACT' | 'ACCOUNTS' | 'SAFETY_OFFICER' | 'DECISION_MAKER'
  phone: string | null
  email: string | null
  preferredChannel: 'PHONE' | 'EMAIL' | 'WHATSAPP' | 'SMS'
  isPrimary: boolean
  siteId: string | null
  siteName: string | null
}

const customerSelect = {
  id: true,
  legalName: true,
  tradingName: true,
  uen: true,
  status: true,
  paymentTerms: true,
  notes: true,
  billingAddress: true,
  createdAt: true,
  // Archived children are not part of the customer any more: the list count and the detail page
  // must agree, and both must ignore a contact or site that has been archived.
  _count: {
    select: {
      contacts: { where: { deletedAt: null } },
      sites: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.CustomerSelect

type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof customerSelect }>

const contactSelect = {
  id: true,
  name: true,
  role: true,
  phone: true,
  email: true,
  preferredChannel: true,
  isPrimary: true,
  siteId: true,
  site: { select: { name: true } },
} satisfies Prisma.ContactSelect

type ContactRow = Prisma.ContactGetPayload<{ select: typeof contactSelect }>

function toSummary(row: CustomerRow): CustomerSummary {
  return {
    id: row.id,
    legalName: row.legalName,
    tradingName: row.tradingName,
    uen: row.uen,
    status: row.status,
    paymentTerms: row.paymentTerms,
    contactCount: row._count.contacts,
    siteCount: row._count.sites,
    createdAt: row.createdAt,
  }
}

function toContact(row: ContactRow): ContactSummary {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    phone: row.phone,
    email: row.email,
    preferredChannel: row.preferredChannel,
    isPrimary: row.isPrimary,
    siteId: row.siteId,
    siteName: row.site?.name ?? null,
  }
}

/** The stored JSON may predate a field, so read it defensively rather than casting. */
function toAddress(value: Prisma.JsonValue | null): Address | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : null)
  return {
    line1: text('line1'),
    line2: text('line2'),
    city: text('city'),
    postcode: text('postcode'),
    country: text('country'),
  }
}

/**
 * Fields that belong in the audit log. Built by hand for the same reason as in users.ts: the
 * snapshot should not silently grow a field because somebody spread the row.
 */
function auditSnapshot(row: {
  legalName: string
  tradingName: string | null
  uen: string | null
  status: CustomerStatus
  paymentTerms: number | null
  notes: string | null
}) {
  return {
    legalName: row.legalName,
    tradingName: row.tradingName,
    uen: row.uen,
    status: row.status,
    paymentTerms: row.paymentTerms,
    notes: row.notes,
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listCustomers(
  context: AuthContext,
  rawFilters: unknown = {},
  client: Tx = db,
): Promise<CustomerSummary[]> {
  assertCan(context, 'customer.read')
  const filters = parseInput(customerFilterSchema, rawFilters)

  const where: Prisma.CustomerWhereInput = {
    ...customerReadWhere(context),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.q
      ? {
          OR: [
            { legalName: { contains: filters.q, mode: 'insensitive' } },
            { tradingName: { contains: filters.q, mode: 'insensitive' } },
            { uen: { contains: filters.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const rows = await client.customer.findMany({
    where,
    select: customerSelect,
    orderBy: [{ legalName: 'asc' }],
  })
  return rows.map(toSummary)
}

/** Cached per request: `generateMetadata` and the page both read the same customer. */
export const getCustomer = cache(async function getCustomer(
  context: AuthContext,
  customerId: string,
  client: Tx = db,
): Promise<CustomerDetail> {
  assertCan(context, 'customer.read')

  const row = await client.customer.findFirst({
    where: { id: customerId, ...customerReadWhere(context) },
    select: {
      ...customerSelect,
      contacts: {
        where: { deletedAt: null },
        select: contactSelect,
        orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
      },
    },
  })
  // Not found and not permitted are the same answer, so a customer id cannot be probed for existence.
  if (!row) throw new NotFoundError('No such customer.')

  return {
    ...toSummary(row),
    notes: row.notes,
    billingAddress: toAddress(row.billingAddress),
    contacts: row.contacts.map(toContact),
  }
})

/**
 * The customer's sites. Used by the contact form's site selector and by the sites panel on the
 * customer page, so it carries the crane count the panel shows — one query rather than a second round
 * trip per site.
 */
export async function listCustomerSites(
  context: AuthContext,
  customerId: string,
  client: Tx = db,
): Promise<Array<{ id: string; name: string; craneCount: number }>> {
  assertCan(context, 'customer.read')
  const rows = await client.site.findMany({
    where: { customerId, deletedAt: null, customer: customerReadWhere(context) },
    select: { id: true, name: true, _count: { select: { cranes: { where: { deletedAt: null } } } } },
    orderBy: { name: 'asc' },
  })
  return rows.map((row) => ({ id: row.id, name: row.name, craneCount: row._count.cranes }))
}

// ---------------------------------------------------------------------------
// Customer writes
// ---------------------------------------------------------------------------

export async function createCustomer(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<CustomerSummary> {
  assertCan(context, 'customer.write')
  const input = parseInput(createCustomerSchema, raw)

  const created = await withAudit(
    context,
    async (tx, log) => {
      // A duplicate legal name is almost always the same company entered twice, which splits its
      // cranes and history. Refuse it; the office can add a distinguishing suffix if it is genuine.
      const existing = await tx.customer.findFirst({
        where: {
          deletedAt: null,
          legalName: { equals: input.legalName, mode: 'insensitive' },
        },
        select: { id: true, legalName: true },
      })
      if (existing) {
        throw new RuleError(`“${existing.legalName}” already exists as a customer.`)
      }

      const customer = await tx.customer.create({
        data: {
          legalName: input.legalName,
          tradingName: input.tradingName,
          uen: input.uen,
          paymentTerms: input.paymentTerms,
          status: input.status,
          notes: input.notes,
          billingAddress: input.address as Prisma.InputJsonValue,
          createdById: context.userId,
        },
        select: customerSelect,
      })

      await log({
        entity: 'Customer',
        entityId: customer.id,
        action: 'CREATE',
        after: { ...auditSnapshot(customer), billingAddress: input.address },
      })
      return customer
    },
    client,
  )

  return toSummary(created)
}

export async function updateCustomer(
  context: AuthContext,
  customerId: string,
  raw: unknown,
  client: Tx = db,
): Promise<CustomerSummary> {
  assertCan(context, 'customer.write')
  const input = parseInput(updateCustomerSchema, raw)

  const updated = await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.customer.findFirst({
        where: { id: customerId, ...customerReadWhere(context) },
      })
      if (!before) throw new NotFoundError('No such customer.')

      const clash = await tx.customer.findFirst({
        where: {
          id: { not: customerId },
          deletedAt: null,
          legalName: { equals: input.legalName, mode: 'insensitive' },
        },
        select: { id: true },
      })
      if (clash) throw new RuleError(`“${input.legalName}” is already another customer.`)

      await tx.customer.update({
        where: { id: customerId },
        data: {
          legalName: input.legalName,
          tradingName: input.tradingName,
          uen: input.uen,
          paymentTerms: input.paymentTerms,
          status: input.status,
          notes: input.notes,
          billingAddress: input.address as Prisma.InputJsonValue,
        },
      })

      const after = await tx.customer.findUniqueOrThrow({
        where: { id: customerId },
        select: customerSelect,
      })
      await log({
        entity: 'Customer',
        entityId: customerId,
        action: 'UPDATE',
        before: { ...auditSnapshot(before), billingAddress: toAddress(before.billingAddress) },
        after: { ...auditSnapshot(after), billingAddress: input.address },
      })
      return after
    },
    client,
  )

  return toSummary(updated)
}

/**
 * Soft delete. A customer with cranes or jobs is archival material, not something to remove — the
 * cranes, jobs, reports and certificates must keep pointing at a customer with a name on it.
 */
export async function archiveCustomer(
  context: AuthContext,
  customerId: string,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'customer.write')

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.customer.findFirst({
        where: { id: customerId, ...customerReadWhere(context) },
        select: { ...customerSelect },
      })
      if (!before) throw new NotFoundError('No such customer.')

      await tx.customer.update({
        where: { id: customerId },
        data: { deletedAt: new Date() },
      })
      await log({
        entity: 'Customer',
        entityId: customerId,
        action: 'DELETE',
        before: auditSnapshot(before),
        after: { archived: true },
      })
    },
    client,
  )
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/**
 * A contact id is never trusted on its own: it is looked up with the parent customer's scope filter,
 * so a contact belonging to a customer the caller cannot see is indistinguishable from a missing one.
 */
async function findContact(
  tx: Tx,
  context: AuthContext,
  customerId: string,
  contactId: string,
) {
  const contact = await tx.contact.findFirst({
    where: {
      id: contactId,
      customerId,
      deletedAt: null,
      customer: customerReadWhere(context),
    },
  })
  if (!contact) throw new NotFoundError('No such contact.')
  return contact
}

/** A site id on a contact must belong to the same customer, or the contact would leak across accounts. */
async function assertSiteBelongsToCustomer(
  tx: Tx,
  customerId: string,
  siteId: string | null,
): Promise<void> {
  if (!siteId) return
  const site = await tx.site.findFirst({
    where: { id: siteId, customerId, deletedAt: null },
    select: { id: true },
  })
  if (!site) throw new RuleError('That site does not belong to this customer.')
}

export async function createContact(
  context: AuthContext,
  customerId: string,
  raw: unknown,
  client: Tx = db,
): Promise<ContactSummary> {
  assertCan(context, 'customer.write')
  const input = parseInput(createContactSchema, raw)

  const created = await withAudit(
    context,
    async (tx, log) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, ...customerReadWhere(context) },
        select: { id: true },
      })
      if (!customer) throw new NotFoundError('No such customer.')

      await assertSiteBelongsToCustomer(tx, customerId, input.siteId)

      // Only one primary contact per customer: the invoice and the dispatch sheet both need to know
      // who to call, and two "primary" rows make that ambiguous.
      if (input.isPrimary) {
        await tx.contact.updateMany({
          where: { customerId, isPrimary: true, deletedAt: null },
          data: { isPrimary: false },
        })
      }

      const contact = await tx.contact.create({
        data: {
          customerId,
          siteId: input.siteId,
          name: input.name,
          role: input.role,
          phone: input.phone,
          email: input.email,
          preferredChannel: input.preferredChannel,
          isPrimary: input.isPrimary,
        },
        select: contactSelect,
      })

      const summary = toContact(contact)
      await log({
        entity: 'Contact',
        entityId: contact.id,
        action: 'CREATE',
        after: { ...summary },
      })
      return summary
    },
    client,
  )

  return created
}

export async function updateContact(
  context: AuthContext,
  customerId: string,
  contactId: string,
  raw: unknown,
  client: Tx = db,
): Promise<ContactSummary> {
  assertCan(context, 'customer.write')
  const input = parseInput(updateContactSchema, raw)

  const updated = await withAudit(
    context,
    async (tx, log) => {
      const before = await findContact(tx, context, customerId, contactId)
      await assertSiteBelongsToCustomer(tx, customerId, input.siteId)

      if (input.isPrimary) {
        await tx.contact.updateMany({
          where: { customerId, isPrimary: true, deletedAt: null, id: { not: contactId } },
          data: { isPrimary: false },
        })
      }

      const contact = await tx.contact.update({
        where: { id: contactId },
        data: {
          siteId: input.siteId,
          name: input.name,
          role: input.role,
          phone: input.phone,
          email: input.email,
          preferredChannel: input.preferredChannel,
          isPrimary: input.isPrimary,
        },
        select: contactSelect,
      })

      const summary = toContact(contact)
      await log({
        entity: 'Contact',
        entityId: contactId,
        action: 'UPDATE',
        before: {
          name: before.name,
          role: before.role,
          phone: before.phone,
          email: before.email,
          preferredChannel: before.preferredChannel,
          isPrimary: before.isPrimary,
          siteId: before.siteId,
        },
        after: { ...summary },
      })
      return summary
    },
    client,
  )

  return updated
}

export async function archiveContact(
  context: AuthContext,
  customerId: string,
  contactId: string,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'customer.write')

  await withAudit(
    context,
    async (tx, log) => {
      const before = await findContact(tx, context, customerId, contactId)
      await tx.contact.update({
        where: { id: contactId },
        data: { deletedAt: new Date(), isPrimary: false },
      })
      await log({
        entity: 'Contact',
        entityId: contactId,
        action: 'DELETE',
        before: { name: before.name, role: before.role, email: before.email },
        after: { archived: true },
      })
    },
    client,
  )
}

/** Exported for the list screen, which shows the same filters the service validates. */
export type { CustomerFilter }
