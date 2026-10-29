import type { Prisma, PurchaseOrderStatus } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import { createSupplierSchema, updateSupplierSchema } from '@/lib/validation/suppliers'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError, ValidationError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import type { AuthContext } from '@/server/auth/types'

/**
 * The supplier book (brief §9, slice 27).
 *
 * A supplier is never deleted: `deletedAt` retires it, because the parts that prefer it and the
 * orders raised from it must keep naming a record. Retiring one that still supplies a part is
 * refused by saying how many — a part whose supplier is retired sits in a reorder group the store
 * cannot order from, which is the one thing this screen exists to prevent.
 *
 * Like the catalogue and its locations, this is not tenant data: one supplier serves every customer,
 * so `part.read` is the whole read check.
 */

export interface SupplierPart {
  id: string
  partNumber: string
  description: string
  cost: number
}

export interface SupplierOrder {
  id: string
  number: string
  status: PurchaseOrderStatus
  /** When it was sent, else when it was raised — the date the price on it belongs to. */
  orderedAt: Date
  total: number
}

export interface SupplierSummary {
  id: string
  name: string
  contactName: string | null
  phone: string | null
  email: string | null
  leadTimeDays: number | null
  notes: string | null
  isActive: boolean
  /** The parts that prefer it — what retiring it would strand. */
  parts: SupplierPart[]
  /** Its recent orders, newest first: the price history is what was actually paid. */
  orders: SupplierOrder[]
}

const supplierSelect = {
  id: true,
  name: true,
  contactName: true,
  phone: true,
  email: true,
  leadTimeDays: true,
  notes: true,
  deletedAt: true,
  parts: {
    where: { deletedAt: null },
    select: { id: true, partNumber: true, description: true, cost: true },
    orderBy: { partNumber: 'asc' },
  },
  purchaseOrders: {
    select: { id: true, number: true, status: true, orderedAt: true, createdAt: true, total: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  },
} satisfies Prisma.SupplierSelect

type SupplierRow = Prisma.SupplierGetPayload<{ select: typeof supplierSelect }>

function toSummary(row: SupplierRow): SupplierSummary {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contactName,
    phone: row.phone,
    email: row.email,
    leadTimeDays: row.leadTimeDays,
    notes: row.notes,
    isActive: row.deletedAt === null,
    parts: row.parts.map((part) => ({ ...part, cost: Number(part.cost) })),
    orders: row.purchaseOrders.map((order) => ({
      id: order.id,
      number: order.number,
      status: order.status,
      orderedAt: order.orderedAt ?? order.createdAt,
      total: Number(order.total),
    })),
  }
}

/** The book, active first and then by name. */
export async function listSuppliers(
  context: AuthContext,
  client: Tx = db,
): Promise<SupplierSummary[]> {
  assertCan(context, 'part.read')

  const rows = await client.supplier.findMany({
    orderBy: [{ deletedAt: 'asc' }, { name: 'asc' }],
    select: supplierSelect,
  })
  return rows.map(toSummary)
}

/** The active suppliers a part may prefer. A retired one is not offered for new stock. */
export async function supplierOptions(
  context: AuthContext,
  client: Tx = db,
): Promise<Array<{ id: string; name: string; leadTimeDays: number | null }>> {
  assertCan(context, 'part.read')

  return client.supplier.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, leadTimeDays: true },
    orderBy: { name: 'asc' },
  })
}

export async function createSupplier(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<SupplierSummary> {
  assertCan(context, 'supplier.write')
  const { isActive, ...input } = parseInput(createSupplierSchema, raw)
  await assertNameFree(client, input.name, null)

  const created = await withAudit(
    context,
    async (tx, log) => {
      const row = await tx.supplier.create({
        data: { ...input, deletedAt: isActive ? null : new Date() },
        select: supplierSelect,
      })
      await log({ entity: 'Supplier', entityId: row.id, action: 'CREATE', after: auditShape(row) })
      return row
    },
    client,
  )

  return toSummary(created)
}

export async function updateSupplier(
  context: AuthContext,
  supplierId: string,
  raw: unknown,
  client: Tx = db,
): Promise<SupplierSummary> {
  assertCan(context, 'supplier.write')
  const { isActive, ...input } = parseInput(updateSupplierSchema, raw)
  await assertNameFree(client, input.name, supplierId)

  const updated = await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.supplier.findUnique({ where: { id: supplierId }, select: supplierSelect })
      if (!before) throw new NotFoundError('No such supplier.')

      if (!isActive && before.deletedAt === null && before.parts.length > 0) {
        const count = before.parts.length
        throw new ValidationError({
          isActive: [
            `${count} part${count === 1 ? '' : 's'} still prefer this supplier. Point ${count === 1 ? 'it' : 'them'} at another supplier before retiring it.`,
          ],
        })
      }

      const row = await tx.supplier.update({
        where: { id: supplierId },
        data: { ...input, deletedAt: isActive ? null : (before.deletedAt ?? new Date()) },
        select: supplierSelect,
      })
      await log({
        entity: 'Supplier',
        entityId: row.id,
        action: 'UPDATE',
        before: auditShape(before),
        after: auditShape(row),
      })
      return row
    },
    client,
  )

  return toSummary(updated)
}

/** A part may only prefer a supplier that is still active — a retired one would raise no order. */
export async function assertSupplierActive(client: Tx, supplierId: string): Promise<void> {
  const supplier = await client.supplier.findFirst({
    where: { id: supplierId, deletedAt: null },
    select: { id: true },
  })
  if (!supplier) throw new RuleError('That supplier has been retired. Choose an active one.')
}

async function assertNameFree(client: Tx, name: string, exceptId: string | null): Promise<void> {
  const clash = await client.supplier.findFirst({
    where: { name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  })
  if (clash) throw new ValidationError({ name: ['A supplier with that name already exists.'] })
}

function auditShape(row: SupplierRow) {
  return {
    name: row.name,
    contactName: row.contactName,
    phone: row.phone,
    email: row.email,
    leadTimeDays: row.leadTimeDays,
    retired: row.deletedAt !== null,
  }
}
