import type { Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { formatDate } from '@/lib/format'
import { dayKey } from '@/lib/time'
import { parseInput } from '@/lib/validation/parse'
import {
  centsToDecimalString,
  createQuoteSchema,
  effectiveQuoteStatus,
  quoteFilterSchema,
  quoteTotals,
  quoteTransitionSchema,
  updateQuoteSchema,
  type QuoteStatusName,
} from '@/lib/validation/quotes'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { jobReadWhere, quoteReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { renderQuotePdf } from '@/server/documents/quote'
import { nextDocumentNumber } from '@/server/documents/sequence'
import { transitionJob } from '@/server/jobs/jobs'
import { getSettings, type Settings } from '@/server/settings/settings'

/**
 * Quotes and variations (brief §4.2, §12, slice 19).
 *
 * A quote is a priced offer against a job: lines with quantity and unit price, a variation flag for
 * extra work beyond the agreed scope, GST on the subtotal, and a validity date. The money is computed
 * here from the lines and the stored rate — the form posts descriptions and prices, never totals.
 *
 * The status flow is small: `DRAFT → SENT → ACCEPTED | DECLINED`, and `SENT` past its validity date
 * reads as `EXPIRED` (derived, never written — see `effectiveQuoteStatus`). Sending a quote for a
 * `TRIAGED` job moves the job to `QUOTED`; accepting it moves the job to `APPROVED`. Both go through
 * `transitionJob`, so the status machine, the history row and the audit entry stay the only path.
 *
 * Only a draft can be edited. Once sent, the numbers are the ones the customer was offered.
 */

export interface QuoteLineSummary {
  id: string
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
  isVariation: boolean
}

export interface QuoteSummary {
  id: string
  number: string
  /** What the quote reads as today — `EXPIRED` is derived from the date, not stored. */
  status: QuoteStatusName
  storedStatus: QuoteStatusName
  expired: boolean
  validUntil: Date | null
  notes: string | null
  gstRate: number
  subtotal: number
  gstAmount: number
  total: number
  createdAt: Date
  customer: { id: string; name: string }
  job: { id: string; number: string; status: string } | null
  lines: QuoteLineSummary[]
}

export interface QuoteList {
  quotes: QuoteSummary[]
  counts: Record<QuoteStatusName, number>
}

const quoteSelect = {
  id: true,
  number: true,
  status: true,
  validUntil: true,
  gstRate: true,
  subtotal: true,
  gstAmount: true,
  total: true,
  notes: true,
  createdAt: true,
  customerId: true,
  jobId: true,
  customer: { select: { id: true, legalName: true, tradingName: true } },
  lines: {
    orderBy: { id: 'asc' },
    select: {
      id: true,
      description: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      isVariation: true,
    },
  },
} satisfies Prisma.QuoteSelect

type QuoteRow = Prisma.QuoteGetPayload<{ select: typeof quoteSelect }>

/**
 * Rows to what the screens show. The job is one batched lookup because `Quote.jobId` has no relation
 * in the schema, and it is scoped like any other job read so a quote cannot reveal a job its reader
 * may not see.
 */
async function toSummaries(
  context: AuthContext,
  client: Tx,
  rows: QuoteRow[],
  settings: Settings,
): Promise<QuoteSummary[]> {
  const jobIds = [...new Set(rows.map((row) => row.jobId).filter((id): id is string => Boolean(id)))]
  const jobs = jobIds.length
    ? await client.job.findMany({
        where: { id: { in: jobIds }, ...jobReadWhere(context) },
        select: { id: true, number: true, status: true },
      })
    : []
  const jobFor = new Map(jobs.map((job) => [job.id, job]))
  const now = new Date()

  return rows.map((row) => {
    const status = effectiveQuoteStatus(
      { status: row.status as QuoteStatusName, validUntil: row.validUntil },
      now,
      settings.timezone,
    )
    const job = row.jobId ? jobFor.get(row.jobId) : undefined
    return {
      id: row.id,
      number: row.number,
      status,
      storedStatus: row.status as QuoteStatusName,
      expired: status === 'EXPIRED',
      validUntil: row.validUntil,
      notes: row.notes,
      gstRate: Number(row.gstRate),
      subtotal: Number(row.subtotal),
      gstAmount: Number(row.gstAmount),
      total: Number(row.total),
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
        isVariation: line.isVariation,
      })),
    }
  })
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Quotes on one job, newest first — the job page's section. */
export async function quotesForJob(
  context: AuthContext,
  jobId: string,
  client: Tx = db,
): Promise<QuoteSummary[]> {
  assertCan(context, 'quote.read')
  const [rows, settings] = await Promise.all([
    client.quote.findMany({
      where: { ...quoteReadWhere(context), jobId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: quoteSelect,
    }),
    getSettings(client),
  ])
  return toSummaries(context, client, rows, settings)
}

/** The quotes list, with a count per status so the header can say what is outstanding. */
export async function listQuotes(
  context: AuthContext,
  raw: unknown = {},
  client: Tx = db,
): Promise<QuoteList> {
  assertCan(context, 'quote.read')
  const filters = parseInput(quoteFilterSchema, raw)
  const settings = await getSettings(client)

  const rows = await client.quote.findMany({
    where: {
      ...quoteReadWhere(context),
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
    select: quoteSelect,
  })

  const all = await toSummaries(context, client, rows, settings)
  const counts = Object.fromEntries(
    (['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const).map((status) => [
      status,
      all.filter((quote) => quote.status === status).length,
    ]),
  ) as Record<QuoteStatusName, number>

  return {
    quotes: filters.status ? all.filter((quote) => quote.status === filters.status) : all,
    counts,
  }
}

/** One quote. Scoped by `quoteReadWhere`, so an unentitled caller gets "no such quote". */
export async function getQuote(
  context: AuthContext,
  quoteId: string,
  client: Tx = db,
): Promise<QuoteSummary> {
  assertCan(context, 'quote.read')
  const row = await client.quote.findFirst({
    where: { id: quoteId, ...quoteReadWhere(context) },
    select: quoteSelect,
  })
  if (!row) throw new NotFoundError('No such quote.')
  const settings = await getSettings(client)
  const [summary] = await toSummaries(context, client, [row], settings)
  return summary!
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** The prices as the columns store them: money to cents, quantity to its three decimals. */
function pricedLines(lines: { description: string; quantity: number; unitPrice: number; isVariation?: boolean }[]) {
  return lines.map((line) => ({
    description: line.description,
    quantity: Math.round(line.quantity * 1000) / 1000,
    // Round to cents first: a third decimal on a price would make the stored price and the stored
    // line total disagree by a fraction of a cent on the customer's copy.
    unitPrice: Math.round(line.unitPrice * 100) / 100,
    isVariation: line.isVariation ?? false,
  }))
}

function totalsFor(lines: ReturnType<typeof pricedLines>, gstRate: number) {
  return quoteTotals(lines, gstRate)
}

/**
 * Raises a draft quote against a job.
 *
 * The number is issued now, not when it is sent: the office talks about "QTE-2026-0007" from the
 * moment it exists, and renumbering it later would make that conversation wrong. The job must be one
 * the caller may read; the customer is taken from it, so the two can never disagree.
 */
export async function createQuote(
  context: AuthContext,
  raw: unknown,
  client?: Tx,
): Promise<QuoteSummary> {
  assertCan(context, 'quote.write')
  const input = parseInput(createQuoteSchema, raw)

  return withAudit(
    context,
    async (tx, log) => {
      const job = await tx.job.findFirst({
        where: { id: input.jobId, ...jobReadWhere(context) },
        select: { id: true, number: true, customerId: true },
      })
      if (!job) throw new NotFoundError('No such job.')

      const settings = await getSettings(tx)
      const lines = pricedLines(input.lines)
      const totals = totalsFor(lines, settings.gstRate)
      const createdAt = new Date()
      const number = await nextDocumentNumber(tx, 'QUOTE', {
        at: createdAt,
        timeZone: settings.timezone,
      })

      const quote = await tx.quote.create({
        data: {
          number,
          jobId: job.id,
          customerId: job.customerId,
          status: 'DRAFT',
          validUntil: input.validUntil,
          notes: input.notes,
          gstRate: settings.gstRate,
          subtotal: centsToDecimalString(totals.subtotalCents),
          gstAmount: centsToDecimalString(totals.gstCents),
          total: centsToDecimalString(totals.totalCents),
          createdById: context.userId,
          lines: {
            create: lines.map((line, index) => ({
              description: line.description,
              quantity: String(line.quantity),
              unitPrice: centsToDecimalString(Math.round(line.unitPrice * 100)),
              lineTotal: centsToDecimalString(totals.lineTotalsCents[index]!),
              isVariation: line.isVariation,
            })),
          },
        },
        select: quoteSelect,
      })

      await log({
        entity: 'Quote',
        entityId: quote.id,
        action: 'CREATE',
        after: {
          number: quote.number,
          jobId: job.id,
          status: quote.status,
          total: Number(quote.total),
          lines: quote.lines.length,
        },
      })

      const [summary] = await toSummaries(context, tx, [quote], settings)
      return summary!
    },
    client,
  )
}

/**
 * Replaces a draft's lines, validity date and notes, and reprices it at the operator's current rate.
 * A sent quote is immutable: the customer was offered those numbers.
 */
export async function updateQuote(
  context: AuthContext,
  quoteId: string,
  raw: unknown,
  client?: Tx,
): Promise<QuoteSummary> {
  assertCan(context, 'quote.write')
  const input = parseInput(updateQuoteSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.quote.findFirst({
        where: { id: quoteId, ...quoteReadWhere(context) },
        select: {
          id: true,
          status: true,
          validUntil: true,
          notes: true,
          subtotal: true,
          total: true,
          lines: { select: { description: true, quantity: true, unitPrice: true } },
        },
      })
      if (!before) throw new NotFoundError('No such quote.')
      if (before.status !== 'DRAFT') {
        throw new RuleError('Only a draft quote can be edited — send a new quote instead.')
      }

      const settings = await getSettings(tx)
      const lines = pricedLines(input.lines)
      const totals = totalsFor(lines, settings.gstRate)

      await tx.quoteLine.deleteMany({ where: { quoteId } })
      await tx.quote.update({
        where: { id: quoteId },
        data: {
          validUntil: input.validUntil,
          notes: input.notes,
          gstRate: settings.gstRate,
          subtotal: centsToDecimalString(totals.subtotalCents),
          gstAmount: centsToDecimalString(totals.gstCents),
          total: centsToDecimalString(totals.totalCents),
          lines: {
            create: lines.map((line, index) => ({
              description: line.description,
              quantity: String(line.quantity),
              unitPrice: centsToDecimalString(Math.round(line.unitPrice * 100)),
              lineTotal: centsToDecimalString(totals.lineTotalsCents[index]!),
              isVariation: line.isVariation,
            })),
          },
        },
      })

      await log({
        entity: 'Quote',
        entityId: quoteId,
        action: 'UPDATE',
        before: {
          validUntil: before.validUntil,
          notes: before.notes,
          subtotal: Number(before.subtotal),
          total: Number(before.total),
          lines: before.lines.map((line) => ({
            description: line.description,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
          })),
        },
        after: {
          validUntil: input.validUntil,
          notes: input.notes,
          subtotal: totals.subtotalCents / 100,
          total: totals.totalCents / 100,
          lines: lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            isVariation: line.isVariation,
          })),
        },
      })
    },
    client,
  )

  return getQuote(context, quoteId, client)
}

