import type { Prisma, TicketStatus } from '@prisma/client'
import { db, type Tx } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import {
  closeTicketSchema,
  createTicketSchema,
  ticketFilterSchema,
  triageTicketSchema,
  updateTicketSchema,
  type TicketFilter,
} from '@/lib/validation/tickets'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError, RuleError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import {
  craneReadWhere,
  customerReadWhere,
  siteReadWhere,
  ticketReadWhere,
} from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { nextDocumentNumber } from '@/server/documents/sequence'
import { notifyDispatchersOfP1 } from '@/server/notify/notify'
import { ticketSla, type TicketSla } from '@/server/sla/sla'

/**
 * Tickets: what a phone call becomes (brief §12.4).
 *
 * The flow the office actually follows is three separate moments, and the service keeps them
 * separate rather than collapsing them into one "edit" form:
 *
 *   1. **Record** — someone describes the fault while the customer is still on the line. Nothing is
 *      decided; the status is NEW and the priority is a guess.
 *   2. **Triage** — a dispatcher sets the priority and writes down what will be done. The SLA clock
 *      is already running from `reportedAt`, not from triage: the customer was promised a response
 *      when they phoned, and time spent deciding who to send is still response time.
 *   3. **Convert / close** — slice 5 turns a triaged ticket into jobs. Until then, and for a ticket
 *      that needs no visit, it is closed or cancelled with a note.
 *
 * A P1 is different from the other three priorities in one way that matters here: raising one alerts
 * every dispatcher immediately, in the same transaction that creates the ticket. If the alert fails,
 * the ticket is still created — a lost ticket is worse than a noisy one — but the failure is logged
 * and the notification row records it.
 */

export interface TicketCustomerRef {
  id: string
  legalName: string
  tradingName: string | null
}

export interface TicketSiteRef {
  id: string
  name: string
}

export interface TicketCraneRef {
  id: string
  assetTag: string
  status: string
}

export interface TicketSummary {
  id: string
  number: string
  source: string
  description: string
  priority: 'P1' | 'P2' | 'P3' | 'P4'
  status: TicketStatus
  reportedAt: Date
  respondedAt: Date | null
  closedAt: Date | null
  customer: TicketCustomerRef
  site: TicketSiteRef | null
  crane: TicketCraneRef | null
  jobCount: number
  sla: TicketSla
}

export interface TicketDetail extends TicketSummary {
  triageNotes: string | null
  contractId: string | null
  createdById: string | null
  updatedAt: Date
}

const ticketSelect = {
  id: true,
  number: true,
  source: true,
  description: true,
  priority: true,
  status: true,
  reportedAt: true,
  respondedAt: true,
  closedAt: true,
  triageNotes: true,
  contractId: true,
  createdById: true,
  updatedAt: true,
  customer: { select: { id: true, legalName: true, tradingName: true } },
  site: { select: { id: true, name: true } },
  crane: { select: { id: true, assetTag: true, status: true } },
  _count: { select: { jobs: true } },
} satisfies Prisma.TicketSelect

type TicketRow = Prisma.TicketGetPayload<{ select: typeof ticketSelect }>

function toSummary(row: TicketRow, sla: TicketSla): TicketSummary {
  return {
    id: row.id,
    number: row.number,
    source: row.source,
    description: row.description,
    priority: row.priority,
    status: row.status,
    reportedAt: row.reportedAt,
    respondedAt: row.respondedAt,
    closedAt: row.closedAt,
    customer: row.customer,
    site: row.site,
    crane: row.crane,
    jobCount: row._count.jobs,
    sla,
  }
}

/** Every target in one query rather than one per ticket, for the list screen. */
async function loadSlaTargets(client: Tx) {
  const rows = await client.slaPolicy.findMany({
    where: { isActive: true, contractId: null },
    select: { priority: true, responseMinutes: true, resolutionMinutes: true },
  })
  const byPriority = new Map(rows.map((row) => [row.priority, row]))
  return (priority: TicketRow['priority']) => {
    const row = byPriority.get(priority)
    return {
      responseMinutes: row?.responseMinutes ?? 480,
      resolutionMinutes: row?.resolutionMinutes ?? 2880,
    }
  }
}

