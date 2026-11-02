import type { Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { formatDate } from '@/lib/format'
import { addDays } from '@/lib/time'
import {
  canMoveInvoice,
  createInvoiceSchema,
  INVOICE_STATUSES,
  invoiceFilterSchema,
  isInvoiceEditable,
  isInvoiceOverdue,
  isInvoicePayable,
  paidStatusFor,
  recordPaymentSchema,
  updateInvoiceSchema,
  voidInvoiceSchema,
  type InvoiceStatusName,
} from '@/lib/validation/invoices'
import { centsToDecimalString, documentTotals, pricedLines } from '@/lib/validation/money'
import { parseInput } from '@/lib/validation/parse'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { invoiceReadWhere, jobReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { renderInvoicePdf } from '@/server/documents/invoice'
import { nextDocumentNumber } from '@/server/documents/sequence'
import { canTransition } from '@/server/jobs/status'
import { getSettings, type Settings } from '@/server/settings/settings'

/**
 * Invoicing, GST and payments (brief §5, §12, slice 20).
 *
 * **An invoice is raised from a job that has been reviewed.** Its job costing is a prefill, not a
 * source of truth: the parts come from the `ISSUE` movements already recorded against the job (the
 * same rows a delivery order prints), and labour is a line the office types. What is stored is the
 * lines as written, so a later change to a part's price cannot rewrite a bill that has gone out.
 *
 * **The GST rate is snapshotted when the invoice is issued**, in `Invoice.gstRate`, the way a quote
 * snapshots it at save. A reprint and an accounting export both show the rate the customer was
 * charged, not whatever Settings says today.
 *
 * **`amountPaid` and the paid status are derived from the payments**, never posted. Recording money
 * sums the payments, writes the sum back, and lets the status follow — so `PART_PAID` cannot disagree
 * with the amounts the way a separately-set status could. The same rule the delivery order's receipt
 * follows.
 *
 * **Issuing an invoice moves its job to `INVOICED`** in the same transaction, when the job is
 * `REVIEWED` — the one edge the status machine has for it. Written here rather than through
 * `transitionJob` because finance does not hold `job.transition`; the status, its timestamp and its
 * history row are the same three writes.
 */

export interface InvoiceLineSummary {
  id: string
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface PaymentSummary {
  id: string
  amount: number
  method: string
  reference: string | null
  paidAt: Date
}

export interface InvoiceSummary {
  id: string
  number: string
  status: InvoiceStatusName
  issueDate: Date | null
  dueDate: Date | null
  overdue: boolean
  gstRate: number
  subtotal: number
  gstAmount: number
  total: number
  amountPaid: number
  balance: number
  editable: boolean
  payable: boolean
  /** Set only once a push to the accounting system succeeded (slice 37). */
  externalRef: string | null
  externalPushedAt: Date | null
  createdAt: Date
  customer: { id: string; name: string }
  job: { id: string; number: string; status: string } | null
  lines: InvoiceLineSummary[]
  payments: PaymentSummary[]
}

export interface InvoiceList {
  invoices: InvoiceSummary[]
  counts: Record<InvoiceStatusName, number>
  /** Total outstanding across every issued and partly paid invoice, in the list's currency. */
  outstanding: number
  /**
   * Billed but not yet in the accounting system — what a push would send. Counted across the whole
   * book, not the filtered list, so a filter cannot hide a bill the books are missing.
   */
  unpushed: number
}

/** Money the business has actually billed — the same set the accounting export sends. */
const BILLED: ReadonlySet<string> = new Set(['ISSUED', 'PART_PAID', 'PAID'])

const invoiceSelect = {
  id: true,
  number: true,
  status: true,
  issueDate: true,
  dueDate: true,
  gstRate: true,
  subtotal: true,
  gstAmount: true,
  total: true,
  amountPaid: true,
  externalRef: true,
  externalPushedAt: true,
  createdAt: true,
  customerId: true,
  customer: { select: { id: true, legalName: true, tradingName: true } },
  lines: {
    orderBy: { id: 'asc' },
    select: {
      id: true,
      description: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      jobId: true,
    },
  },
  payments: {
    orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
    select: { id: true, amount: true, method: true, reference: true, paidAt: true },
  },
} satisfies Prisma.InvoiceSelect

type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>

/**
 * Rows to what the screens show. The jobs behind the lines are one batched lookup, scoped like any
 * other job read so an invoice cannot reveal a job its reader may not see — the same reason
 * `toSummaries` in the quotes service does it.
 */
async function toSummaries(
  context: AuthContext,
  client: Tx,
  rows: InvoiceRow[],
  settings: Settings,
  now: Date,
): Promise<InvoiceSummary[]> {
  const jobIds = [
    ...new Set(rows.flatMap((row) => row.lines.map((line) => line.jobId)).filter((id): id is string => Boolean(id))),
  ]
  const jobs = jobIds.length
    ? await client.job.findMany({
        where: { id: { in: jobIds }, ...jobReadWhere(context) },
        select: { id: true, number: true, status: true },
      })
    : []
  const jobFor = new Map(jobs.map((job) => [job.id, job]))

  return rows.map((row) => {
    const status = row.status as InvoiceStatusName
    const total = Number(row.total)
    const amountPaid = Number(row.amountPaid)
    // Every line of an invoice raised from one job names it; the header shows the first.
    const job = row.lines.map((line) => (line.jobId ? jobFor.get(line.jobId) : undefined)).find(Boolean)

    return {
      id: row.id,
      number: row.number,
      status,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      overdue: isInvoiceOverdue({ status, dueDate: row.dueDate }, now, settings.timezone),
      gstRate: Number(row.gstRate),
      subtotal: Number(row.subtotal),
      gstAmount: Number(row.gstAmount),
      total,
      amountPaid,
      balance: Math.max(0, total - amountPaid),
      editable: isInvoiceEditable(status),
      payable: isInvoicePayable(status),
      externalRef: row.externalRef,
      externalPushedAt: row.externalPushedAt,
      createdAt: row.createdAt,
      customer: {
        id: row.customer.id,
        name: row.customer.tradingName ?? row.customer.legalName,
      },
      job: job ?? null,
      lines: row.lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        lineTotal: Number(line.lineTotal),
      })),
      payments: row.payments.map((payment) => ({
        id: payment.id,
        amount: Number(payment.amount),
        method: payment.method,
        reference: payment.reference,
        paidAt: payment.paidAt,
      })),
    }
  })
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Invoices on one job — the job page's section. */
export async function invoicesForJob(
  context: AuthContext,
  jobId: string,
  client: Tx = db,
): Promise<InvoiceSummary[]> {
  assertCan(context, 'invoice.read')
  const [rows, settings] = await Promise.all([
    client.invoice.findMany({
      where: { ...invoiceReadWhere(context), lines: { some: { jobId } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: invoiceSelect,
    }),
    getSettings(client),
  ])
  return toSummaries(context, client, rows, settings, new Date())
}

/** The invoice book, with a count per status and what is still owed overall. */
export async function listInvoices(
  context: AuthContext,
  raw: unknown = {},
  client: Tx = db,
): Promise<InvoiceList> {
  assertCan(context, 'invoice.read')
  const filters = parseInput(invoiceFilterSchema, raw)
  const settings = await getSettings(client)

  const rows = await client.invoice.findMany({
    where: {
      ...invoiceReadWhere(context),
      ...(filters.q
        ? {
            OR: [
              { number: { contains: filters.q, mode: 'insensitive' as const } },
              { customer: { legalName: { contains: filters.q, mode: 'insensitive' as const } } },
              { customer: { tradingName: { contains: filters.q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 500,
    select: invoiceSelect,
  })

  const all = await toSummaries(context, client, rows, settings, new Date())
  const counts = Object.fromEntries(
    INVOICE_STATUSES.map((status) => [status, all.filter((invoice) => invoice.status === status).length]),
  ) as Record<InvoiceStatusName, number>

  return {
    invoices: filters.status
      ? all.filter((invoice) => invoice.status === filters.status)
      : all,
    counts,
    outstanding: all
      .filter((invoice) => invoice.payable)
      .reduce((sum, invoice) => sum + invoice.balance, 0),
    unpushed: all.filter((invoice) => BILLED.has(invoice.status) && !invoice.externalRef).length,
  }
}

/** One invoice. Scoped by `invoiceReadWhere`, so an unentitled caller gets "no such invoice". */
export async function getInvoice(
  context: AuthContext,
  invoiceId: string,
  client: Tx = db,
): Promise<InvoiceSummary> {
  assertCan(context, 'invoice.read')
  const row = await client.invoice.findFirst({
    where: { id: invoiceId, ...invoiceReadWhere(context) },
    select: invoiceSelect,
  })
  if (!row) throw new NotFoundError('No such invoice.')
  const settings = await getSettings(client)
  const [summary] = await toSummaries(context, client, [row], settings, new Date())
  return summary!
}

export interface JobCostingLine {
  description: string
  quantity: number
  unitPrice: number
}

export interface JobCosting {
  parts: JobCostingLine[]
  /** What the parts cost us, in currency units — finance's view, not the customer's. */
  partsCost: number
}

/**
 * The parts issued on a job, priced at their sell price, as invoice lines.
 *
 * Read from `StockMovement` rather than from a JSON list on the report: it is the same record the
 * delivery order prints and the same one stock is reconciled from (CLAUDE.md rule 10), so the invoice
 * and the paperwork cannot describe different parts. This is a prefill — the office edits the lines
 * it produces — which is why it returns plain lines rather than writing anything.
 */
export async function jobCosting(
  context: AuthContext,
  jobId: string,
  client: Tx = db,
): Promise<JobCosting> {
  assertCan(context, 'invoice.read')
  const job = await client.job.findFirst({
    where: { id: jobId, ...jobReadWhere(context) },
    select: { id: true },
  })
  if (!job) throw new NotFoundError('No such job.')

  const movements = await client.stockMovement.findMany({
    where: { jobId, type: 'ISSUE' },
    orderBy: [{ movedAt: 'asc' }, { id: 'asc' }],
    select: {
      quantity: true,
      unitCost: true,
      part: { select: { partNumber: true, description: true, sellPrice: true } },
    },
  })

  return {
    parts: movements.map((movement) => ({
      description: `${movement.part.partNumber} — ${movement.part.description}`,
      quantity: Number(movement.quantity),
      unitPrice: Number(movement.part.sellPrice),
    })),
    partsCost: movements.reduce(
      (sum, movement) => sum + Number(movement.quantity) * Number(movement.unitCost ?? 0),
      0,
    ),
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function linesToCreate(
  lines: ReturnType<typeof pricedLines>,
  lineTotalsCents: number[],
  jobId: string | null,
) {
  return lines.map((line, index) => ({
    ...(jobId ? { jobId } : {}),
    description: line.description,
    quantity: String(line.quantity),
    unitPrice: centsToDecimalString(Math.round(line.unitPrice * 100)),
    lineTotal: centsToDecimalString(lineTotalsCents[index]!),
  }))
}

/**
 * Raises a draft invoice against a reviewed job.
 *
 * The number is issued now, as a quote's is: the office refers to "INV-2026-0004" from the moment it
 * exists, and the document carries it. The job must be one the caller may read, and must be
 * `REVIEWED` — invoicing is the step after the paperwork is signed off, not a way to bill work that
 * has not happened. The customer is taken from the job, so the two cannot disagree.
 */
export async function createInvoice(
  context: AuthContext,
  raw: unknown,
  client?: Tx,
): Promise<InvoiceSummary> {
  assertCan(context, 'invoice.write')
  const input = parseInput(createInvoiceSchema, raw)

  return withAudit(
    context,
    async (tx, log) => {
      const job = await tx.job.findFirst({
        where: { id: input.jobId, ...jobReadWhere(context) },
        select: { id: true, number: true, status: true, customerId: true },
      })
      if (!job) throw new NotFoundError('No such job.')
      if (job.status !== 'REVIEWED') {
        throw new RuleError(
          `Job ${job.number} is ${job.status.replace('_', ' ').toLowerCase()} — only a reviewed job can be invoiced.`,
        )
      }

      const settings = await getSettings(tx)
      const lines = pricedLines(input.lines)
      const totals = documentTotals(lines, settings.gstRate)
      const createdAt = new Date()
      const number = await nextDocumentNumber(tx, 'INVOICE', {
        at: createdAt,
        timeZone: settings.timezone,
      })
      // The due date is a consequence of the customer's terms, so the first draft already carries it.
      const terms = await tx.customer.findUnique({
        where: { id: job.customerId },
        select: { paymentTerms: true },
      })

      const invoice = await tx.invoice.create({
        data: {
          number,
          customerId: job.customerId,
          status: 'DRAFT',
          // A draft has no issue date yet; the rate is snapshotted again when it is issued, because
          // that is the moment the customer is charged it.
          gstRate: settings.gstRate,
          subtotal: centsToDecimalString(totals.subtotalCents),
          gstAmount: centsToDecimalString(totals.gstCents),
          total: centsToDecimalString(totals.totalCents),
          amountPaid: '0',
          lines: { create: linesToCreate(lines, totals.lineTotalsCents, job.id) },
        },
        select: invoiceSelect,
      })

      await log({
        entity: 'Invoice',
        entityId: invoice.id,
        action: 'CREATE',
        after: {
          number: invoice.number,
          jobId: job.id,
          status: invoice.status,
          total: Number(invoice.total),
          lines: invoice.lines.length,
          paymentTermsDays: terms?.paymentTerms ?? null,
        },
      })

      const [summary] = await toSummaries(context, tx, [invoice], settings, createdAt)
      return summary!
    },
    client,
  )
}

/** Replaces a draft's lines and reprices at the operator's current rate. */
export async function updateInvoice(
  context: AuthContext,
  invoiceId: string,
  raw: unknown,
  client?: Tx,
): Promise<InvoiceSummary> {
  assertCan(context, 'invoice.write')
  const input = parseInput(updateInvoiceSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.invoice.findFirst({
        where: { id: invoiceId, ...invoiceReadWhere(context) },
        select: {
          id: true,
          status: true,
          subtotal: true,
          total: true,
          lines: { select: { description: true, quantity: true, unitPrice: true, jobId: true } },
        },
      })
      if (!before) throw new NotFoundError('No such invoice.')
      if (!isInvoiceEditable(before.status as InvoiceStatusName)) {
        throw new RuleError('Only a draft invoice can be edited — raise a credit note instead.')
      }

      // A replacement line keeps the job it was raised from, so the invoice cannot quietly lose the
      // link that `invoicesForJob` reads.
      const jobId = before.lines.find((line) => line.jobId)?.jobId ?? null
      const settings = await getSettings(tx)
      const lines = pricedLines(input.lines)
      const totals = documentTotals(lines, settings.gstRate)

      await tx.invoiceLine.deleteMany({ where: { invoiceId } })
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          gstRate: settings.gstRate,
          subtotal: centsToDecimalString(totals.subtotalCents),
          gstAmount: centsToDecimalString(totals.gstCents),
          total: centsToDecimalString(totals.totalCents),
          lines: { create: linesToCreate(lines, totals.lineTotalsCents, jobId) },
        },
      })

      await log({
        entity: 'Invoice',
        entityId: invoiceId,
        action: 'UPDATE',
        before: {
          subtotal: Number(before.subtotal),
          total: Number(before.total),
          lines: before.lines.map((line) => ({
            description: line.description,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
          })),
        },
        after: {
          subtotal: totals.subtotalCents / 100,
          total: totals.totalCents / 100,
          lines: lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          })),
        },
      })
    },
    client,
  )

  return getInvoice(context, invoiceId, client)
}

/**
 * Issues a draft, or voids an invoice nothing has been paid against.
 *
 * Issuing is the moment the bill exists: the GST rate is snapshotted again at that instant, the issue
 * date is stamped, and the due date is computed from the customer's payment terms unless one was set
 * explicitly. The job moves `REVIEWED → INVOICED` inside the same transaction, so the history row and
 * the invoice agree. Voiding keeps the row and needs a reason — a bill is never deleted.
 */
export async function transitionInvoice(
  context: AuthContext,
  invoiceId: string,
  raw: unknown,
  client?: Tx,
): Promise<InvoiceSummary> {
  assertCan(context, 'invoice.write')
  const input = raw as { status?: string; reason?: string }
  const target = input.status
  if (target !== 'ISSUED' && target !== 'VOID') {
    throw new RuleError('An invoice can only be issued or voided.')
  }
  const reason = target === 'VOID' ? parseInput(voidInvoiceSchema, { reason: input.reason ?? '' }).reason : null

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.invoice.findFirst({
        where: { id: invoiceId, ...invoiceReadWhere(context) },
        select: {
          id: true,
          number: true,
          status: true,
          issueDate: true,
          dueDate: true,
          subtotal: true,
          amountPaid: true,
          customerId: true,
          lines: { select: { jobId: true } },
        },
      })
      if (!before) throw new NotFoundError('No such invoice.')

      const current = before.status as InvoiceStatusName
      if (!canMoveInvoice(current, target)) {
        throw new RuleError(`A ${current.toLowerCase().replace('_', ' ')} invoice cannot be ${target.toLowerCase()}.`)
      }
      if (target === 'VOID' && Number(before.amountPaid) > 0) {
        throw new RuleError('Money has been recorded against this invoice — raise a credit note instead.')
      }

      if (target === 'VOID') {
        await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'VOID' } })
        await log({
          entity: 'Invoice',
          entityId: invoiceId,
          action: 'UPDATE',
          before: { status: current },
          after: { status: 'VOID', reason },
        })
        return
      }

      const settings = await getSettings(tx)
      const issueDate = new Date()
      const customer = await tx.customer.findUnique({
        where: { id: before.customerId },
        select: { paymentTerms: true },
      })
      // "Due in 30 days" from the day it is issued, in the operating timezone, as a UTC-midnight day
      // like every other date the office types.
      const dueDate =
        before.dueDate ??
        addDays(new Date(`${issueDate.toISOString().slice(0, 10)}T00:00:00Z`), customer?.paymentTerms ?? 30)

      // The rate and the amounts it produces are re-snapshotted together: a bill stating 10% GST but
      // charging 9% is worse than either rate being wrong on its own.
      const subtotalCents = Math.round(Number(before.subtotal) * 100)
      const gstCents = Math.round(subtotalCents * settings.gstRate)
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: 'ISSUED',
          issueDate,
          dueDate,
          gstRate: settings.gstRate,
          gstAmount: centsToDecimalString(gstCents),
          total: centsToDecimalString(subtotalCents + gstCents),
        },
      })

      await log({
        entity: 'Invoice',
        entityId: invoiceId,
        action: 'UPDATE',
        before: { status: current },
        after: {
          status: 'ISSUED',
          issueDate,
          dueDate,
          gstRate: settings.gstRate,
          total: (subtotalCents + gstCents) / 100,
        },
      })

      // The job moves REVIEWED → INVOICED here rather than through `transitionJob`, which needs
      // `job.transition` that finance — the only role holding `invoice.write` — does not have. The
      // edge is checked against the same map, and the status, its timestamp and its history row are
      // written exactly as `transitionJob` would write them, in this transaction.
      const jobId = before.lines.find((line) => line.jobId)?.jobId
      if (!jobId) return
      const job = await tx.job.findFirst({
        where: { id: jobId, ...jobReadWhere(context) },
        select: { id: true, status: true, invoicedAt: true },
      })
      if (!job || !canTransition(job.status, 'INVOICED')) return

      const note = `Invoice ${before.number} issued.`
      await tx.job.update({
        where: { id: job.id },
        data: { status: 'INVOICED', invoicedAt: job.invoicedAt ?? issueDate },
      })
      await tx.jobStatusHistory.create({
        data: {
          jobId: job.id,
          fromStatus: job.status,
          toStatus: 'INVOICED',
          reason: note,
          changedById: context.userId,
        },
      })
      await log({
        entity: 'Job',
        entityId: job.id,
        action: 'UPDATE',
        before: { status: job.status },
        after: { status: 'INVOICED', note },
      })
    },
    client,
  )

  return getInvoice(context, invoiceId, client)
}

