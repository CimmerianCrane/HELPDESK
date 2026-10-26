import type { Prisma } from '@prisma/client'
import { can } from './permissions'
import type { AuthContext } from './types'

/**
 * Row-level scoping. The second half of authorization: `permissions.ts` decides *whether* a role may
 * read jobs, this file decides *which rows*.
 *
 * Every service that reads one of these entities must spread the matching filter into its `where`.
 * The pattern is deliberately boring so it is easy to check by eye and easy to grep for:
 *
 *     db.job.findMany({ where: { ...jobReadWhere(ctx), status: 'SCHEDULED' } })
 *
 * It fails closed. A role that holds neither `*.read.all` nor `*.read.own` gets a filter matching
 * nothing, not an unfiltered query — so forgetting to add a role to the map denies access instead of
 * opening it. That is the opposite of the usual default, and it is on purpose.
 */

/**
 * Matches no rows, for a role with no read capability at all. A non-existent id rather than
 * `{ in: [] }` because the intent is unmistakable to a reader and it assumes nothing about how Prisma
 * compiles an empty list.
 */
const DENY = { id: '__denied__' } as const

/** Nothing soft-deleted is ever visible through a normal read. */
const LIVE = { deletedAt: null } as const

/** Jobs the technician is assigned to, via the JobTechnician join. */
function assignedTo(technicianId: string): Prisma.JobWhereInput {
  return { technicians: { some: { technicianId } } }
}

/** Filter for `Job`. The technician case is the one the brief calls out by name (§12.9). */
export function jobReadWhere(ctx: AuthContext): Prisma.JobWhereInput {
  if (can(ctx.role, 'job.read.all')) return { ...LIVE }
  if (can(ctx.role, 'job.read.own') && ctx.technicianId) {
    return { ...LIVE, ...assignedTo(ctx.technicianId) }
  }
  // Phase 4: a customer user sees only their own jobs.
  if (ctx.customerId) return { ...LIVE, customerId: ctx.customerId }
  return DENY
}

/**
 * Filter for `Report`. "Own" means the report is on a job the technician is assigned to.
 *
 * No `deletedAt` here: reports are never deleted, only amended (CLAUDE.md rule 4). An approved report
 * is superseded by a new version that links back to it, never removed.
 */
export function reportReadWhere(ctx: AuthContext): Prisma.ReportWhereInput {
  if (can(ctx.role, 'report.read.all')) return {}
  if (can(ctx.role, 'report.read.own') && ctx.technicianId) {
    return { job: assignedTo(ctx.technicianId) }
  }
  if (ctx.customerId) return { crane: { customerId: ctx.customerId } }
  return DENY
}

/**
 * Filter for `Crane`. A technician sees the cranes on a job they are assigned to, plus the other
 * cranes at that site — they need those to do the visit and to see a Do Not Operate flag before
 * touching anything. They may not browse the register; that is what `crane.register.read` marks.
 */
export function craneReadWhere(ctx: AuthContext): Prisma.CraneWhereInput {
  if (can(ctx.role, 'crane.register.read')) return { ...LIVE }
  if (ctx.technicianId) {
    return {
      ...LIVE,
      OR: [
        { jobs: { some: { job: assignedTo(ctx.technicianId) } } },
        { site: { jobs: { some: assignedTo(ctx.technicianId) } } },
      ],
    }
  }
  if (ctx.customerId) return { ...LIVE, customerId: ctx.customerId }
  return DENY
}

/**
 * Filter for `Site`. Follows the same shape as `craneReadWhere`: a role that browses sites sees all
 * of them, a technician sees the sites their jobs are at (they need the address and access notes),
 * and a customer user sees their own.
 *
 * `crane.register.read` counts as browsing sites too, because the register is organised by site:
 * finance and the store hold the register without `site.read`, and a register whose every row says
 * "no such site" would be worse than useless.
 */
export function siteReadWhere(ctx: AuthContext): Prisma.SiteWhereInput {
  if (can(ctx.role, 'site.read') || can(ctx.role, 'crane.register.read')) return { ...LIVE }
  if (ctx.technicianId) {
    return { ...LIVE, jobs: { some: assignedTo(ctx.technicianId) } }
  }
  if (ctx.customerId) return { ...LIVE, customerId: ctx.customerId }
  return DENY
}

/**
 * Filter for `Ticket`. The office reads the whole intake board. A technician holds `ticket.read`
 * only so they can see a ticket they raised themselves when a customer phones them directly — they
 * are told about work by dispatch, not by browsing the queue, so anything else is denied.
 *
 * The technician branch comes first because they also hold the capability; capability and scope are
 * separate questions, and the capability check alone would open the board to them.
 */
export function ticketReadWhere(ctx: AuthContext): Prisma.TicketWhereInput {
  if (ctx.role === 'TECHNICIAN') return { createdById: ctx.userId }
  if (can(ctx.role, 'ticket.read')) return {}
  // Phase 4: a customer user sees their own tickets.
  if (ctx.customerId) return { customerId: ctx.customerId }
  return DENY
}

/** Filter for `Customer`. Technicians hold no customer.read capability, so they get nothing here. */
export function customerReadWhere(ctx: AuthContext): Prisma.CustomerWhereInput {
  if (can(ctx.role, 'customer.read')) return { ...LIVE }
  if (ctx.customerId) return { ...LIVE, id: ctx.customerId }
  return DENY
}