export interface TicketSlaSummary {
  /** Tickets recorded but not yet closed, cancelled or converted. */
  open: number
  /** Open tickets whose response target has passed. */
  breached: number
  /** Open tickets close to their response target. */
  atRisk: number
  p1Open: number
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listTickets(
  context: AuthContext,
  rawFilters: unknown = {},
  client: Tx = db,
  now: Date = new Date(),
): Promise<TicketSummary[]> {
  assertCan(context, 'ticket.read')
  const filters = parseInput(ticketFilterSchema, rawFilters) as TicketFilter
  const targetsFor = await loadSlaTargets(client)

  const where: Prisma.TicketWhereInput = {
    ...ticketReadWhere(context),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.q
      ? {
          OR: [
            { number: { contains: filters.q, mode: 'insensitive' } },
            { description: { contains: filters.q, mode: 'insensitive' } },
            { customer: { legalName: { contains: filters.q, mode: 'insensitive' } } },
            { crane: { assetTag: { contains: filters.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }

  const rows = await client.ticket.findMany({
    where,
    select: ticketSelect,
    // Unanswered first, then the most urgent, then the oldest: the order a dispatcher works down.
    orderBy: [{ status: 'asc' }, { priority: 'asc' }, { reportedAt: 'asc' }],
    take: 500,
  })

  return rows.map((row) =>
    toSummary(
      row,
      ticketSla(
        {
          priority: row.priority,
          reportedAt: row.reportedAt,
          respondedAt: row.respondedAt,
          closedAt: row.closedAt,
        },
        targetsFor(row.priority),
        now,
      ),
    ),
  )
}

export async function getTicket(
  context: AuthContext,
  ticketId: string,
  client: Tx = db,
  now: Date = new Date(),
): Promise<TicketDetail> {
  assertCan(context, 'ticket.read')

  const row = await client.ticket.findFirst({
    where: { id: ticketId, ...ticketReadWhere(context) },
    select: ticketSelect,
  })
  if (!row) throw new NotFoundError('No such ticket.')

  const targetsFor = await loadSlaTargets(client)
  return {
    ...toSummary(
      row,
      ticketSla(
        {
          priority: row.priority,
          reportedAt: row.reportedAt,
          respondedAt: row.respondedAt,
          closedAt: row.closedAt,
        },
        targetsFor(row.priority),
        now,
      ),
    ),
    triageNotes: row.triageNotes,
    contractId: row.contractId,
    createdById: row.createdById,
    updatedAt: row.updatedAt,
  }
}

/** Open tickets for the dashboard tile: how many are past their response target, by priority. */
export async function openTicketStats(
  context: AuthContext,
  client: Tx = db,
  now: Date = new Date(),
): Promise<TicketSlaSummary> {
  assertCan(context, 'ticket.read')

  // One query over both open statuses rather than a list call per status: the dashboard tile runs on
  // every page load and only needs four columns.
  const rows = await client.ticket.findMany({
    where: { ...ticketReadWhere(context), status: { in: ['NEW', 'TRIAGED'] } },
    select: { priority: true, reportedAt: true, respondedAt: true, closedAt: true },
  })
  const targetsFor = await loadSlaTargets(client)

  let breached = 0
  let atRisk = 0
  let p1Open = 0
  for (const row of rows) {
    const sla = ticketSla(row, targetsFor(row.priority), now)
    if (sla.response.state === 'breached') breached += 1
    else if (sla.response.state === 'at-risk') atRisk += 1
    if (row.priority === 'P1') p1Open += 1
  }
  return { open: rows.length, breached, atRisk, p1Open }
}

/**
 * Customers, their sites and their cranes, as the intake form needs them.
 *
 * Sent to the browser in one payload because the customer → site → crane choice is a cascade and
 * doing a round trip per keystroke would make a phone call worse than the paper form it replaces. At
 * the size this business operates (hundreds of cranes, not millions) that is a few tens of kilobytes
 * of option lists; the alternative is a search endpoint before there is any evidence it is needed.
 *
 * A role that can raise a ticket but cannot read customers gets an empty list rather than an error —
 * the page shows "ask the office" instead of a form with no choices. That keeps the fail-closed scope
 * filter the single answer to "who may see which customers".
 */
export interface TicketIntakeCustomer {
  id: string
  legalName: string
  tradingName: string | null
  sites: Array<{
    id: string
    name: string
    cranes: Array<{ id: string; assetTag: string; status: string }>
  }>
}

export async function listTicketIntakeOptions(
  context: AuthContext,
  client: Tx = db,
): Promise<TicketIntakeCustomer[]> {
  assertCan(context, 'ticket.create')

  return client.customer.findMany({
    where: { ...customerReadWhere(context) },
    orderBy: { legalName: 'asc' },
    select: {
      id: true,
      legalName: true,
      tradingName: true,
      sites: {
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          cranes: {
            where: { deletedAt: null },
            orderBy: { assetTag: 'asc' },
            select: { id: true, assetTag: true, status: true },
          },
        },
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Resolves the optional site and crane against the customer, so a ticket cannot be filed against a
 * crane that belongs to somebody else (or a crane at a different site than the one given).
 */
async function resolveTicketLocation(
  tx: Tx,
  context: AuthContext,
  customerId: string,
  siteId: string | null,
  craneId: string | null,
): Promise<{ siteId: string | null; craneId: string | null }> {
  const customer = await tx.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true },
  })
  if (!customer) throw new NotFoundError('No such customer.')

  if (!craneId) {
    if (!siteId) return { siteId: null, craneId: null }
    const site = await tx.site.findFirst({
      where: { id: siteId, customerId, deletedAt: null, ...siteReadWhere(context) },
      select: { id: true },
    })
    if (!site) throw new RuleError('That site does not belong to this customer.')
    return { siteId: site.id, craneId: null }
  }

  const crane = await tx.crane.findFirst({
    where: { id: craneId, customerId, deletedAt: null, ...craneReadWhere(context) },
    select: { id: true, siteId: true },
  })
  if (!crane) throw new RuleError('That crane does not belong to this customer.')

  // The crane's site is the truth. Accepting a site id that disagrees with it would let a dispatch
  // sheet send someone to the wrong plant.
  if (siteId && siteId !== crane.siteId) {
    throw new RuleError('That crane is not at that site.')
  }
  return { siteId: crane.siteId, craneId: crane.id }
}

export async function createTicket(
  context: AuthContext,
  raw: unknown,
  client: Tx = db,
): Promise<TicketSummary> {
  assertCan(context, 'ticket.create')
  const input = parseInput(createTicketSchema, raw)

  const created = await withAudit(
    context,
    async (tx, log) => {
      const location = await resolveTicketLocation(
        tx,
        context,
        input.customerId,
        input.siteId,
        input.craneId,
      )

      const number = await nextDocumentNumber(tx, 'TICKET')

      const ticket = await tx.ticket.create({
        data: {
          number,
          source: input.source,
          customerId: input.customerId,
          siteId: location.siteId,
          craneId: location.craneId,
          description: input.description,
          priority: input.priority,
          status: 'NEW',
          triageNotes: input.triageNotes,
          createdById: context.userId,
        },
        select: ticketSelect,
      })

      await log({
        entity: 'Ticket',
        entityId: ticket.id,
        action: 'CREATE',
        after: {
          number: ticket.number,
          source: ticket.source,
          customerId: ticket.customer.id,
          siteId: ticket.site?.id ?? null,
          craneId: ticket.crane?.id ?? null,
          description: ticket.description,
          priority: ticket.priority,
          status: ticket.status,
        },
      })

      // A P1 is an alert, not a row. Told about it inside the same transaction so the notification
      // and the ticket either both exist or neither does.
      if (ticket.priority === 'P1') {
        await notifyDispatchersOfP1(tx, {
          ticketId: ticket.id,
          number: ticket.number,
          customerName: ticket.customer.legalName,
          assetTag: ticket.crane?.assetTag ?? null,
          description: ticket.description,
        })
      }

      return ticket
    },
    client,
  )

  const targetsFor = await loadSlaTargets(client)
  return toSummary(
    created,
    ticketSla(
      {
        priority: created.priority,
        reportedAt: created.reportedAt,
        respondedAt: created.respondedAt,
        closedAt: created.closedAt,
      },
      targetsFor(created.priority),
      new Date(),
    ),
  )
}

/**
 * Triage: set the priority and decide what happens next.
 *
 * `respondedAt` is stamped the first time a ticket is triaged, and never overwritten. That is the
 * moment the company responded to the customer — not the moment it was closed, and not a later
 * re-triage, which would quietly improve a missed target.
 */
export async function triageTicket(
  context: AuthContext,
  ticketId: string,
  raw: unknown,
  client: Tx = db,
): Promise<TicketDetail> {
  assertCan(context, 'ticket.triage')
  const input = parseInput(triageTicketSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.ticket.findFirst({
        where: { id: ticketId, ...ticketReadWhere(context) },
        select: { id: true, status: true, priority: true, triageNotes: true, respondedAt: true },
      })
      if (!before) throw new NotFoundError('No such ticket.')

      if (before.status === 'CLOSED' || before.status === 'CANCELLED') {
        throw new RuleError('This ticket is finished. Reopen it before triaging again.')
      }
      if (before.status === 'CONVERTED') {
        throw new RuleError('This ticket has already become jobs. Change the job priority instead.')
      }

      const after = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          priority: input.priority,
          status: input.status,
          triageNotes: input.triageNotes,
          respondedAt: before.respondedAt ?? new Date(),
        },
        select: ticketSelect,
      })

      await log({
        entity: 'Ticket',
        entityId: ticketId,
        action: 'UPDATE',
        before: {
          status: before.status,
          priority: before.priority,
          triageNotes: before.triageNotes,
        },
        after: {
          status: after.status,
          priority: after.priority,
          triageNotes: after.triageNotes,
        },
      })
    },
    client,
  )

  return getTicket(context, ticketId, client)
}

/** Corrects the record of the call. Priority is not editable here — that is triage's job. */
export async function updateTicket(
  context: AuthContext,
  ticketId: string,
  raw: unknown,
  client: Tx = db,
): Promise<TicketDetail> {
  assertCan(context, 'ticket.triage')
  const input = parseInput(updateTicketSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.ticket.findFirst({
        where: { id: ticketId, ...ticketReadWhere(context) },
        select: { id: true, customerId: true, description: true, siteId: true, craneId: true, triageNotes: true },
      })
      if (!before) throw new NotFoundError('No such ticket.')

      const location = await resolveTicketLocation(
        tx,
        context,
        before.customerId,
        input.siteId,
        input.craneId,
      )

      await tx.ticket.update({
        where: { id: ticketId },
        data: {
          description: input.description,
          siteId: location.siteId,
          craneId: location.craneId,
          triageNotes: input.triageNotes,
        },
      })

      const after = await tx.ticket.findUniqueOrThrow({
        where: { id: ticketId },
        select: { description: true, siteId: true, craneId: true, triageNotes: true },
      })
      await log({
        entity: 'Ticket',
        entityId: ticketId,
        action: 'UPDATE',
        before: {
          description: before.description,
          siteId: before.siteId,
          craneId: before.craneId,
          triageNotes: before.triageNotes,
        },
        after: { ...after },
      })
    },
    client,
  )

  return getTicket(context, ticketId, client)
}

/**
 * Closes or cancels a ticket. Both stamp `closedAt`, which stops the resolution clock; the
 * difference is the word the office would use, and the audit log keeps it.
 */
export async function closeTicket(
  context: AuthContext,
  ticketId: string,
  raw: unknown,
  client: Tx = db,
): Promise<TicketDetail> {
  assertCan(context, 'ticket.triage')
  const input = parseInput(closeTicketSchema, raw)

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.ticket.findFirst({
        where: { id: ticketId, ...ticketReadWhere(context) },
        select: { id: true, status: true, triageNotes: true, closedAt: true },
      })
      if (!before) throw new NotFoundError('No such ticket.')

      if (before.status === 'CLOSED' || before.status === 'CANCELLED') {
        throw new RuleError('This ticket is already finished.')
      }
      if (before.status === 'CONVERTED') {
        throw new RuleError(
          'This ticket has become jobs. Close the jobs instead — the ticket is the record of the call.',
        )
      }

      const outcome = input.outcome
      const after = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: outcome,
          closedAt: before.closedAt ?? new Date(),
          // The note is appended rather than replacing triage: losing what was decided at triage
          // because someone closed the ticket is exactly the history the audit log exists to keep,
          // and the office reads this field, not the log.
          triageNotes: input.note
            ? [before.triageNotes, `[${outcome === 'CANCELLED' ? 'Cancelled' : 'Closed'}] ${input.note}`]
                .filter(Boolean)
                .join('\n\n')
            : before.triageNotes,
        },
        select: { status: true, triageNotes: true },
      })

      await log({
        entity: 'Ticket',
        entityId: ticketId,
        action: 'UPDATE',
        before: { status: before.status },
        after: { status: after.status, note: input.note },
      })
    },
    client,
  )

  return getTicket(context, ticketId, client)
}

