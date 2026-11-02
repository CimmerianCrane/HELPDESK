import type { Role } from './types'
import { ForbiddenError } from './errors'

/**
 * The single place a role maps to what it may do (CLAUDE.md rule 1).
 *
 * Every server action, route handler and service asks this file. UI checks are cosmetic — they keep
 * people from clicking things they cannot use, but they are never the enforcement point.
 *
 * Adding a feature means adding a capability here, not scattering role string comparisons. If you
 * find yourself writing `if (user.role === 'ADMIN')` anywhere else, that check belongs in this file.
 */
export const CAPABILITIES = [
  // Administration
  'user.manage',
  'settings.manage',
  'audit.read',
  /** Reading and marking read the notifications addressed to you (slice 38). Every role holds it. */
  'notification.read',

  // Customers and sites
  'customer.read',
  'customer.write',
  'customer.import',
  'site.read',
  'site.write',

  // Cranes
  /** May look at crane records you are entitled to see. Field roles hold this. */
  'crane.read',
  /** May browse the whole register. Office roles hold this; technicians deliberately do not. */
  'crane.register.read',
  'crane.write',
  'crane.restrict',
  'crane.import',

  // Tickets
  'ticket.read',
  'ticket.create',
  'ticket.triage',
  'ticket.assign',

  // Jobs
  'job.read.all',
  'job.read.own',
  'job.create',
  'job.schedule',
  'job.assign',
  'job.transition',
  /** Sending a scheduled job's details to the technicians on it, and moving it to DISPATCHED. */
  'job.dispatch',
  'job.complete',
  'job.approve',
  /** Displacing a scheduled job to make room for a P1. Always audited, always reasoned. */
  'job.bump',

  // Bookable resources: vehicles, test weights, load cells (brief §4.4)
  /** May see and book the resource list. Dispatch holds it; a technician sees only what is on their job. */
  'resource.read',
  /** May add equipment and record its calibration — the store's job (slice 34). */
  'resource.write',

  // Reports and findings
  'report.read.all',
  'report.read.own',
  'report.draft',
  'report.submit',
  'report.approve',
  'report.amend',
  'finding.write',
  'finding.followUpJob',

  // Compliance
  'certificate.read',
  'certificate.write',
  'schedule.manage',
  'compliancerule.manage',
  'sla.manage',

  // Inventory (Phase 3)
  'part.read',
  'part.write',
  'stock.move',
  'stocktake.approve',
  'supplier.write',
  /** Raising a purchase order from the reorder list, and receiving against it (slice 25). */
  'purchaseorder.write',
  /** Raising and receiving a delivery order — paperwork for parts issued on a job (slice 18). */
  'deliveryorder.write',

  // Customer portal (slice 31)
  /** Signing in to `/portal`: their own jobs, cranes, certificates and issued reports, read-only. */
  'portal.read',

  // Commercial
  /** May read quotes: dispatch raises them, finance sees what has been offered and accepted. */
  'quote.read',
  'quote.write',
  'invoice.read',
  'invoice.write',
  'pricing.approve',
  'writeoff.approve',
  'report.financial',
  'dashboard.office',
] as const

export type Capability = (typeof CAPABILITIES)[number]

/** `'*'` means every capability. Only Admin has it, so a new capability does not need adding to Admin. */
const ALL = '*' as const
export type CapabilityGrant = Capability | typeof ALL

export const ROLE_CAPABILITIES: Record<Role, readonly CapabilityGrant[]> = {
  ADMIN: [ALL],

  DISPATCHER: [
    'customer.read',
    'customer.write',
    'customer.import',
    'site.read',
    'site.write',
    'crane.read',
    'crane.register.read',
    'crane.write',
    'crane.restrict',
    'crane.import',
    'ticket.read',
    'ticket.create',
    'ticket.triage',
    'ticket.assign',
    'job.read.all',
    'job.create',
    'job.schedule',
    'job.assign',
    'job.transition',
    'job.dispatch',
    'job.bump',
    'resource.read',
    'report.read.all',
    'report.approve',
    'report.amend',
    'finding.followUpJob',
    'certificate.read',
    'certificate.write',
    'schedule.manage',
    'part.read',
    'deliveryorder.write',
    'quote.read',
    'quote.write',
    'dashboard.office',
    'notification.read',
  ],

  /** Field technicians. `job.read.own` is additionally scoped at the row level — see scope.ts. */
  TECHNICIAN: [
    'job.read.own',
    'report.read.own',
    'report.draft',
    'report.submit',
    'finding.write',
    'crane.read',
    'certificate.read',
    'part.read',
    'stock.move',
    'ticket.create',
    /**
     * Scoped to tickets they raised themselves — see `ticketReadWhere`. A technician phoning a fault
     * in on a customer's behalf needs to see that it was received; they do not get the intake board.
     */
    'ticket.read',
    /** A dispatch pack reaches the phone as an in-app row; this is how they re-open it. */
    'notification.read',
  ],

  STOREKEEPER: [
    'part.read',
    'part.write',
    'stock.move',
    'stocktake.approve',
    'supplier.write',
    /** The storekeeper is who orders the parts and books them in when they arrive. */
    'purchaseorder.write',
    'crane.read',
    'crane.register.read',
    'job.read.all',
    'resource.read',
    'resource.write',
    'report.read.all',
    'certificate.read',
    /** The storekeeper is who hands the parts over, so the receipt is theirs to record too. */
    'deliveryorder.write',
    'notification.read',
  ],

  FINANCE: [
    'customer.read',
    'crane.read',
    'crane.register.read',
    'job.read.all',
    'report.read.all',
    'certificate.read',
    'quote.read',
    'invoice.read',
    'invoice.write',
    'pricing.approve',
    'writeoff.approve',
    'report.financial',
    'dashboard.office',
    /** Finance reads the book for the value of what it holds; the store maintains it. */
    'part.read',
    'notification.read',
  ],

  /**
   * The customer portal (slice 31). A customer user signs in at `/portal` and sees only their own
   * cranes, certificates, issued reports and jobs; every read is narrowed by the `customerId`
   * branches in scope.ts, and nothing here writes.
   *
   * `crane.read`, `certificate.read` and `report.read.own` are the *existing* capabilities, so a
   * customer user reaches the same crane, certificate and report services the office does and the
   * scope filter decides what comes back. Deliberately absent: `customer.read` (the office's book),
   * `job.read.all` (it would make `jobReadWhere` unfiltered — see scope.ts), and every write.
   */
  CUSTOMER: ['portal.read', 'crane.read', 'certificate.read', 'report.read.own'],
}

export function capabilitiesFor(role: Role): readonly CapabilityGrant[] {
  return ROLE_CAPABILITIES[role]
}

/**
 * Does this role hold this capability? Capability-level only — it says nothing about *which rows*
 * the role may see. A technician holds `job.read.own`, but which jobs are theirs is decided by the
 * scope filter in scope.ts. Both checks are required; neither is sufficient alone.
 */
export function can(role: Role, capability: Capability): boolean {
  const granted = ROLE_CAPABILITIES[role]
  return granted.includes(ALL) || granted.includes(capability)
}

/**
 * The enforcement point. Services call this first with the caller's context, so a service cannot be
 * invoked without an identity and its permission check cannot be forgotten by a caller.
 */
export function assertCan(context: { role: Role }, capability: Capability): void {
  if (!can(context.role, capability)) throw new ForbiddenError()
}
