import type { Priority, TicketSource, TicketStatus } from '@prisma/client'

/** How a ticket is written on screen. One place, so the list and the detail page agree. */

export const PRIORITY_LABELS: Record<Priority, string> = {
  P1: 'P1 — Crane down / safety risk',
  P2: 'P2 — Degraded operation',
  P3: 'P3 — Routine',
  P4: 'P4 — Planned',
}

/** The short form, for a table cell or a badge where the full label would crowd everything out. */
export const PRIORITY_SHORT_LABELS: Record<Priority, string> = {
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
  P4: 'P4',
}

export const PRIORITY_DESCRIPTIONS: Record<Priority, string> = {
  P1: 'The crane is down or someone is at risk. Alert dispatch now.',
  P2: 'Operating with a limitation, or a repair that cannot wait for the next routine visit.',
  P3: 'Normal work. Schedule it when it suits.',
  P4: 'Planned or scheduled work. No urgency.',
}

export const TICKET_SOURCE_LABELS: Record<TicketSource, string> = {
  PHONE: 'Phone',
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
  WEB: 'Web form',
  PORTAL: 'Customer portal',
}

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  NEW: 'New',
  TRIAGED: 'Triaged',
  CONVERTED: 'Converted to jobs',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
}

export const TICKET_STATUS_DESCRIPTIONS: Record<TicketStatus, string> = {
  NEW: 'Recorded and not yet looked at.',
  TRIAGED: 'Looked at: priority set and next step decided.',
  CONVERTED: 'Jobs have been raised from it. The ticket stays as the record of the call.',
  CLOSED: 'Finished. The jobs carry the work.',
  CANCELLED: 'Not going ahead, and here is why.',
}

export const SLA_STATE_LABELS = {
  met: 'Met',
  'on-time': 'On time',
  'at-risk': 'At risk',
  breached: 'Breached',
} as const