/**
 * Reopens a closed or cancelled ticket. Cancelling a visit and then finding the fault was real is
 * ordinary, and making someone raise a duplicate ticket would split its history.
 */
export async function reopenTicket(
  context: AuthContext,
  ticketId: string,
  client: Tx = db,
): Promise<TicketDetail> {
  assertCan(context, 'ticket.triage')

  await withAudit(
    context,
    async (tx, log) => {
      const before = await tx.ticket.findFirst({
        where: { id: ticketId, ...ticketReadWhere(context) },
        select: { id: true, status: true },
      })
      if (!before) throw new NotFoundError('No such ticket.')
      if (before.status !== 'CLOSED' && before.status !== 'CANCELLED') {
        throw new RuleError('Only a closed or cancelled ticket can be reopened.')
      }

      // Back to NEW rather than TRIAGED: the priority and notes are still there, but the decision
      // to act on it is not, and re-reading it is the point of reopening.
      await tx.ticket.update({
        where: { id: ticketId },
        data: { status: 'NEW', closedAt: null },
      })
      await log({
        entity: 'Ticket',
        entityId: ticketId,
        action: 'UPDATE',
        before: { status: before.status },
        after: { status: 'NEW' },
      })
    },
    client,
  )

  return getTicket(context, ticketId, client)
}