/**
 * Records money received against an issued invoice.
 *
 * The amount is added to what has already been paid and the total is written back, so `amountPaid` is
 * the sum of the payment rows rather than a number somebody typed. A payment that would take the
 * total above the invoice's own amount is refused by name — an overpayment is a credit note, not a
 * negative balance. The status follows the money (`paidStatusFor`), never a form field.
 */
export async function recordPayment(
  context: AuthContext,
  invoiceId: string,
  raw: unknown,
  client?: Tx,
): Promise<InvoiceSummary> {
  assertCan(context, 'invoice.write')
  const input = parseInput(recordPaymentSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.invoice.findFirst({
        where: { id: invoiceId, ...invoiceReadWhere(context) },
        select: { id: true, number: true, status: true, total: true, amountPaid: true },
      })
      if (!before) throw new NotFoundError('No such invoice.')
      if (!isInvoicePayable(before.status as InvoiceStatusName)) {
        throw new RuleError(
          before.status === 'DRAFT'
            ? 'Issue the invoice before recording a payment against it.'
            : 'That invoice is not open for payment.',
        )
      }

      // Money, in cents, so the comparison against the total is exact rather than a float guess.
      const totalCents = Math.round(Number(before.total) * 100)
      const paidCents = Math.round(Number(before.amountPaid) * 100)
      const amountCents = Math.round(input.amount * 100)
      if (paidCents + amountCents > totalCents) {
        throw new RuleError(
          `${formatMoneyCents(totalCents - paidCents)} is still owed on ${before.number}, so ${formatMoneyCents(amountCents)} is too much.`,
        )
      }

      const settings = await getSettings(tx)
      const paidAt = input.paidAt ?? new Date()

      await tx.payment.create({
        data: {
          invoiceId,
          amount: centsToDecimalString(amountCents),
          method: input.method,
          reference: input.reference,
          paidAt,
          createdById: context.userId,
        },
      })

      const newPaidCents = paidCents + amountCents
      const status = paidStatusFor(totalCents, newPaidCents)
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { amountPaid: centsToDecimalString(newPaidCents), status },
      })

      await log({
        entity: 'Invoice',
        entityId: invoiceId,
        action: 'UPDATE',
        before: { status: before.status, amountPaid: Number(before.amountPaid) },
        after: {
          status,
          amountPaid: newPaidCents / 100,
          payment: {
            amount: amountCents / 100,
            method: input.method,
            reference: input.reference,
            paidAt,
            timeZone: settings.timezone,
          },
        },
      })
    },
    client,
  )

  return getInvoice(context, invoiceId, client)
}

function formatMoneyCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/**
 * Renders an invoice as it stands now. On demand, the quote renderer's contract: a draft changes
 * until it is issued, and after that the pinned dates mean an unchanged invoice is the same bytes.
 */
export async function renderInvoice(
  context: AuthContext,
  invoiceId: string,
  client: Tx = db,
): Promise<{ filename: string; bytes: Buffer }> {
  assertCan(context, 'invoice.read')
  const invoice = await getInvoice(context, invoiceId, client)
  const settings = await getSettings(client)

  const bytes = await renderInvoicePdf({
    number: invoice.number,
    createdAt: invoice.createdAt,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    timeZone: settings.timezone,
    currency: settings.currency,
    customer: { name: invoice.customer.name },
    job: invoice.job,
    status: invoice.status,
    gstRate: invoice.gstRate,
    subtotal: invoice.subtotal,
    gstAmount: invoice.gstAmount,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    lines: invoice.lines,
  })

  return { filename: `${invoice.number}.pdf`, bytes }
}

/** The label a status carries on a screen, exported so the pages and the PDF cannot disagree. */
export function dueLabel(invoice: InvoiceSummary, timeZone: string): string {
  if (!invoice.dueDate) return 'No due date'
  return invoice.overdue
    ? `Overdue since ${formatDate(invoice.dueDate, timeZone)}`
    : `Due ${formatDate(invoice.dueDate, timeZone)}`
}
