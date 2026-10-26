import type { Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import {
  createSiteSchema,
  siteFilterSchema,
  updateSiteSchema,
  type SiteFilter,
} from '@/lib/validation/sites'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { customerReadWhere, siteReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'

/**
 * Customer sites (brief §12.3). A site is where a crane stands and where a technician has to turn up,
 * so it carries the two things that are useless once someone is already at the gate: the address and
 * the access notes.
 *
 * Reading a site is governed by `siteReadWhere`; writing it requires `site.write`, which only a
 * dispatcher or admin holds. Every mutation is audit-logged, including a site being archived.
 */

export interface SiteAddress {
  line1: string | null
  line2: string | null
  city: string | null
  postcode: string | null
  country: string | null
}

export interface SiteSummary {
  id: string
  customerId: string
  customerName: string
  name: string
  address: SiteAddress | null
  craneCount: number
  createdAt: Date
}

export interface SiteDetail extends SiteSummary {
  accessNotes: string | null
  inductionRequirements: string | null
  operatingHours: string | null
  latitude: number | null
  longitude: number | null
}

const siteSelect = {
  id: true,
  customerId: true,
  name: true,
  address: true,
  createdAt: true,
  customer: { select: { legalName: true } },
  _count: { select: { cranes: { where: { deletedAt: null } } } },
} satisfies Prisma.SiteSelect

type SiteRow = Prisma.SiteGetPayload<{ select: typeof siteSelect }>

function toAddress(value: Prisma.JsonValue | null): SiteAddress | null {
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

function toSummary(row: SiteRow): SiteSummary {
  return {
    id: row.id,
    customerId: row.customerId,
    customerName: row.customer.legalName,
    name: row.name,
    address: toAddress(row.address),
    craneCount: row._count.cranes,
    createdAt: row.createdAt,
  }
}

/** Decimal columns come back as `Decimal`; the UI wants a number or nothing. */
function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listSites(
  context: AuthContext,
  rawFilters: unknown = {},
  client: Tx = db,
): Promise<SiteSummary[]> {
  // `crane.read` rather than a site capability: everyone who may look at a crane has to be able to
  // see where it is, and finance holds the register capability without holding `site.write`.
  assertCan(context, 'crane.read')
  const filters = parseInput(siteFilterSchema, rawFilters) as SiteFilter

  const where: Prisma.SiteWhereInput = {
    ...siteReadWhere(context),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: 'insensitive' } },
            { customer: { legalName: { contains: filters.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }

  const rows = await client.site.findMany({
    where,
    select: siteSelect,
    orderBy: [{ customer: { legalName: 'asc' } }, { name: 'asc' }],
    take: 500,
  })
  return rows.map(toSummary)
}

export async function getSite(
  context: AuthContext,
  siteId: string,
  client: Tx = db,
): Promise<SiteDetail> {
  assertCan(context, 'crane.read')

  const row = await client.site.findFirst({
    where: { id: siteId, ...siteReadWhere(context) },
    select: {
      ...siteSelect,
      accessNotes: true,
      inductionRequirements: true,
      operatingHours: true,
      latitude: true,
      longitude: true,
    },
  })
  if (!row) throw new NotFoundError('No such site.')

  return {
    ...toSummary(row),
    accessNotes: row.accessNotes,
    inductionRequirements: row.inductionRequirements,
    operatingHours: row.operatingHours,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createSite(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<SiteSummary> {
  assertCan(context, 'site.write')
  const input = parseInput(createSiteSchema, raw)

  const created = await withAudit(
    context,
    async (tx, log) => {
      // The customer has to be one this caller may see; otherwise creating a site against an
      // invented id would confirm whether that customer exists.
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, ...customerReadWhere(context) },
        select: { id: true },
      })
      if (!customer) throw new NotFoundError('No such customer.')

      const clash = await tx.site.findFirst({
        where: {
          customerId: input.customerId,
          deletedAt: null,
          name: { equals: input.name, mode: 'insensitive' },
        },
        select: { id: true, name: true },
      })
      if (clash) {
        throw new RuleError(`“${clash.name}” is already a site for this customer.`)
      }

      const site = await tx.site.create({
        data: {
          customerId: input.customerId,
          name: input.name,
          address: input.address as Prisma.InputJsonValue,
          accessNotes: input.accessNotes,
          inductionRequirements: input.inductionRequirements,
          operatingHours: input.operatingHours,
          latitude: input.latitude,
          longitude: input.longitude,
        },
        select: siteSelect,
      })

      await log({ entity: 'Site', entityId: site.id, action: 'CREATE', after: { ...input } })
      return site
    },
    client,
  )

  return toSummary(created)
}

export async function updateSite(
  context: AuthContext,
  siteId: string,
  raw: unknown,
  client: Tx = db,
): Promise<SiteSummary> {
  assertCan(context, 'site.write')
  const input = parseInput(updateSiteSchema, raw)

  const updated = await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.site.findFirst({
        where: { id: siteId, deletedAt: null },
        select: { ...siteSelect, accessNotes: true, inductionRequirements: true, operatingHours: true },
      })
      if (!before) throw new NotFoundError('No such site.')

      // A site never moves between customers. Moving it would silently move every crane, job and
      // ticket on it to another company, which is a data-correction job for an administrator, not a
      // side effect of editing an address.
      if (input.customerId !== before.customerId) {
        throw new RuleError('A site cannot be moved to a different customer.')
      }

      const clash = await tx.site.findFirst({
        where: {
          id: { not: siteId },
          customerId: before.customerId,
          deletedAt: null,
          name: { equals: input.name, mode: 'insensitive' },
        },
        select: { id: true },
      })
      if (clash) throw new RuleError(`“${input.name}” is already a site for this customer.`)

      const after = await tx.site.update({
        where: { id: siteId },
        data: {
          name: input.name,
          address: input.address as Prisma.InputJsonValue,
          accessNotes: input.accessNotes,
          inductionRequirements: input.inductionRequirements,
          operatingHours: input.operatingHours,
          latitude: input.latitude,
          longitude: input.longitude,
        },
        select: siteSelect,
      })

      await log({
        entity: 'Site',
        entityId: siteId,
        action: 'UPDATE',
        before: { ...toSummary(before), ...toDetail(before) },
        after: { ...toSummary(after), ...input },
      })
      return after
    },
    client,
  )

  return toSummary(updated)
}

/** The parts of a site that `siteSelect` does not carry, for an audit diff. */
function toDetail(row: {
  accessNotes: string | null
  inductionRequirements: string | null
  operatingHours: string | null
}) {
  return {
    accessNotes: row.accessNotes,
    inductionRequirements: row.inductionRequirements,
    operatingHours: row.operatingHours,
  }
}

export async function archiveSite(
  context: AuthContext,
  siteId: string,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'site.write')

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.site.findFirst({
        where: { id: siteId, deletedAt: null },
        select: { id: true, name: true, _count: { select: { cranes: { where: { deletedAt: null } } } } },
      })
      if (!before) throw new NotFoundError('No such site.')

      // Archiving a site with cranes on it would hide those cranes from the register while leaving
      // them attached to something invisible. Move or archive the cranes first, deliberately.
      if (before._count.cranes > 0) {
        throw new RuleError(
          `“${before.name}” still has ${before._count.cranes} crane${before._count.cranes === 1 ? '' : 's'}. Move or archive them first.`,
        )
      }

      await tx.site.update({ where: { id: siteId }, data: { deletedAt: new Date() } })
      await log({
        entity: 'Site',
        entityId: siteId,
        action: 'UPDATE',
        before: { name: before.name, archived: false },
        after: { name: before.name, archived: true },
      })
    },
    client,
  )
}
