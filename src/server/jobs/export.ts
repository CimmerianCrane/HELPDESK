import { csvEscape } from '@/lib/csv'
import { db } from '@/lib/db'
import { formatDateTime } from '@/lib/format'
import { assertCan } from '@/server/auth/permissions'
import type { AuthContext } from '@/server/auth/types'
import { JOB_STATUS_LABELS, ON_HOLD_REASON_LABELS } from '@/server/jobs/labels'
import { listJobs } from '@/server/jobs/jobs'

/**
 * The job list as CSV (brief §8).
 *
 * It exports exactly what the screen is showing — same filters, same order, same rows — because an
 * export that quietly ignores the filter is how people end up emailing the wrong spreadsheet. The
 * screen and this function both call `listJobs`; neither has a filter of its own.
 *
 * Wall-clock timestamps in the operating timezone, matching what is on screen. A dispatcher opening
 * this in Excel wants the time they saw, not a UTC instant.
 */
export const JOB_CSV_COLUMNS = [
  'Job number',
  'Status',
  'Priority',
  'Job type',
  'Customer',
  'Site',
  'Cranes',
  'On hold reason',
  'Ticket',
  'Customer PO',
  'Scheduled start',
  'Scheduled end',
  'Raised',
  'Completed',
  'SLA response',
  'SLA resolution',
] as const

export async function jobsCsv(
  context: AuthContext,
  filters: unknown,
  timezone: string,
): Promise<string> {
  assertCan(context, 'job.read.all')
  const jobs = await listJobs(context, filters, db, new Date(), timezone)

  const lines = [JOB_CSV_COLUMNS.map(csvEscape).join(',')]

  for (const job of jobs) {
    const at = (value: Date | null) => (value ? formatDateTime(value, timezone) : '')
    lines.push(
      [
        job.number,
        JOB_STATUS_LABELS[job.status],
        job.priority,
        job.jobType.name,
        job.customer.legalName,
        job.site?.name ?? '',
        job.cranes.map((crane) => crane.assetTag).join(' '),
        job.onHoldReason ? ON_HOLD_REASON_LABELS[job.onHoldReason] : '',
        job.ticket?.number ?? '',
        job.customerPoRef ?? '',
        at(job.scheduledStart),
        at(job.scheduledEnd),
        at(job.reportedAt),
        at(job.completedAt),
        job.sla.response.state,
        job.sla.resolution.state,
      ]
        .map(csvEscape)
        .join(','),
    )
  }

  return lines.join('\r\n')
}
