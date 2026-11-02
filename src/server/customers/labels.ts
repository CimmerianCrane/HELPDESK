import type { ContactRole, CustomerStatus, PreferredChannel } from '@prisma/client'

/** Wording used on customer screens. One place, so a label never differs between two pages. */

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  PROSPECT: 'Prospect',
  ACTIVE: 'Active',
  DORMANT: 'Dormant',
}

export const CUSTOMER_STATUS_DESCRIPTIONS: Record<CustomerStatus, string> = {
  PROSPECT: 'Quoted or in discussion. No work yet.',
  ACTIVE: 'Under contract or doing regular work.',
  DORMANT: 'No work for a long time, but the history is kept.',
}

export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  SITE_CONTACT: 'Site contact',
  ACCOUNTS: 'Accounts',
  SAFETY_OFFICER: 'Safety officer',
  DECISION_MAKER: 'Decision maker',
}

export const PREFERRED_CHANNEL_LABELS: Record<PreferredChannel, string> = {
  PHONE: 'Phone',
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
  SMS: 'SMS',
}
