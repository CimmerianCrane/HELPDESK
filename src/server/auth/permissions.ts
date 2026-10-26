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
  'job.complete',
  'job.approve',
  /** Displacing a scheduled job to make room for a P1. Always audited, always reasoned. */
  'job.bump',

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

  // Commercial
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
    'job.bump',
    'report.read.all',
    'report.approve',
    'report.amend',
    'finding.followUpJob',
    'certificate.read',
    'certificate.write',
    'schedule.manage',
    'part.read',
    'quote.write',
    'dashboard.office',
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
  ],

  STOREKEEPER: [
    'part.read',
    'part.write',
    'stock.move',
    'stocktake.approve',
    'supplier.write',
    'crane.read',
    'crane.register.read',
    'job.read.all',
    'report.read.all',
    'certificate.read',
  ],

  FINANCE: [
    'customer.read',
    'crane.read',
    'crane.register.read',
    'job.read.all',
    'report.read.all',
    'certificate.read',
    'invoice.read',
    'invoice.write',
    'pricing.approve',
    'writeoff.approve',
    'report.financial',
    'dashboard.office',
  ],

  /**
   * Phase 4. A customer user logs in and sees only their own cranes, reports, certificates and due
   * dates. The capability list is empty until the portal exists; the row-level scoping it will need
   * is already in scope.ts, which is why there is a branch for it there today.
   */
  CUSTOMER: [],
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
