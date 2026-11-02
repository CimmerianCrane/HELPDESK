import { can, type Capability } from './permissions'
import type { Role } from './types'
import type { IconName } from '@/components/shell/icons'

/**
 * Every destination in the app and the capability that reveals it — one list, read by the one shell
 * every signed-in surface renders, so a customer never sees a screen they cannot open and the office,
 * the field and the portal cannot drift.
 *
 * `group` is the section heading in the rail. Sections are always open; the order here is the order
 * the rail shows them in. Admin is a utility and is pinned to the foot of the rail.
 *
 * `fieldOnly` marks a destination that only makes sense on the field shell (it hangs off `/m/`), so
 * it is added by `fieldNavFor` rather than by `navFor`.
 */
export interface NavItem {
  href: string
  label: string
  icon: IconName
  capability: Capability | null
  group: string
}

export const APP_NAV: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'grid', capability: null, group: 'Today' },
  { href: '/inbox', label: 'Inbox', icon: 'inbox', capability: 'notification.read', group: 'Today' },

  { href: '/tickets', label: 'Tickets', icon: 'tag', capability: 'ticket.read', group: 'Work' },
  { href: '/jobs', label: 'Jobs', icon: 'clipboard', capability: 'job.read.all', group: 'Work' },
  { href: '/schedule', label: 'Schedule', icon: 'calendar', capability: 'job.schedule', group: 'Work' },
  { href: '/reports', label: 'Reports', icon: 'file', capability: 'report.approve', group: 'Work' },
  { href: '/quotes', label: 'Quotes', icon: 'receipt', capability: 'quote.read', group: 'Work' },

  { href: '/customers', label: 'Customers', icon: 'users', capability: 'customer.read', group: 'Register' },
  { href: '/cranes', label: 'Cranes', icon: 'crane', capability: 'crane.register.read', group: 'Register' },
  { href: '/schedules', label: 'Schedules', icon: 'repeat', capability: 'crane.read', group: 'Register' },
  { href: '/certificates', label: 'Certificates', icon: 'award', capability: 'certificate.read', group: 'Register' },
  { href: '/calibrations', label: 'Calibrations', icon: 'target', capability: 'resource.read', group: 'Register' },

  // The parts book and its paperwork. Stock takes were filed under Money because their side effect
  // is a valuation; that is the ledger's view, not the store reader's, who looks for them beside the
  // book they count.
  { href: '/parts', label: 'Parts', icon: 'box', capability: 'part.read', group: 'Inventory' },
  { href: '/suppliers', label: 'Suppliers', icon: 'truck', capability: 'part.read', group: 'Inventory' },
  { href: '/stock-takes', label: 'Stock takes', icon: 'clipboardCheck', capability: 'stock.move', group: 'Inventory' },

  { href: '/invoices', label: 'Invoices', icon: 'creditCard', capability: 'invoice.read', group: 'Money' },
  { href: '/reports/profitability', label: 'Profitability', icon: 'trendingUp', capability: 'report.financial', group: 'Money' },
  { href: '/reports/utilisation', label: 'Utilisation', icon: 'activity', capability: 'report.financial', group: 'Money' },

  { href: '/admin/users', label: 'Users', icon: 'user', capability: 'user.manage', group: 'Admin' },
  { href: '/admin/compliance', label: 'Compliance', icon: 'shield', capability: 'compliancerule.manage', group: 'Admin' },
  { href: '/admin/sla', label: 'Service levels', icon: 'clock', capability: 'sla.manage', group: 'Admin' },
  { href: '/admin/audit', label: 'Audit', icon: 'history', capability: 'audit.read', group: 'Admin' },
  { href: '/admin/system', label: 'System', icon: 'settings', capability: 'user.manage', group: 'Admin' },
]

/**
 * The customer portal. Its five screens are `portal.read` only, and a customer holds nothing else, so
 * `navFor` gives them exactly this list — the same filter, not a second hand-written one in a layout.
 */
export const PORTAL_NAV: readonly NavItem[] = [
  { href: '/portal', label: 'Overview', icon: 'home', capability: 'portal.read', group: 'Account' },
  { href: '/portal/jobs', label: 'Jobs', icon: 'clipboard', capability: 'portal.read', group: 'Work' },
  { href: '/portal/cranes', label: 'Cranes', icon: 'crane', capability: 'portal.read', group: 'Register' },
  { href: '/portal/certificates', label: 'Certificates', icon: 'award', capability: 'portal.read', group: 'Register' },
  { href: '/portal/reports', label: 'Reports', icon: 'file', capability: 'portal.read', group: 'Register' },
]

/**
 * A customer, by the same test the office layout redirects on (`portal.read` without
 * `dashboard.office`). It has to be the audience rather than a capability filter: a customer holds
 * `crane.read` and `certificate.read` too, so filtering one combined list would offer them the
 * office's `/certificates` and `/schedules`, which redirect straight back to the portal.
 */
function isCustomer(role: Role): boolean {
  return can(role, 'portal.read') && !can(role, 'dashboard.office')
}

/** The destinations this role may open. */
export function navFor(role: Role): NavItem[] {
  const list = isCustomer(role) ? PORTAL_NAV : APP_NAV
  return list.filter((item) => !item.capability || can(role, item.capability))
}

/**
 * The field shell's links: the technician's own work list first, then whatever screens this role may
 * open. A technician holds only a handful of capabilities, so the rail they get is short by
 * construction — the same list decides it as decides the office rail.
 */
export function fieldNavFor(role: Role): NavItem[] {
  return [
    { href: '/m/jobs', label: 'My jobs', icon: 'list', capability: null, group: 'Field' },
    ...navFor(role),
  ]
}

/**
 * What the phone's bottom bar offers, in order. Deliberately short: a bar is scanned with a thumb,
 * and anything past four labels wraps to nothing readable at 390px. The rail at `lg` carries the
 * rest. Each one is dropped if the role cannot open it.
 */
export const FIELD_BAR = ['/m/jobs', '/inbox', '/tickets', '/parts'] as const
