import type { Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import {
  createDeliveryOrderSchema,
  deliveryStatusFor,
  isOutstandingLoan,
  receiveDeliveryOrderSchema,
  returnDeliveryOrderSchema,
} from '@/lib/validation/delivery-orders'
import { parseInput } from '@/lib/validation/parse'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError, ValidationError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { deliveryOrderReadWhere, jobReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { nextDocumentNumber } from '@/server/documents/sequence'
import { renderDeliveryOrderPdf } from '@/server/documents/delivery-order'
import { getSettings } from '@/server/settings/settings'
import { storage } from '@/server/storage/storage'

/**
 * Delivery orders (brief §6.5, slice 18).
 *
 * **The parts on a DO are the parts already issued on a job, and nothing else.** They are read from
 * `StockMovement` rows of type `ISSUE` whose `jobId` is the job — never from a JSON list on the
 * report, and never typed again on the form. Raising a DO sets `StockMovement.deliveryOrderId` on
 * each movement, so the ledger and the paperwork are the same rows. That is the whole point of the
 * brief's "so stock and paperwork can't drift": one record of a part leaving the store.
 *
 * **Receiving does not move stock.** The movement happened when the part was issued. The DO records
 * who took it, when, and for a loan, how much has come back. A second movement here would
 * double-count the issue because `MovementType` has no "delivered" value — recorded as a known limit
 * in `ASSUMPTIONS.md`.
 *
 * Lines are snapshotted (description, quantity, serial) when the DO is raised, so a later part rename
 * cannot rewrite paperwork a customer has signed.
 */

export type DeliveryStatusName = 'DRAFT' | 'ISSUED' | 'PARTIAL' | 'DELIVERED' | 'RETURNED'

export interface DeliveryLineSummary {
  id: string
  partNumber: string | null
  description: string
  quantity: number
  receivedQuantity: number
  returnedQuantity: number
  serialOrBatch: string | null
  condition: string | null
  chargeType: 'CHARGEABLE' | 'WARRANTY' | 'LOAN'
  expectedReturnDate: Date | null
  /** A loan with something still out, which is the only reason to chase a DO a year later. */
  outstanding: boolean
}

export interface DeliveryOrderSummary {
  id: string
  number: string
  status: DeliveryStatusName
  issuedAt: Date | null
  receivedAt: Date | null
  receiverName: string | null
  receiverSignatureFileId: string | null
  receiverSignatureUrl: string | null
  deliveryAddress: string[]
  job: { id: string; number: string } | null
  customer: { id: string; name: string }
  lines: DeliveryLineSummary[]
}

/** A part issued on a job that no delivery order has claimed yet. */
export interface IssuedPartSummary {
  movementId: string
  partNumber: string
  description: string
  quantity: number
  serialOrBatch: string | null
  issuedAt: Date
}

const deliverySelect = {
  id: true,
  number: true,
  status: true,
  issuedAt: true,
  receivedAt: true,
  receiverName: true,
  receiverSignatureFileId: true,
  deliveryAddress: true,
  job: { select: { id: true, number: true } },
  customerId: true,
  lines: {
    orderBy: { id: 'asc' },
    select: {
      id: true,
      description: true,
      quantity: true,
      receivedQuantity: true,
      returnedQuantity: true,
      serialOrBatch: true,
      condition: true,
      chargeType: true,
      expectedReturnDate: true,
      movement: { select: { part: { select: { partNumber: true } } } },
    },
  },
} satisfies Prisma.DeliveryOrderSelect

type DeliveryRow = Prisma.DeliveryOrderGetPayload<{ select: typeof deliverySelect }>

/** Stored addresses are the site's JSON block; print the parts that were filled in. */
function addressLines(address: unknown): string[] {
  if (!address || typeof address !== 'object') return []
  return Object.values(address as Record<string, unknown>).filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  )
}

/** One batched lookup of the receiver signatures, so a list does not make a storage call per row. */
async function toSummaries(client: Tx, rows: DeliveryRow[]): Promise<DeliveryOrderSummary[]> {
  const fileIds = rows
    .map((row) => row.receiverSignatureFileId)
    .filter((id): id is string => Boolean(id))

  const files = fileIds.length
    ? await client.file.findMany({
        where: { id: { in: fileIds }, deletedAt: null },
        select: { id: true, storageKey: true },
      })
    : []
  const keyFor = new Map(files.map((file) => [file.id, file.storageKey]))

  // `DeliveryOrder` has no customer relation in the schema, so the name is one batched lookup by id.
  const customers = await client.customer.findMany({
    where: { id: { in: rows.map((row) => row.customerId) } },
    select: { id: true, legalName: true, tradingName: true },
  })
  const customerFor = new Map(customers.map((customer) => [customer.id, customer]))

  return Promise.all(
    rows.map(async (row) => {
      const key = row.receiverSignatureFileId ? keyFor.get(row.receiverSignatureFileId) : undefined
      const customer = customerFor.get(row.customerId)
      return {
        id: row.id,
        number: row.number,
        status: row.status,
        issuedAt: row.issuedAt,
        receivedAt: row.receivedAt,
        receiverName: row.receiverName,
        receiverSignatureFileId: row.receiverSignatureFileId,
        receiverSignatureUrl: key ? await storage().signedDownloadUrl(key) : null,
        deliveryAddress: addressLines(row.deliveryAddress),
        job: row.job,
        customer: {
          id: row.customerId,
          name: customer?.tradingName ?? customer?.legalName ?? 'Unknown customer',
        },
        lines: row.lines.map((line) => {
          const quantity = Number(line.quantity)
          const returned = Number(line.returnedQuantity ?? 0)
          return {
            id: line.id,
            partNumber: line.movement?.part.partNumber ?? null,
            description: line.description,
            quantity,
            receivedQuantity: Number(line.receivedQuantity),
            returnedQuantity: returned,
            serialOrBatch: line.serialOrBatch,
            condition: line.condition,
            chargeType: line.chargeType,
            expectedReturnDate: line.expectedReturnDate,
            outstanding: isOutstandingLoan({ chargeType: line.chargeType, quantity, returned }),
          }
        }),
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Delivery orders on one job, newest first — the job page's section. */
export async function deliveryOrdersForJob(
  context: AuthContext,
  jobId: string,
  client: Tx = db,
): Promise<DeliveryOrderSummary[]> {
  assertCan(context, 'part.read')
  const rows = await client.deliveryOrder.findMany({
    where: { ...deliveryOrderReadWhere(context), jobId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: deliverySelect,
  })
  return toSummaries(client, rows)
}

/** One delivery order. Scoped by the job, so a caller who cannot read the job cannot read this. */
export async function getDeliveryOrder(
  context: AuthContext,
  deliveryOrderId: string,
  client: Tx = db,
): Promise<DeliveryOrderSummary> {
  assertCan(context, 'part.read')
  const row = await client.deliveryOrder.findFirst({
    where: { id: deliveryOrderId, ...deliveryOrderReadWhere(context) },
    select: deliverySelect,
  })
  if (!row) throw new NotFoundError('No such delivery order.')
  const [summary] = await toSummaries(client, [row])
  return summary!
}

/**
 * The parts issued on a job that no delivery order has claimed yet.
 *
 * A movement already named by `StockMovement.deliveryOrderId` is on paperwork and is excluded, which
 * is what keeps a second DO from charging the same rope twice. Serial and batch ride along with the
 * movement — that is what makes "which rope went to which crane" traceable (brief §9).
 */
export async function issuedPartsForJob(
  context: AuthContext,
  jobId: string,
  client: Tx = db,
): Promise<IssuedPartSummary[]> {
  assertCan(context, 'part.read')

  const job = await client.job.findFirst({
    where: { id: jobId, ...jobReadWhere(context) },
    select: { id: true },
  })
  if (!job) throw new NotFoundError('No such job.')

  const movements = await client.stockMovement.findMany({
    where: { jobId, type: 'ISSUE', deliveryOrderId: null },
    orderBy: [{ movedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      quantity: true,
      serialOrBatch: true,
      movedAt: true,
      part: { select: { partNumber: true, description: true } },
    },
  })

  return movements.map((movement) => ({
    movementId: movement.id,
    partNumber: movement.part.partNumber,
    description: movement.part.description,
    quantity: Number(movement.quantity),
    serialOrBatch: movement.serialOrBatch,
    issuedAt: movement.movedAt,
  }))
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Raises a numbered delivery order from parts already issued on a job.
 *
 * The number is issued here rather than at receipt because the DO is the paper that travels with the
 * parts — the person at the gate signs a numbered document. Each movement is re-read under the job,
 * so a request naming a movement from another job, or one already on a DO, is refused by name rather
 * than producing a document whose lines and job disagree.
 */
export async function createDeliveryOrder(
  context: AuthContext,
  raw: unknown,
  client?: Tx,
): Promise<DeliveryOrderSummary> {
  assertCan(context, 'deliveryorder.write')
  const input = parseInput(createDeliveryOrderSchema, raw)

  return withAudit(
    context,
    async (tx, log) => {
      const job = await tx.job.findFirst({
        where: { id: input.jobId, ...jobReadWhere(context) },
        select: {
          id: true,
          number: true,
          customerId: true,
          site: { select: { address: true } },
        },
      })
      if (!job) throw new NotFoundError('No such job.')

      const movements = await tx.stockMovement.findMany({
        where: { id: { in: input.lines.map((line) => line.movementId) }, jobId: job.id },
        select: {
          id: true,
          type: true,
          deliveryOrderId: true,
          quantity: true,
          serialOrBatch: true,
          part: { select: { partNumber: true, description: true } },
        },
      })
      const byId = new Map(movements.map((movement) => [movement.id, movement]))

      // Every message names the part, because the fix is always "take that one off the form".
      for (const line of input.lines) {
        const movement = byId.get(line.movementId)
        if (!movement) throw new RuleError('One of those parts was not issued on this job.')
        if (movement.type !== 'ISSUE') {
          throw new RuleError(`${movement.part.partNumber} did not leave the store on this job.`)
        }
        if (movement.deliveryOrderId) {
          throw new RuleError(
            `${movement.part.partNumber} is already on a delivery order for ${job.number}.`,
          )
        }
      }

      const settings = await getSettings(tx)
      const issuedAt = new Date()
      const number = await nextDocumentNumber(tx, 'DELIVERY_ORDER', {
        at: issuedAt,
        timeZone: settings.timezone,
      })

      const order = await tx.deliveryOrder.create({
        data: {
          number,
          jobId: job.id,
          customerId: job.customerId,
          deliveryAddress: (job.site.address ?? undefined) as Prisma.InputJsonValue | undefined,
          status: 'ISSUED',
          issuedAt,
          lines: {
            create: input.lines.map((line) => {
              const movement = byId.get(line.movementId)!
              return {
                movementId: movement.id,
                description: `${movement.part.partNumber} — ${movement.part.description}`,
                quantity: movement.quantity,
                serialOrBatch: movement.serialOrBatch,
                condition: line.condition,
                chargeType: line.chargeType,
                expectedReturnDate: line.expectedReturnDate,
              }
            }),
          },
        },
        select: deliverySelect,
      })

      // The ledger row now knows which document covers it. Same transaction: a DO whose lines were
      // not claimed would let the same part go onto a second one.
      await tx.stockMovement.updateMany({
        where: { id: { in: input.lines.map((line) => line.movementId) } },
        data: { deliveryOrderId: order.id },
      })

      await log({
        entity: 'DeliveryOrder',
        entityId: order.id,
        action: 'CREATE',
        after: {
          number: order.number,
          jobId: job.id,
          status: order.status,
          lines: order.lines.map((line) => ({
            description: line.description,
            quantity: Number(line.quantity),
            chargeType: line.chargeType,
          })),
        },
      })

      const [summary] = await toSummaries(tx, [order])
      return summary!
    },
    client,
  )
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/**
 * Renders a delivery order as a PDF, as it stands now.
 *
 * Rendered on demand rather than stored, because a DO is not immutable the way an approved report is:
 * it gains received quantities and the receiver's signature when the parts are handed over. A stored
 * copy would go stale the moment somebody signs for a partial load, and a DO has no numbering
 * moment to pin a frozen version to. The renderer pins its own dates, so two requests for an
 * unchanged DO produce the same bytes.
 */
export async function renderDeliveryOrder(
  context: AuthContext,
  deliveryOrderId: string,
  client: Tx = db,
): Promise<{ filename: string; bytes: Buffer }> {
  assertCan(context, 'part.read')
  const order = await getDeliveryOrder(context, deliveryOrderId, client)

  let signature: Uint8Array | null = null
  if (order.receiverSignatureFileId) {
    const file = await client.file.findFirst({
      where: { id: order.receiverSignatureFileId, deletedAt: null },
      select: { storageKey: true },
    })
    if (file) {
      // A missing image must not remove the document: the text is the evidence, the picture is a
      // record of it. Same rule the report renderer follows.
      signature = await storage()
        .get(file.storageKey)
        .catch(() => null)
    }
  }

  const settings = await getSettings(client)
  const bytes = await renderDeliveryOrderPdf({
    number: order.number,
    issuedAt: order.issuedAt ?? new Date(),
    timeZone: settings.timezone,
    customer: { name: order.customer.name },
    job: order.job,
    deliveryAddress: order.deliveryAddress,
    receiverName: order.receiverName,
    receivedAt: order.receivedAt,
    signature,
    lines: order.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      receivedQuantity: line.receivedQuantity,
      serialOrBatch: line.serialOrBatch,
      condition: line.condition,
      chargeType: line.chargeType,
      expectedReturnDate: line.expectedReturnDate,
    })),
  })

  return { filename: `${order.number}.pdf`, bytes }
}

/**
 * Records that the customer's representative took the parts, in part or in full.
 *
 * `received` is the running total for the line, so a second handover fills in the remainder and a
 * repeat of the same count changes nothing. Anything above what was ordered is a typo, not a
 * quantity, and is refused against the line it belongs to. The status is derived from the lines, so
 * it cannot disagree with them.
 */
export async function receiveDeliveryOrder(
  context: AuthContext,
  deliveryOrderId: string,
  raw: unknown,
  client?: Tx,
): Promise<DeliveryOrderSummary> {
  assertCan(context, 'deliveryorder.write')
  const input = parseInput(receiveDeliveryOrderSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const order = await tx.deliveryOrder.findFirst({
        where: { id: deliveryOrderId, ...deliveryOrderReadWhere(context) },
        select: {
          id: true,
          number: true,
          status: true,
          receiverName: true,
          receiverSignatureFileId: true,
          lines: {
            select: { id: true, description: true, quantity: true, receivedQuantity: true },
          },
        },
      })
      if (!order) throw new NotFoundError('No such delivery order.')
      if (order.status === 'RETURNED') throw new RuleError('That delivery order is closed.')

      const signature = await tx.file.findFirst({
        where: {
          id: input.signatureFileId,
          kind: 'SIGNATURE',
          entity: 'DeliveryOrder',
          entityId: order.id,
          deletedAt: null,
        },
        select: { id: true },
      })
      if (!signature) {
        throw new ValidationError({ signatureFileId: ['That signature upload was not found.'] })
      }

      const byId = new Map(order.lines.map((line) => [line.id, line]))
      const receivedFor = new Map<string, number>()

      for (const [index, posted] of input.lines.entries()) {
        const line = byId.get(posted.lineId)
        if (!line) throw new RuleError('One of those lines is not on this delivery order.')

        const ordered = Number(line.quantity)
        if (posted.received > ordered) {
          throw new ValidationError({
            [`lines.${index}.received`]: [
              `${line.description}: ${ordered} was ordered, so ${posted.received} cannot have been received.`,
            ],
          })
        }
        // Never go backwards: re-posting a smaller total does not un-deliver anything.
        receivedFor.set(line.id, Math.max(Number(line.receivedQuantity), posted.received))
      }

      const status = deliveryStatusFor(
        order.lines.map((line) => ({
          quantity: Number(line.quantity),
          received: receivedFor.get(line.id) ?? Number(line.receivedQuantity),
        })),
      )

      await tx.deliveryOrder.update({
        where: { id: order.id },
        data: {
          status,
          receiverName: input.receiverName,
          receiverSignatureFileId: signature.id,
          receivedAt: new Date(),
        },
      })

      for (const [lineId, received] of receivedFor) {
        await tx.deliveryOrderLine.update({
          where: { id: lineId },
          data: { receivedQuantity: received },
        })
      }

      await log({
        entity: 'DeliveryOrder',
        entityId: order.id,
        action: 'UPDATE',
        before: { status: order.status, receiverName: order.receiverName },
        after: {
          status,
          receiverName: input.receiverName,
          receiverSignatureFileId: signature.id,
          linesReceived: Object.fromEntries(receivedFor),
        },
      })
    },
    client,
  )

  return getDeliveryOrder(context, deliveryOrderId, client)
}

/**
 * Loan equipment coming back.
 *
 * Only a `LOAN` line can be returned — a chargeable part sold to the customer is theirs, and a
 * warranty replacement is not ours to collect. The DO moves to `RETURNED` once every loan line is
 * whole, which is what closes it for good.
 */
export async function returnDeliveryOrder(
  context: AuthContext,
  deliveryOrderId: string,
  raw: unknown,
  client?: Tx,
): Promise<DeliveryOrderSummary> {
  assertCan(context, 'deliveryorder.write')
  const input = parseInput(returnDeliveryOrderSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const order = await tx.deliveryOrder.findFirst({
        where: { id: deliveryOrderId, ...deliveryOrderReadWhere(context) },
        select: {
          id: true,
          status: true,
          lines: {
            select: {
              id: true,
              description: true,
              quantity: true,
              chargeType: true,
              returnedQuantity: true,
            },
          },
        },
      })
      if (!order) throw new NotFoundError('No such delivery order.')

      const byId = new Map(order.lines.map((line) => [line.id, line]))
      const returnedFor = new Map<string, number>()

      for (const [index, posted] of input.lines.entries()) {
        const line = byId.get(posted.lineId)
        if (!line) throw new RuleError('One of those lines is not on this delivery order.')
        if (line.chargeType !== 'LOAN') {
          throw new ValidationError({
            [`lines.${index}.returned`]: [
              `${line.description} is not loan equipment — there is nothing to return.`,
            ],
          })
        }

        const ordered = Number(line.quantity)
        if (posted.returned > ordered) {
          throw new ValidationError({
            [`lines.${index}.returned`]: [
              `${line.description}: ${ordered} went out, so ${posted.returned} cannot have come back.`,
            ],
          })
        }
        returnedFor.set(line.id, Math.max(Number(line.returnedQuantity ?? 0), posted.returned))
      }

      for (const [lineId, returned] of returnedFor) {
        await tx.deliveryOrderLine.update({
          where: { id: lineId },
          data: { returnedQuantity: returned },
        })
      }

      const loans = order.lines
        .filter((line) => line.chargeType === 'LOAN')
        .map((line) => ({
          chargeType: 'LOAN' as const,
          quantity: Number(line.quantity),
          returned: returnedFor.get(line.id) ?? Number(line.returnedQuantity ?? 0),
        }))
      const allBack = loans.every((line) => !isOutstandingLoan(line))

      if (allBack && order.status !== 'RETURNED') {
        await tx.deliveryOrder.update({
          where: { id: order.id },
          data: { status: 'RETURNED' },
        })
      }

      await log({
        entity: 'DeliveryOrder',
        entityId: order.id,
        action: 'UPDATE',
        before: { status: order.status },
        after: {
          status: allBack ? 'RETURNED' : order.status,
          returned: Object.fromEntries(returnedFor),
          ...(input.note ? { note: input.note } : {}),
        },
      })
    },
    client,
  )

  return getDeliveryOrder(context, deliveryOrderId, client)
}
