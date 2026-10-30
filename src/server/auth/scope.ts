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
  // A customer user sees only their own jobs (slice 31). Deliberately below the capability checks:
  // the portal role must never hold `job.read.all`, and this branch is what narrows it.
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
 * Filter for `CraneSchedule` — the recurring obligations (slice 12).
 *
 * It follows the crane, never its own capability: a schedule is a fact about a machine, so whoever may
 * read the crane may read what is due on it, and nobody else may. Keying it on `craneReadWhere` rather
 * than on `schedule.manage` is what stops a technician browsing the schedule list from seeing work at
 * sites they are not assigned to.
 */
export function craneScheduleReadWhere(ctx: AuthContext): Prisma.CraneScheduleWhereInput {
  return { deletedAt: null, crane: { ...craneReadWhere(ctx), deletedAt: null } }
}

/**
 * Filter for `Certificate` (slice 13).
 *
 * Capability first, then the crane: whoever browses the register sees every live certificate, and a
 * technician — who holds `certificate.read` so they can see a crane's paperwork on a visit — sees only
 * certificates on cranes they can read. A customer user (slice 31) holds `certificate.read` too, and
 * `craneReadWhere` narrows them to their own cranes, so the portal lists their paperwork and nobody
 * else's.
 */
export function certificateReadWhere(ctx: AuthContext): Prisma.CertificateWhereInput {
  if (!can(ctx.role, 'certificate.read')) return DENY
  if (can(ctx.role, 'crane.register.read')) return { ...LIVE, crane: { ...LIVE } }
  return { ...LIVE, crane: { ...craneReadWhere(ctx), deletedAt: null } }
}

/**
 * Filter for `Finding` — a defect recorded on a report (slice 16).
 *
 * It follows the report, never its own capability. A finding is quoted from a document somebody
 * signed, so whoever may read that report may read what it raised, and nobody else may. A technician
 * therefore sees the findings on their own jobs; the office sees them all.
 */
export function findingReadWhere(ctx: AuthContext): Prisma.FindingWhereInput {
  return { report: reportReadWhere(ctx) }
}

/**
 * Filter for `DeliveryOrder` (slice 18).
 *
 * It follows the job, not its own capability: a DO is paperwork for parts issued on a visit, so
 * whoever may read that job may read what left the van for it. A role without `job.read.all` sees
 * only the DOs on jobs whose filter it enters, and a technician therefore sees their own.
 */
export function deliveryOrderReadWhere(ctx: AuthContext): Prisma.DeliveryOrderWhereInput {
  return { job: jobReadWhere(ctx) }
}

/**
 * Filter for `Quote` (slice 19).
 *
 * A quote is commercial paperwork for a customer, so it is read by whoever has `quote.read`: dispatch
 * raises it and finance reads what was offered. It does not follow the job because `Quote.jobId` has
 * no relation in the schema — adding one is a migration for nothing, since every role that may read a
 * quote also holds `job.read.all`. A customer user (Phase 4) sees only their own.
 */
export function quoteReadWhere(ctx: AuthContext): Prisma.QuoteWhereInput {
  if (can(ctx.role, 'quote.read')) return { ...LIVE }
  if (ctx.customerId) return { ...LIVE, customerId: ctx.customerId }
  return DENY
}

/**
 * Filter for `Invoice` (slice 20).
 *
 * Same shape as `quoteReadWhere`: it is commercial paperwork for a customer, so whoever holds
 * `invoice.read` — finance and admin today — sees every live invoice, and a customer user (Phase 4)
 * sees only their own. A void invoice stays visible: it is a cancelled bill, not a deleted one.
 */
export function invoiceReadWhere(ctx: AuthContext): Prisma.InvoiceWhereInput {
  if (can(ctx.role, 'invoice.read')) return { ...LIVE }
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

/**
 * Filter for `Technician` — the scheduling roster (brief §4.4).
 *
 * Whoever builds the board sees the whole roster; that is what `job.schedule` is for. A technician
 * sees only their own row, because their competencies, leave and on-call shifts are theirs — the
 * board shows a colleague's availability as a coloured block, not as a list of reasons.
 */
export function technicianReadWhere(ctx: AuthContext): Prisma.TechnicianWhereInput {
  if (can(ctx.role, 'job.schedule')) return {}
  if (ctx.technicianId) return { id: ctx.technicianId }
  return DENY
}

/**
 * Filter for `Unavailability`. Same shape as the roster: the dispatcher needs everybody's leave to
 * see the board at all, and a technician needs their own so the PWA can say why they are off.
 */
export function unavailabilityReadWhere(ctx: AuthContext): Prisma.UnavailabilityWhereInput {
  if (can(ctx.role, 'job.schedule')) return {}
  if (ctx.technicianId) return { technicianId: ctx.technicianId }
  return DENY
}

/** Filter for `OnCallShift`. The roster is a dispatch tool; a technician sees their own shifts. */
export function onCallShiftReadWhere(ctx: AuthContext): Prisma.OnCallShiftWhereInput {
  if (can(ctx.role, 'job.schedule')) return {}
  if (ctx.technicianId) return { technicianId: ctx.technicianId }
  return DENY
}

/**
 * Filter for `Resource` — vehicles, test weights and load cells (brief §4.4).
 *
 * `resource.read` is the store's and dispatch's: they are the people who know a test weight is out
 * for calibration. A technician sees only the resources booked onto their own jobs, which is all
 * they need to know what to collect — and what not to turn up without.
 */
export function resourceReadWhere(ctx: AuthContext): Prisma.ResourceWhereInput {
  if (can(ctx.role, 'resource.read')) return {}
  if (ctx.technicianId) {
    return {
      jobResources: { some: { job: assignedTo(ctx.technicianId) } },
    }
  }
  return DENY
}
