import type { MovementType } from '@prisma/client'
import type { Tx } from '@/lib/db'
import { locationBalances, movementSigns } from '@/lib/validation/parts'
import type { AuditLogger } from '@/server/audit/audit'
import { ValidationError } from '@/server/auth/errors'

/**
 * The stock ledger (brief §9, CLAUDE.md rule 10, slice 22).
 *
 * **This is the only function that may write** `StockMovement` or `StockLevel`. A quantity changes
 * because a movement was posted, and the movement and the materialised level are written in the same
 * transaction — the level can lag the ledger no more than the ledger can lag itself.
 *
 * Callers pass the audit logger from their own transaction, so a report's issue row, the level it
 * moved and the audit entry for both commit together. `postMovement` decides the sign; no caller
 * passes a negative quantity.
 */

export interface PostMovementInput {
  partId: string
  type: MovementType
  /** Always positive. The direction comes from `type`, never from the sign. */
  quantity: number
  fromLocationId?: string | null
  toLocationId?: string | null
  serialOrBatch?: string | null
  reasonCode?: string | null
  unitCost?: number | null
  jobId?: string | null
  reportId?: string | null
  deliveryOrderId?: string | null
  purchaseOrderId?: string | null
  stockTakeId?: string | null
  movedById?: string | null
  /** When it happened. Defaults to now; the seed uses it to date an opening balance. */
  movedAt?: Date
}

/** Default home of a receipt or an adjustment when the caller names no location. */
export async function defaultLocation(client: Tx): Promise<string> {
  const store = await client.location.findFirst({
    where: { isActive: true, type: 'WAREHOUSE' },
    orderBy: { name: 'asc' },
    select: { id: true },
  })
  if (store) return store.id

  // The store is the first row a fresh database has; a movement with nowhere to go is not worth a
  // silent skip, so make the location rather than refuse the receipt.
  const made = await client.location.create({
    data: { name: 'Main store', type: 'WAREHOUSE' },
    select: { id: true },
  })
  return made.id
}

/** Applies one movement's delta to a location's level. `upsert` because a part may never have been there. */
async function applyLevel(
  client: Tx,
  partId: string,
  locationId: string,
  delta: number,
): Promise<void> {
  // Rounded to the ledger's three decimals so 0.1 + 0.2 does not leave a float in a `Decimal(12,3)`.
  const step = Math.round(delta * 1000) / 1000
  await client.stockLevel.upsert({
    where: { partId_locationId: { partId, locationId } },
    create: { partId, locationId, quantity: step },
    update: { quantity: { increment: step } },
  })
}

/**
 * Posts one movement and moves the levels it touches. Audits the movement row.
 *
 * Joins the caller's transaction — never opens its own — so a caller that fails afterwards leaves no
 * ledger entry behind.
 */
export async function postMovement(
  tx: Tx,
  log: AuditLogger,
  input: PostMovementInput,
): Promise<{ id: string }> {
  if (!(input.quantity > 0)) {
    throw new ValidationError({ quantity: ['A stock quantity must be above zero.'] })
  }

  const signs = movementSigns(input.type, Boolean(input.fromLocationId))
  const fromLocationId = signs.from !== 0 ? (input.fromLocationId ?? null) : null
  const toLocationId =
    signs.to !== 0 ? (input.toLocationId ?? (await defaultLocation(tx))) : null

  const movement = await tx.stockMovement.create({
    data: {
      partId: input.partId,
      type: input.type,
      quantity: input.quantity,
      fromLocationId,
      toLocationId,
      serialOrBatch: input.serialOrBatch ?? null,
      reasonCode: input.reasonCode ?? null,
      unitCost: input.unitCost ?? null,
      jobId: input.jobId ?? null,
      reportId: input.reportId ?? null,
      deliveryOrderId: input.deliveryOrderId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      stockTakeId: input.stockTakeId ?? null,
      movedById: input.movedById ?? null,
      ...(input.movedAt ? { movedAt: input.movedAt } : {}),
    },
    select: { id: true },
  })

  if (fromLocationId && signs.from !== 0) {
    await applyLevel(tx, input.partId, fromLocationId, -input.quantity)
  }
  if (toLocationId && signs.to !== 0) {
    await applyLevel(tx, input.partId, toLocationId, input.quantity)
  }

  await log({
    entity: 'StockMovement',
    entityId: movement.id,
    action: 'CREATE',
    after: {
      partId: input.partId,
      type: input.type,
      quantity: input.quantity,
      fromLocationId,
      toLocationId,
      jobId: input.jobId ?? null,
      reportId: input.reportId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      stockTakeId: input.stockTakeId ?? null,
    } as unknown as Record<string, unknown>,
  })

  return movement
}

/**
 * The location an issue should come out of when the caller does not name one.
 *
 * With a serial, wherever **that serial** is: a part may be plentiful in one bin while the named
 * batch sits in a van, and issuing from the full bin would move the wrong stock. Without one, or if
 * the serial is not on the books, wherever the most of the part is. With no stock anywhere it falls
 * back to the store, and the movement may take the level negative — see `needsReorder` for why that
 * beats refusing a signed report.
 */
export async function issueLocationFor(
  client: Tx,
  partId: string,
  serialOrBatch?: string | null,
): Promise<string> {
  if (serialOrBatch) {
    const rows = await client.stockMovement.findMany({
      where: { partId, serialOrBatch },
      select: { type: true, quantity: true, fromLocationId: true, toLocationId: true },
    })
    const holding = [...locationBalances(rows.map((row) => ({ ...row, quantity: Number(row.quantity) })))]
      .filter(([, quantity]) => quantity > 0)
      .sort((left, right) => right[1] - left[1])[0]
    if (holding) return holding[0]
  }

  const fullest = await client.stockLevel.findFirst({
    where: { partId },
    orderBy: { quantity: 'desc' },
    select: { locationId: true },
  })
  return fullest?.locationId ?? defaultLocation(client)
}
