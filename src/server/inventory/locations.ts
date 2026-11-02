import type { LocationType, Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { createLocationSchema, updateLocationSchema } from '@/lib/validation/locations'
import { parseInput } from '@/lib/validation/parse'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError, ValidationError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import type { AuthContext } from '@/server/auth/types'

/**
 * Where stock sits (brief §9, slice 23).
 *
 * A location is never deleted: `isActive` retires it, because a movement that names it must keep
 * naming something. Retiring one that still holds stock is refused rather than silently stranding
 * the quantity where no receiving or transfer form can reach it.
 *
 * Like the catalogue, this is not tenant data — one store serves every customer — so `part.read` is
 * the whole read check and `part.write` maintains it. The storekeeper holds both.
 */

export interface LocationSummary {
  id: string
  name: string
  type: LocationType
  parentId: string | null
  parentName: string | null
  isActive: boolean
  /** How many parts sit here at a non-zero quantity. Says what retiring it would strand. */
  partCount: number
  /** Summed across the parts here, so a warehouse shows what it holds at a glance. */
  quantity: number
}

const locationSelect = {
  id: true,
  name: true,
  type: true,
  parentId: true,
  isActive: true,
} satisfies Prisma.LocationSelect

type LocationRow = Prisma.LocationGetPayload<{ select: typeof locationSelect }>

/** Every location, active or retired, ordered so a dropdown groups the kinds. */
export async function listLocations(
  context: AuthContext,
  client: Tx = db,
): Promise<LocationSummary[]> {
  assertCan(context, 'part.read')

  const rows = await client.location.findMany({
    select: {
      ...locationSelect,
      stockLevels: { select: { quantity: true }, where: { NOT: { quantity: 0 } } },
    },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  })

  const names = new Map(
    (
      await client.location.findMany({
        where: { id: { in: rows.map((row) => row.parentId).filter((id): id is string => Boolean(id)) } },
        select: { id: true, name: true },
      })
    ).map((row) => [row.id, row.name]),
  )

  return rows.map((row) => ({
    ...row,
    parentName: row.parentId ? (names.get(row.parentId) ?? null) : null,
    partCount: row.stockLevels.length,
    quantity:
      Math.round(row.stockLevels.reduce((sum, level) => sum + Number(level.quantity), 0) * 1000) /
      1000,
  }))
}

/** The active locations a form may name. A retired one is not offered for new stock. */
export async function locationOptions(
  context: AuthContext,
  client: Tx = db,
  includeRetired = false,
): Promise<Array<{ id: string; name: string; type: LocationType }>> {
  assertCan(context, 'part.read')

  const rows = await client.location.findMany({
    where: includeRetired ? {} : { isActive: true },
    select: { id: true, name: true, type: true },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  })
  return rows
}

/**
 * The location ids a form named must exist before a movement points at them — the columns are
 * foreign keys, and an unreadable constraint error is a worse thing for the store to see than the
 * sentence that says which location went missing.
 */
export async function assertLocationsExist(tx: Tx, ids: readonly string[]): Promise<void> {
  const wanted = [...new Set(ids.filter(Boolean))]
  if (wanted.length === 0) return

  const found = await tx.location.findMany({ where: { id: { in: wanted } }, select: { id: true } })
  if (found.length !== wanted.length) {
    throw new ValidationError({ locationId: ['That location no longer exists. Refresh and try again.'] })
  }
}

export async function createLocation(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<LocationRow> {
  assertCan(context, 'part.write')
  const input = parseInput(createLocationSchema, raw)
  await assertNameFree(client, input.name, null)

  return withAudit(
    context,
    async (tx, log) => {
      await assertParent(tx, input.parentId, input.type)
      const row = await tx.location.create({ data: input, select: locationSelect })
      await log({ entity: 'Location', entityId: row.id, action: 'CREATE', after: auditShape(row) })
      return row
    },
    client,
  )
}

export async function updateLocation(
  context: AuthContext,
  locationId: string,
  raw: unknown,
  client: Tx = db,
): Promise<LocationRow> {
  assertCan(context, 'part.write')
  const input = parseInput(updateLocationSchema, raw)
  await assertNameFree(client, input.name, locationId)

  return withAudit(
    context,
    async (tx, log) => {
      const before = await tx.location.findUnique({
        where: { id: locationId },
        select: locationSelect,
      })
      if (!before) throw new NotFoundError('No such location.')

      await assertParent(tx, input.parentId, input.type, locationId)

      if (!input.isActive && before.isActive) {
        const held = await tx.stockLevel.findFirst({
          where: { locationId, NOT: { quantity: 0 } },
          select: { partId: true },
        })
        if (held) {
          throw new ValidationError({
            isActive: [
              'That location still holds stock. Transfer it out before retiring the location.',
            ],
          })
        }
      }

      const row = await tx.location.update({
        where: { id: locationId },
        data: input,
        select: locationSelect,
      })
      await log({
        entity: 'Location',
        entityId: row.id,
        action: 'UPDATE',
        before: auditShape(before),
        after: auditShape(row),
      })
      return row
    },
    client,
  )
}

/** Names are how people pick a location from a dropdown, so two "Van 1"s would be a support call. */
async function assertNameFree(client: Tx, name: string, exceptId: string | null): Promise<void> {
  const clash = await client.location.findFirst({
    where: { name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  })
  if (clash) throw new ValidationError({ name: ['A location with that name already exists.'] })
}

/**
 * A bin may sit inside a warehouse, and nothing may sit inside itself. Checked here rather than by a
 * constraint because `Location.parentId` is deliberately not a foreign key — see the schema.
 */
async function assertParent(
  tx: Tx,
  parentId: string | null,
  type: LocationType,
  selfId: string | null = null,
): Promise<void> {
  if (!parentId) return
  if (parentId === selfId) throw new ValidationError({ parentId: ['A location cannot contain itself.'] })
  if (type !== 'BIN') {
    throw new ValidationError({ parentId: ['Only a bin sits inside another location.'] })
  }

  const parent = await tx.location.findUnique({
    where: { id: parentId },
    select: { type: true },
  })
  if (!parent) throw new ValidationError({ parentId: ['Choose a location that exists.'] })
  if (parent.type !== 'WAREHOUSE') {
    throw new RuleError('A bin sits inside a warehouse. That location is not a warehouse.')
  }
}

function auditShape(row: LocationRow) {
  return { name: row.name, type: row.type, parentId: row.parentId, isActive: row.isActive }
}
