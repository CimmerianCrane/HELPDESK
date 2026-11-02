import type { JobStatus, OnHoldReason } from '@prisma/client'
import { formatDuration } from '@/lib/format'
import type { SlaResult } from '@/server/sla/sla'
import { JOB_STATUS_LABELS, ON_HOLD_REASON_LABELS } from '@/server/jobs/labels'
import { DUE_BUCKET_LABELS, type DueBucket } from '@/server/schedules/recurrence'

/**
 * Job state on screen. Server components, like the ticket badges: colour means one thing everywhere,
 * and an on-hold job always shows why.
 *
 * Hi-Vis Industrial: a lifecycle state is not news, so the ladder is neutral and finished work is
 * quiet — on a list where most rows are closed, thirty green chips teach the eye to ignore green.
 * Only the exceptions earn a tone (amber waiting, red late), so scanning a list is a hunt for the
 * coloured row rather than for a shade.
 */

const NEUTRAL = 'border-line bg-sheet text-muted'
const NEUTRAL_STRONG = 'border-line bg-raised text-ink'
const DONE = 'border-line bg-panel text-muted'
const ACTIVE = 'border-info/40 bg-info/10 text-info'
const WAITING = 'border-warn/40 bg-warn/10 text-warn'
const LATE = 'border-neg/40 bg-neg/10 font-medium text-neg'

const JOB_STATUS_STYLES: Record<JobStatus, string> = {
  NEW: NEUTRAL,
  TRIAGED: NEUTRAL,
  QUOTED: WAITING,
  APPROVED: NEUTRAL_STRONG,
  SCHEDULED: ACTIVE,
  DISPATCHED: ACTIVE,
  IN_PROGRESS: WAITING,
  ON_HOLD: LATE,
  COMPLETED: DONE,
  REVIEWED: DONE,
  INVOICED: NEUTRAL_STRONG,
  CLOSED: DONE,
  CANCELLED: 'border-line bg-sheet text-faint line-through',
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
      className={`inline-block rounded border px-2 py-0.5 text-xs ${LATE}`}
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
      ? LATE
      : sla.state === 'at-risk'
        ? WAITING
        : 'border-line bg-field text-muted'

  return (
    <span
      className={`inline-flex flex-col rounded border px-2 py-1 leading-tight whitespace-nowrap ${styles}`}
      title={sla.dueAt ? `Due ${sla.dueAt.toISOString()}` : undefined}
    >
      {/* Label above value: inlined, "Response No clock" reads as one sentence at table width. */}
      <span className="text-[10px] opacity-70">{label}</span>
      <span className="text-xs font-medium">{detail}</span>
    </span>
  )
}

/**
 * How soon a crane's recurring obligation is due (slice 12). Colour means the same thing here as in
 * the schedule list: red once it has passed, amber inside 60 days, plain after that.
 */
export function DueBadge({ bucket, days }: { bucket: DueBucket; days: number | null }) {
  const styles: Record<DueBucket, string> = {
    overdue: LATE,
    '30': WAITING,
    '60': WAITING,
    '90': 'border-line bg-field text-ink',
    later: 'border-line bg-field text-muted',
    none: 'border-line bg-raised text-muted',
  }

  const detail =
    days === null
      ? 'no date set'
      : days < 0
        ? `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} overdue`
        : days === 0
          ? 'due today'
          : `in ${days} ${days === 1 ? 'day' : 'days'}`

  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs ${styles[bucket]}`}>
      {DUE_BUCKET_LABELS[bucket]} — {detail}
    </span>
  )
}
