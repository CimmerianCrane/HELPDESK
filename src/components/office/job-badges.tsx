import type { JobStatus, OnHoldReason } from '@prisma/client'
import { formatDuration } from '@/lib/format'
import type { SlaResult } from '@/server/sla/sla'
import { JOB_STATUS_LABELS, ON_HOLD_REASON_LABELS } from '@/server/jobs/labels'

/**
 * Job state on screen. Server components, like the ticket badges: colour means one thing everywhere,
 * and an on-hold job always shows why.
 */

const JOB_STATUS_STYLES: Record<JobStatus, string> = {
  NEW: 'border-sky-200 bg-sky-50 text-sky-800',
  TRIAGED: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  QUOTED: 'border-amber-200 bg-amber-50 text-amber-900',
  APPROVED: 'border-teal-200 bg-teal-50 text-teal-900',
  SCHEDULED: 'border-violet-200 bg-violet-50 text-violet-800',
  DISPATCHED: 'border-blue-200 bg-blue-50 text-blue-800',
  IN_PROGRESS: 'border-orange-200 bg-orange-50 text-orange-900',
  ON_HOLD: 'border-amber-300 bg-amber-100 font-medium text-amber-900',
  COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  REVIEWED: 'border-emerald-300 bg-emerald-100 text-emerald-900',
  INVOICED: 'border-slate-300 bg-slate-100 text-slate-800',
  CLOSED: 'border-slate-300 bg-slate-200 text-slate-700',
  CANCELLED: 'border-slate-200 bg-slate-50 text-slate-500',
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs ${JOB_STATUS_STYLES[status]}`}>
      {JOB_STATUS_LABELS[status]}
    </span>
  )
}

export function OnHoldBadge({ reason, note }: { reason: OnHoldReason; note: string | null }) {
  return (
    <span
      className="inline-block rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900"
      title={note ?? undefined}
    >
      On hold — {ON_HOLD_REASON_LABELS[reason]}
    </span>
  )
}

/** The SLA state, with the numbers a dispatcher needs: how long is left, or how late it is. */
export function JobSlaBadge({ label, sla }: { label: string; sla: SlaResult }) {
  let detail = 'No clock'
  if (sla.dueAt) {
    if (sla.state === 'met') {
      detail = `Met${sla.elapsedMs !== null ? ` in ${formatDuration(sla.elapsedMs)}` : ''}`
    } else if (sla.state === 'breached') {
      detail =
        sla.elapsedMs !== null && sla.elapsedMs < 0 ? `Overdue ${formatDuration(sla.elapsedMs)}` : 'Breached'
    } else if (sla.remainingMs !== null) {
      detail = `${formatDuration(sla.remainingMs)} left`
    }
  }

  const styles =
    sla.state === 'breached'
      ? 'border-red-300 bg-red-50 font-medium text-red-800'
      : sla.state === 'at-risk'
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : sla.state === 'met'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-slate-200 bg-white text-slate-600'

  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs ${styles}`}
      title={sla.dueAt ? `Due ${sla.dueAt.toISOString()}` : undefined}
    >
      <span className="text-[10px] tracking-wide uppercase opacity-70">{label}</span> {detail}
    </span>
  )
}
