import type { Priority, TicketStatus } from '@prisma/client'
import { formatDuration } from '@/lib/format'
import type { SlaResult } from '@/server/sla/sla'
import { PRIORITY_SHORT_LABELS, SLA_STATE_LABELS, TICKET_STATUS_LABELS } from '@/server/tickets/labels'

/**
 * Small presentational pieces shared by the ticket list and the ticket screen, so a P1 looks the same
 * everywhere and a colour never means two different things.
 *
 * They are server components: they render strings and classes, hold no state and make no queries.
 */

const PRIORITY_STYLES: Record<Priority, string> = {
  P1: 'border-neg/40 bg-neg/10 font-semibold text-neg',
  P2: 'border-warn/40 bg-warn/10 text-warn',
  P3: 'border-line bg-sheet text-ink',
  P4: 'border-line bg-field text-muted',
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs ${PRIORITY_STYLES[priority]}`}>
      {PRIORITY_SHORT_LABELS[priority]}
    </span>
  )
}

const STATUS_STYLES: Record<TicketStatus, string> = {
  NEW: 'border-info/40 bg-info/10 text-info',
  TRIAGED: 'border-line bg-raised text-ink',
  CONVERTED: 'border-pos/40 bg-pos/10 text-pos',
  CLOSED: 'border-line bg-panel text-muted',
  CANCELLED: 'border-line bg-sheet text-faint line-through',
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs ${STATUS_STYLES[status]}`}>
      {TICKET_STATUS_LABELS[status]}
    </span>
  )
}

const SLA_STYLES = {
  met: 'border-line bg-field text-muted',
  'on-time': 'border-line bg-field text-muted',
  'at-risk': 'border-warn/40 bg-warn/10 text-warn',
  breached: 'border-neg/40 bg-neg/10 font-medium text-neg',
} as const

/**
 * One SLA window as a badge: what it is, whether it is met, and — while it is still running — how
 * long is left. The deadline itself belongs on the ticket screen; a table cell shows the state.
 */
export function SlaBadge({ label, sla }: { label: string; sla: SlaResult }) {
  let detail: string = SLA_STATE_LABELS[sla.state]
  if (!sla.dueAt) {
    detail = 'No clock'
  } else if (sla.state === 'met') {
    detail = `Met${sla.elapsedMs !== null ? ` in ${formatDuration(sla.elapsedMs)}` : ''}`
  } else if (sla.state === 'breached') {
    detail = sla.remainingMs === 0 && sla.elapsedMs !== null && sla.elapsedMs < 0
      ? `Overdue ${formatDuration(sla.elapsedMs)}`
      : 'Breached'
  } else if (sla.remainingMs !== null) {
    detail = `${formatDuration(sla.remainingMs)} left`
  }

  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs ${SLA_STYLES[sla.state]}`}
      title={sla.dueAt ? `Due ${sla.dueAt.toISOString()}` : undefined}
    >
      <span className="text-[10px] opacity-70">{label}</span>{' '}
      {detail}
    </span>
  )
}
