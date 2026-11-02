import type { Role } from '@prisma/client'

/** What each role is called in front of a customer or on a printed job sheet. */
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  DISPATCHER: 'Dispatcher',
  TECHNICIAN: 'Technician',
  STOREKEEPER: 'Storekeeper',
  FINANCE: 'Finance',
  CUSTOMER: 'Customer',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: 'Everything, including users, settings and the audit log.',
  DISPATCHER: 'Customers, cranes, tickets, scheduling and approving reports.',
  TECHNICIAN: 'Their own jobs and reports, from the mobile app.',
  STOREKEEPER: 'Parts, stock and suppliers.',
  FINANCE: 'Invoices, pricing and financial reporting.',
  CUSTOMER: 'Read-only portal: their own jobs, cranes, certificates and issued reports.',
}
