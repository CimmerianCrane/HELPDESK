import type { CraneStatus, CraneType, Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import {
  createCraneSchema,
  craneFilterSchema,
  restrictCraneSchema,
  unrestrictCraneSchema,
  updateCraneSchema,
  type CraneFilter,
} from '@/lib/validation/cranes'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { craneReadWhere, customerReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { generateQrValue, suggestAssetTag } from './qr'

/**
 * The crane register (brief §12.3).
 *
 * A crane is never really deleted: it accumulates a service history, and a report that cites a crane
 * which no longer exists is worthless. Archiving takes it out of the working register and leaves the
 * history readable.
 *
 * Restriction is the one status change with its own rule: a crane cannot be restricted without a
 * reason, and the reason is stored on the crane itself as well as in the audit log, because the
 * technician at the machine needs to read it there (CLAUDE.md rule 2).
 */

export interface CraneSiteRef {
  id: string
  name: string
  customerId: string
  customerName: string
}

export interface CraneSummary {
  id: string
  assetTag: string
  qrValue: string
  type: CraneType
  brand: string | null
  model: string | null
  serialNumber: string | null
  swlKg: number
  status: CraneStatus
  restrictedReason: string | null
  site: CraneSiteRef
  locationOnSite: string | null
  createdAt: Date
}

export interface CraneDetail extends CraneSummary {
  /** Jobs and reports that reference this crane. Non-zero means it has a history worth keeping. */
  historyCount: number
  yearOfManufacture: number | null
  statutoryRegistrationNo: string | null
  registrationDate: Date | null
  ownerEntity: string | null
  hourMeter: number | null
  notes: string | null
  restrictedAt: Date | null
}

const craneSelect = {
  id: true,
  assetTag: true,
  qrValue: true,
  type: true,
  brand: true,
  model: true,
  serialNumber: true,
  swlKg: true,
  status: true,
  restrictedReason: true,
  locationOnSite: true,
  createdAt: true,
  site: {
    select: {
      id: true,
      name: true,
      customerId: true,
      customer: { select: { legalName: true } },
    },
  },
} satisfies Prisma.CraneSelect

type CraneRow = Prisma.CraneGetPayload<{ select: typeof craneSelect }>

function toSummary(row: CraneRow): CraneSummary {
  return {
    id: row.id,
    assetTag: row.assetTag,
    qrValue: row.qrValue,
    type: row.type,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serialNumber,
    swlKg: Number(row.swlKg),
    status: row.status,
    restrictedReason: row.restrictedReason,
    locationOnSite: row.locationOnSite,
    site: {
      id: row.site.id,
      name: row.site.name,
      customerId: row.site.customerId,
      customerName: row.site.customer.legalName,
    },
    createdAt: row.createdAt,
  }
}

function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listCranes(
  context: AuthContext,
  rawFilters: unknown = {},
  client: Tx = db,
): Promise<CraneSummary[]> {
  assertCan(context, 'crane.read')
  const filters = parseInput(craneFilterSchema, rawFilters) as CraneFilter

  const where: Prisma.CraneWhereInput = {
    ...craneReadWhere(context),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.siteId ? { siteId: filters.siteId } : {}),
    ...(filters.q
      ? {
          OR: [
            { assetTag: { contains: filters.q, mode: 'insensitive' } },
            { serialNumber: { contains: filters.q, mode: 'insensitive' } },
            { brand: { contains: filters.q, mode: 'insensitive' } },
            { model: { contains: filters.q, mode: 'insensitive' } },
            { statutoryRegistrationNo: { contains: filters.q, mode: 'insensitive' } },
            { site: { name: { contains: filters.q, mode: 'insensitive' } } },
            { site: { customer: { legalName: { contains: filters.q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  }

  const rows = await client.crane.findMany({
    where,
    select: craneSelect,
    orderBy: [{ assetTag: 'asc' }],
    take: 500,
  })
  return rows.map(toSummary)
}

export async function getCrane(
  context: AuthContext,
  craneId: string,
  client: Tx = db,
): Promise<CraneDetail> {
  assertCan(context, 'crane.read')

  const row = await client.crane.findFirst({
    where: { id: craneId, ...craneReadWhere(context) },
    select: {
      ...craneSelect,
      yearOfManufacture: true,
      statutoryRegistrationNo: true,
      registrationDate: true,
      ownerEntity: true,
      hourMeter: true,
      notes: true,
      restrictedAt: true,
      _count: { select: { jobs: true, reports: true } },
    },
  })
  if (!row) throw new NotFoundError('No such crane.')

  return {
    ...toSummary(row),
    historyCount: row._count.jobs + row._count.reports,
    yearOfManufacture: row.yearOfManufacture,
    statutoryRegistrationNo: row.statutoryRegistrationNo,
    registrationDate: row.registrationDate,
    ownerEntity: row.ownerEntity,
    hourMeter: toNumber(row.hourMeter),
    notes: row.notes,
    restrictedAt: row.restrictedAt,
  }
}

/** Resolves a scanned QR token to a crane the caller is allowed to see. Null means "not yours". */
export async function findCraneByQrValue(
  context: AuthContext,
  qrValue: string,
  client: Tx = db,
): Promise<{ id: string } | null> {
  assertCan(context, 'crane.read')
  return client.crane.findFirst({
    where: { qrValue, ...craneReadWhere(context) },
    select: { id: true },
  })
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Fills in the two generated identifiers, and refuses an asset tag already in the register. */
function buildIdentity(input: { assetTag: string | null; qrValue: string | null }) {
  return {
    assetTag: input.assetTag ?? suggestAssetTag(),
    qrValue: input.qrValue ?? generateQrValue(),
  }
}

export async function createCrane(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<CraneSummary> {
  assertCan(context, 'crane.write')
  const input = parseInput(createCraneSchema, raw)

  const created = await withAudit(
    context,
    async (tx, log) => {
      const site = await tx.site.findFirst({
        where: { id: input.siteId, deletedAt: null, customer: customerReadWhere(context) },
        select: { id: true, customerId: true },
      })
      if (!site) throw new NotFoundError('No such site.')

      // The id is carried in the form, but the site is the truth: taking the customer from the form
      // would let a crane be filed under a different company than the site it stands on.
      if (site.customerId !== input.customerId) {
        throw new RuleError('That site belongs to a different customer.')
      }

      const identity = buildIdentity(input)
      const clash = await tx.crane.findFirst({
        where: { deletedAt: null, assetTag: { equals: identity.assetTag, mode: 'insensitive' } },
        select: { id: true, assetTag: true },
      })
      if (clash) throw new RuleError(`Asset tag “${clash.assetTag}” is already in the register.`)

      const crane = await tx.crane.create({
        data: {
          customerId: site.customerId,
          siteId: site.id,
          assetTag: identity.assetTag,
          qrValue: identity.qrValue,
          type: input.type,
          brand: input.brand,
          model: input.model,
          serialNumber: input.serialNumber,
          swlKg: input.swlKg,
          yearOfManufacture: input.yearOfManufacture,
          statutoryRegistrationNo: input.statutoryRegistrationNo,
          registrationDate: input.registrationDate,
          ownerEntity: input.ownerEntity,
          locationOnSite: input.locationOnSite,
          hourMeter: input.hourMeter,
          notes: input.notes,
          status: 'IN_SERVICE',
          createdById: context.userId,
        },
        select: craneSelect,
      })

      await log({
        entity: 'Crane',
        entityId: crane.id,
        action: 'CREATE',
        after: { ...toSummary(crane) },
      })
      return crane
    },
    client,
  )

  return toSummary(created)
}

export async function updateCrane(
  context: AuthContext,
  craneId: string,
  raw: unknown,
  client: Tx = db,
): Promise<CraneSummary> {
  assertCan(context, 'crane.write')
  const input = parseInput(updateCraneSchema, raw)

  const updated = await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.crane.findFirst({
        where: { id: craneId, ...craneReadWhere(context) },
        select: { ...craneSelect, deletedAt: true },
      })
      if (!before || before.deletedAt) throw new NotFoundError('No such crane.')

      const site = await tx.site.findFirst({
        where: { id: input.siteId, deletedAt: null, customer: customerReadWhere(context) },
        select: { id: true, customerId: true },
      })
      if (!site) throw new NotFoundError('No such site.')
      if (site.customerId !== input.customerId) {
        throw new RuleError('That site belongs to a different customer.')
      }

      // The generated identifiers are stable. An edit may correct the asset tag, but not the QR
      // token — the sticker is already on the machine, and changing the value would orphan it.
      const assetTag = input.assetTag ?? before.assetTag
      if (assetTag.toLowerCase() !== before.assetTag.toLowerCase()) {
        const clash = await tx.crane.findFirst({
          where: {
            id: { not: craneId },
            deletedAt: null,
            assetTag: { equals: assetTag, mode: 'insensitive' },
          },
          select: { id: true },
        })
        if (clash) throw new RuleError(`Asset tag “${assetTag}” is already in the register.`)
      }

      const after = await tx.crane.update({
        where: { id: craneId },
        data: {
          siteId: site.id,
          customerId: site.customerId,
          assetTag,
          type: input.type,
          brand: input.brand,
          model: input.model,
          serialNumber: input.serialNumber,
          swlKg: input.swlKg,
          yearOfManufacture: input.yearOfManufacture,
          statutoryRegistrationNo: input.statutoryRegistrationNo,
          registrationDate: input.registrationDate,
          ownerEntity: input.ownerEntity,
          locationOnSite: input.locationOnSite,
          hourMeter: input.hourMeter,
          notes: input.notes,
        },
        select: craneSelect,
      })

      await log({
        entity: 'Crane',
        entityId: craneId,
        action: 'UPDATE',
        before: { ...toSummary(before) },
        after: { ...toSummary(after) },
      })
      return after
    },
    client,
  )

  return toSummary(updated)
}

/**
 * Puts a crane out of service pending investigation. The reason is mandatory, both in the schema and
 * in a database CHECK constraint — this is the flag that stops someone rigging a suspect hoist.
 */
export async function restrictCrane(
  context: AuthContext,
  craneId: string,
  raw: unknown,
  client: Tx = db,
): Promise<CraneSummary> {
  assertCan(context, 'crane.restrict')
  const input = parseInput(restrictCraneSchema, raw)

  const updated = await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.crane.findFirst({
        where: { id: craneId, ...craneReadWhere(context) },
        select: craneSelect,
      })
      if (!before) throw new NotFoundError('No such crane.')
      if (before.status === 'DECOMMISSIONED') {
        throw new RuleError('This crane is decommissioned. There is nothing left to restrict.')
      }

      const after = await tx.crane.update({
        where: { id: craneId },
        data: {
          status: 'RESTRICTED',
          restrictedReason: input.reason,
          restrictedAt: new Date(),
          restrictedById: context.userId,
        },
        select: craneSelect,
      })

      await log({
        entity: 'Crane',
        entityId: craneId,
        action: 'UPDATE',
        before: { status: before.status, restrictedReason: before.restrictedReason },
        after: { status: after.status, restrictedReason: after.restrictedReason },
      })
      return after
    },
    client,
  )

  return toSummary(updated)
}

/** Clears a restriction. The previous reason stays in the audit log, which is where it belongs. */
export async function unrestrictCrane(
  context: AuthContext,
  craneId: string,
  raw: unknown,
  client: Tx = db,
): Promise<CraneSummary> {
  assertCan(context, 'crane.restrict')
  const input = parseInput(unrestrictCraneSchema, raw)

  const updated = await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.crane.findFirst({
        where: { id: craneId, ...craneReadWhere(context) },
        select: craneSelect,
      })
      if (!before) throw new NotFoundError('No such crane.')
      if (before.status !== 'RESTRICTED') {
        throw new RuleError('This crane is not restricted.')
      }

      const after = await tx.crane.update({
        where: { id: craneId },
        data: {
          status: 'IN_SERVICE',
          restrictedReason: null,
          restrictedAt: null,
          restrictedById: null,
        },
        select: craneSelect,
      })

      await log({
        entity: 'Crane',
        entityId: craneId,
        action: 'UPDATE',
        before: { status: before.status, restrictedReason: before.restrictedReason },
        after: { status: after.status, restrictedReason: null, note: input.note },
      })
      return after
    },
    client,
  )

  return toSummary(updated)
}

export async function archiveCrane(
  context: AuthContext,
  craneId: string,
  client: Tx = db,
): Promise<void> {
  assertCan(context, 'crane.write')

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.crane.findFirst({
        where: { id: craneId, deletedAt: null },
        select: { id: true, assetTag: true, status: true },
      })
      if (!before) throw new NotFoundError('No such crane.')

      // A crane that has been worked on has a history worth keeping. Retiring it is a status, not a
      // delete; archiving is only for one entered by mistake.
      const history = await tx.jobCrane.count({ where: { craneId } })
      const reports = await tx.report.count({ where: { craneId } })
      if (history > 0 || reports > 0) {
        throw new RuleError(
          'This crane has job or report history. Set its status to decommissioned instead of archiving it.',
        )
      }

      await tx.crane.update({ where: { id: craneId }, data: { deletedAt: new Date() } })
      await log({
        entity: 'Crane',
        entityId: craneId,
        action: 'DELETE',
        before: { assetTag: before.assetTag, status: before.status },
      })
    },
    client,
  )
}
