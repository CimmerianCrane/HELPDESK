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
  P1: 'border-red-300 bg-red-50 font-semibold text-red-800',
  P2: 'border-amber-300 bg-amber-50 text-amber-900',
  P3: 'border-slate-200 bg-slate-50 text-slate-700',
  P4: 'border-slate-200 bg-white text-slate-500',
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs ${PRIORITY_STYLES[priority]}`}>
      {PRIORITY_SHORT_LABELS[priority]}
    </span>
  )
}

const STATUS_STYLES: Record<TicketStatus, string> = {
  NEW: 'border-sky-200 bg-sky-50 text-sky-800',
  TRIAGED: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  CONVERTED: 'border-violet-200 bg-violet-50 text-violet-800',
  CLOSED: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  CANCELLED: 'border-slate-200 bg-slate-100 text-slate-600',
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs ${STATUS_STYLES[status]}`}>
      {TICKET_STATUS_LABELS[status]}
    </span>
  )
}

const SLA_STYLES = {
  met: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'on-time': 'border-slate-200 bg-white text-slate-600',
  'at-risk': 'border-amber-300 bg-amber-50 text-amber-900',
  breached: 'border-red-300 bg-red-50 font-medium text-red-800',
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
      <span className="text-[10px] tracking-wide uppercase opacity-70">{label}</span>{' '}
      {detail}
    </span>
  )
}