/**
 * Drives the quote's own status and, where it applies, the job's.
 *
 * Sending a quote for a `TRIAGED` job moves it to `QUOTED`; accepting one for a `QUOTED` job moves it
 * to `APPROVED`, through `transitionJob` so the history row is written by the one function that owns
 * the machine. A variation quote on a job that is already past `APPROVED` leaves the job alone.
 */
export async function transitionQuote(
  context: AuthContext,
  quoteId: string,
  raw: unknown,
  client?: Tx,
): Promise<QuoteSummary> {
  assertCan(context, 'quote.write')
  const input = parseInput(quoteTransitionSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.quote.findFirst({
        where: { id: quoteId, ...quoteReadWhere(context) },
        select: {
          id: true,
          number: true,
          status: true,
          validUntil: true,
          jobId: true,
        },
      })
      if (!before) throw new NotFoundError('No such quote.')

      const settings = await getSettings(tx)
      const current = effectiveQuoteStatus(
        { status: before.status as QuoteStatusName, validUntil: before.validUntil },
        new Date(),
        settings.timezone,
      )
      if (current === 'EXPIRED') {
        throw new RuleError(
          before.validUntil
            ? `That quote expired on ${formatDate(before.validUntil, settings.timezone)}.`
            : 'That quote has expired.',
        )
      }
      if (current !== 'DRAFT' && current !== 'SENT') {
        throw new RuleError(`That quote is already ${current.toLowerCase()}.`)
      }
      if (input.status === 'SENT' && current !== 'DRAFT') {
        throw new RuleError('That quote has already been sent.')
      }
      // Sending a document that has already lapsed would offer the customer nothing they can accept.
      if (
        input.status === 'SENT' &&
        before.validUntil &&
        dayKey(before.validUntil, settings.timezone) < dayKey(new Date(), settings.timezone)
      ) {
        throw new RuleError('That validity date has passed — set a date in the future first.')
      }
      if (input.status !== 'SENT' && current !== 'SENT') {
        throw new RuleError('Send the quote before recording the customer’s answer.')
      }

      await tx.quote.update({ where: { id: quoteId }, data: { status: input.status } })

      await log({
        entity: 'Quote',
        entityId: quoteId,
        action: 'UPDATE',
        before: { status: before.status },
        after: { status: input.status, ...(input.note ? { note: input.note } : {}) },
      })

      if (!before.jobId) return
      const job = await tx.job.findFirst({
        where: { id: before.jobId, ...jobReadWhere(context) },
        select: { id: true, status: true },
      })
      if (!job) return

      // The job's own machine decides whether it may move; TRIAGED → QUOTED and QUOTED → APPROVED are
      // in the map, and any other state is a variation on work already won, which changes nothing.
      const target =
        input.status === 'SENT' && job.status === 'TRIAGED'
          ? ('QUOTED' as const)
          : input.status === 'ACCEPTED' && job.status === 'QUOTED'
            ? ('APPROVED' as const)
            : null
      if (target) {
        await transitionJob(
          context,
          job.id,
          { status: target, note: `Quote ${before.number} ${input.status === 'SENT' ? 'sent' : 'accepted'}.` },
          tx,
        )
      }
    },
    client,
  )

  return getQuote(context, quoteId, client)
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/**
 * Renders the quote as it stands now. On demand rather than stored: a draft changes until it is sent,
 * and after that the pinned dates mean an unchanged quote downloads to the same bytes.
 */
export async function renderQuote(
  context: AuthContext,
  quoteId: string,
  client: Tx = db,
): Promise<{ filename: string; bytes: Buffer }> {
  assertCan(context, 'quote.read')
  const quote = await getQuote(context, quoteId, client)
  const settings = await getSettings(client)

  const bytes = await renderQuotePdf({
    number: quote.number,
    createdAt: quote.createdAt,
    timeZone: settings.timezone,
    currency: settings.currency,
    customer: { name: quote.customer.name },
    job: quote.job,
    validUntil: quote.validUntil,
    status: quote.status,
    notes: quote.notes,
    gstRate: quote.gstRate,
    subtotal: quote.subtotal,
    gstAmount: quote.gstAmount,
    total: quote.total,
    lines: quote.lines,
  })

  return { filename: `${quote.number}.pdf`, bytes }
}
