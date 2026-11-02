import type { Prisma } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { addDays, wallTimeToUtc } from '@/lib/time'
import { parseInput } from '@/lib/validation/parse'
import { profitabilityFilterSchema, type ProfitabilityFilter } from '@/lib/validation/profitability'
import { assertCan } from '@/server/auth/permissions'
import { invoiceReadWhere, jobReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { getSettings } from '@/server/settings/settings'

/**
 * Profitability (brief §11, slice 32).
 *
 * **Revenue is the invoice's subtotal exclusive of GST**, on issued, partly paid and paid invoices
 * only — a draft is not a bill and a void one never was. The period is the invoice's **issue date**,
 * because that is the day the money became receivable.
 *
 * **Cost is parts, and only parts.** Every `ISSUE` movement already records what the part cost us, and
 * the invoice prefill (`jobCosting`) reads the same rows; labour is sold on invoices but never costed,
 * because nothing in the system knows anybody's hourly rate. The screen says so — a margin here is
 * revenue less material, not a gross profit figure. Add a labour cost rate to `Technician` and this is
 * the one place that has to change.
 *
 * **Cost follows the job, not the invoice line.** A job is included when one of its lines is on an
 * invoice in the window, and its whole material cost is counted once, whatever the issue dates were —
 * so a job invoiced in March for parts issued in February shows both in March. A job whose invoice is
 * outside the window contributes nothing: unsold material is work in progress, not a loss.
 *
 * **A revenue line with no job behind it cannot be attributed.** Labour typed straight onto an invoice,
 * or a job's parts re-raised after the line lost its job, belongs to the invoice's customer but to no
 * job type or contract. It counts in the totals and against its customer, and the screen states how much
 * it is rather than inventing a category for it — so why the three tables do not add up is on the page.
 *
 * Rows are scoped with `invoiceReadWhere` and `jobReadWhere`, so the capability decides *whether* and
 * the scope decides *which* — the same two halves as every other service (CLAUDE.md rule 1).
 */

export interface MarginRow {
  key: string
  label: string
  /** Revenue exclusive of GST, in currency units. */
  revenue: number
  partsCost: number
  margin: number
  /** Margin as a fraction of revenue, or null when nothing was earned. */
  marginRatio: number | null
}

export interface ProfitabilityReport {
  byCustomer: MarginRow[]
  byContract: MarginRow[]
  byJobType: MarginRow[]
  totals: { revenue: number; partsCost: number; margin: number }
  /** Revenue on invoice lines with no job behind them — counted in the totals and the customer rows. */
  unattributedRevenue: number
  /** The window as read, so the screen can say what it covered. */
  window: { from: Date | null; to: Date | null }
  invoiceCount: number
}

/** The states in which money is owed or paid. A draft and a void are not revenue. */
const BILLED = ['ISSUED', 'PART_PAID', 'PAID'] as const

/** Cents, so the sums never pick up a float artifact. */
function cents(value: Prisma.Decimal | number | null | undefined): number {
  return Math.round(Number(value ?? 0) * 100)
}

function toRow(key: string, label: string, revenueCents: number, costCents: number): MarginRow {
  const marginCents = revenueCents - costCents
  return {
    key,
    label,
    revenue: revenueCents / 100,
    partsCost: costCents / 100,
    margin: marginCents / 100,
    marginRatio: revenueCents > 0 ? marginCents / revenueCents : null,
  }
}

/** Midnight at the start of a `YYYY-MM-DD` wall date, or null when it is not one. */
function dayStart(value: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return wallTimeToUtc(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0, timezone)
}

async function issueWindow(
  filters: ProfitabilityFilter,
  client: Tx,
): Promise<{ gte?: Date; lt?: Date } | null> {
  if (!filters.from && !filters.to) return null
  const timezone = (await getSettings(client)).timezone
  const from = filters.from ? dayStart(filters.from, timezone) : null
  const to = filters.to ? dayStart(filters.to, timezone) : null
  return {
    ...(from ? { gte: from } : {}),
    // The range includes the `to` day in full, so the bound is the start of the day after it.
    ...(to ? { lt: addDays(to, 1) } : {}),
  }
}

export async function profitabilityReport(
  context: AuthContext,
  raw: unknown = {},
  client: Tx = db,
): Promise<ProfitabilityReport> {
  assertCan(context, 'report.financial')
  const filters = parseInput(profitabilityFilterSchema, raw)
  const window = await issueWindow(filters, client)

  const invoices = await client.invoice.findMany({
    where: {
      ...invoiceReadWhere(context),
      status: { in: [...BILLED] },
      ...(window ? { issueDate: window } : {}),
    },
    select: {
      id: true,
      customerId: true,
      customer: { select: { legalName: true, tradingName: true } },
      subtotal: true,
      lines: { select: { jobId: true, lineTotal: true } },
    },
  })

  // Every job that earned any of this revenue, read through the job scope so a narrower role cannot
  // be handed another role's costs through the back door.
  const jobIds = [...new Set(invoices.flatMap((invoice) => invoice.lines.map((line) => line.jobId)))]
    .filter((id): id is string => Boolean(id))

  const jobs = jobIds.length
    ? await client.job.findMany({
        where: { id: { in: jobIds }, ...jobReadWhere(context) },
        select: {
          id: true,
          jobTypeId: true,
          jobType: { select: { name: true } },
          contractId: true,
          contract: { select: { reference: true, type: true } },
        },
      })
    : []
  const jobById = new Map(jobs.map((job) => [job.id, job]))

  // One query for the ledger, summed in cents. `groupBy` cannot multiply two columns, and a job's
  // movements are few enough that the round trip is the only cost worth counting.
  const movements = jobIds.length
    ? await client.stockMovement.findMany({
        where: { type: 'ISSUE', jobId: { in: [...jobById.keys()] } },
        select: { jobId: true, quantity: true, unitCost: true },
      })
    : []

  const costByJob = new Map<string, number>()
  for (const movement of movements) {
    if (!movement.jobId) continue
    // Quantity carries three decimals: read it in thousandths so 0.1 + 0.2 stays exact, then divide
    // back to cents by the 1000 (quantity) × 100 (cents) it was multiplied by.
    const thousandths = Math.round(Number(movement.quantity) * 1000)
    const row = Math.round((thousandths * cents(movement.unitCost ?? 0)) / 1000)
    costByJob.set(movement.jobId, (costByJob.get(movement.jobId) ?? 0) + row)
  }
  /** A job's material is booked once, even when it is billed on more than one invoice. */
  const countedJobs = new Set<string>()

  // Revenue per customer comes from the invoice itself, so a line with no job still lands somewhere.
  const customerRevenue = new Map<string, { label: string; cents: number }>()
  const customerCost = new Map<string, number>()
  const contractRevenue = new Map<string, { label: string; cents: number }>()
  const contractCost = new Map<string, number>()
  const typeRevenue = new Map<string, { label: string; cents: number }>()
  const typeCost = new Map<string, number>()
  let unattributedCents = 0

  const NO_CONTRACT = '__none__'

  function bucket(
    map: Map<string, { label: string; cents: number }>,
    key: string,
    label: string,
    value: number,
  ) {
    const row = map.get(key) ?? { label, cents: 0 }
    row.cents += value
    map.set(key, row)
  }
  function addCost(map: Map<string, number>, key: string, value: number) {
    map.set(key, (map.get(key) ?? 0) + value)
  }

  for (const invoice of invoices) {
    const customerLabel = invoice.customer.tradingName ?? invoice.customer.legalName
    bucket(customerRevenue, invoice.customerId, customerLabel, cents(invoice.subtotal))

    for (const line of invoice.lines) {
      const revenue = cents(line.lineTotal)
      const job = line.jobId ? jobById.get(line.jobId) : undefined
      if (!job) {
        unattributedCents += revenue
        continue
      }

      const contractId = job.contractId ?? NO_CONTRACT
      const contractLabel = job.contract
        ? (job.contract.reference ?? job.contract.type.replace(/_/g, ' ').toLowerCase())
        : 'No contract'
      bucket(contractRevenue, contractId, contractLabel, revenue)
      bucket(typeRevenue, job.jobTypeId, job.jobType.name, revenue)
    }

    for (const line of invoice.lines) {
      const job = line.jobId ? jobById.get(line.jobId) : undefined
      if (!job || countedJobs.has(job.id)) continue
      countedJobs.add(job.id)
      const jobCost = costByJob.get(job.id) ?? 0
      addCost(customerCost, invoice.customerId, jobCost)
      addCost(contractCost, job.contractId ?? NO_CONTRACT, jobCost)
      addCost(typeCost, job.jobTypeId, jobCost)
    }
  }

  const rows = (
    revenue: Map<string, { label: string; cents: number }>,
    costs: Map<string, number>,
  ): MarginRow[] =>
    [...revenue.entries()]
      .map(([key, value]) => toRow(key, value.label, value.cents, costs.get(key) ?? 0))
      .sort((a, b) => b.revenue - a.revenue)

  const totalRevenue = invoices.reduce((sum, invoice) => sum + cents(invoice.subtotal), 0)
  const totalCost = [...costByJob.entries()]
    .filter(([jobId]) => jobById.has(jobId))
    .reduce((sum, [, value]) => sum + value, 0)

  return {
    byCustomer: rows(customerRevenue, customerCost),
    byContract: rows(contractRevenue, contractCost),
    byJobType: rows(typeRevenue, typeCost),
    totals: {
      revenue: totalRevenue / 100,
      partsCost: totalCost / 100,
      margin: (totalRevenue - totalCost) / 100,
    },
    unattributedRevenue: unattributedCents / 100,
    window: { from: window?.gte ?? null, to: window?.lt ? addDays(window.lt, -1) : null },
    invoiceCount: invoices.length,
  }
}
