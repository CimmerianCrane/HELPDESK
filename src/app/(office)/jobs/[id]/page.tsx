import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EditJobForm, TransitionJobForm } from '@/components/office/job-forms'
import { JobStatusBadge, OnHoldBadge } from '@/components/office/job-badges'
import { PriorityBadge } from '@/components/office/ticket-badges'
import { cardClass } from '@/components/office/ui'
import { formatDateTime, formatDuration } from '@/lib/format'
import { requireAuth } from '@/server/auth/context'
import { NotFoundError } from '@/server/auth/errors'
import { can } from '@/server/auth/permissions'
import { JOB_STATUS_DESCRIPTIONS, JOB_STATUS_LABELS, ON_HOLD_REASON_LABELS } from '@/server/jobs/labels'
import { getJob } from '@/server/jobs/jobs'
import { isTerminal, nextStatuses } from '@/server/jobs/status'
import { getSettings } from '@/server/settings/settings'
import type { SlaResult } from '@/server/sla/sla'
import { updateJobAction, transitionJobAction } from '../actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const context = await requireAuth()
  try {
    const job = await getJob(context, id)
    return { title: `${job.number} — Cimmerian Crane Services` }
  } catch (error) {
    if (error instanceof NotFoundError) return { title: 'Job — Cimmerian Crane Services' }
    throw error
  }
}

/**
 * One job. The page answers four questions in reading order: what is it, where is it up to, is it on
 * time, and what has happened to it. The transition form is the only way the status changes, so the
 * history below it is always the reason for the state above it.
 */
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await requireAuth()

  let job: Awaited<ReturnType<typeof getJob>>
  try {
    job = await getJob(context, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    throw error
  }

  const settings = await getSettings()
  const mayMove = can(context.role, 'job.transition')
  const mayEdit = can(context.role, 'job.create')
  const moves = nextStatuses(job.status)
  const finished = isTerminal(job.status)

  return (
    <div className="space-y-8">
      <div>
        <Link href="/jobs" className="text-sm text-slate-600 underline hover:text-slate-900">
          ← Jobs
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-900">{job.number}</h1>
              <PriorityBadge priority={job.priority} />
              <JobStatusBadge status={job.status} />
              {job.onHoldReason ? (
                <OnHoldBadge reason={job.onHoldReason} note={job.onHoldNote} />
              ) : null}
            </div>
            <p className="mt-1 text-slate-600">
              {job.jobType.name}
              {' · '}
              <Link href={`/customers/${job.customer.id}`} className="underline hover:text-slate-900">
                {job.customer.legalName}
              </Link>
              {job.site ? (
                <>
                  {' · '}
                  <Link href={`/sites/${job.site.id}`} className="underline hover:text-slate-900">
                    {job.site.name}
                  </Link>
                </>
              ) : null}
              {job.cranes.length > 0 ? (
                <>
                  {' · '}
                  {job.cranes.map((crane, index) => (
                    <span key={crane.id}>
                      {index > 0 ? ', ' : ''}
                      <Link href={`/cranes/${crane.id}`} className="underline hover:text-slate-900">
                        {crane.assetTag}
                      </Link>
                    </span>
                  ))}
                </>
              ) : null}
            </p>
            {job.ticket ? (
              <p className="mt-1 text-sm text-slate-500">
                Raised from{' '}
                <Link href={`/tickets/${job.ticket.id}`} className="underline hover:text-slate-900">
                  {job.ticket.number}
                </Link>
              </p>
            ) : null}
          </div>

          <p className="text-sm text-slate-500">
            {job.reportedAt ? `Raised ${formatDateTime(job.reportedAt, settings.timezone)}` : 'No reported date'}
          </p>
        </div>
      </div>

      {job.onHoldReason ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">
            On hold — {ON_HOLD_REASON_LABELS[job.onHoldReason]}
          </p>
          <p className="mt-1 text-sm text-amber-900">
            {job.onHoldNote ?? 'No further detail was recorded.'}
          </p>
        </div>
      ) : null}

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Service level</h2>
        <p className="mt-1 text-sm text-slate-600">
          Targets were fixed when the job was raised from the policy in force at that moment. Minutes
          are calendar minutes.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <SlaPanel
            label="Response"
            sla={job.sla.response}
            metAt={job.respondedAt}
            timeZone={settings.timezone}
            explanation="Time to somebody being on the way — dispatch or arrival, whichever happens first."
          />
          <SlaPanel
            label="Resolution"
            sla={job.sla.resolution}
            metAt={job.completedAt ?? job.closedAt}
            timeZone={settings.timezone}
            explanation="Time to the work being finished and the report submitted."
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className={`${cardClass} lg:col-span-2`}>
          <h2 className="font-semibold text-slate-900">What needs doing</h2>
          <p className="mt-3 whitespace-pre-wrap text-slate-900">
            {job.description ?? 'Nothing written down yet.'}
          </p>

          <h3 className="mt-6 text-xs font-medium tracking-wide text-slate-500 uppercase">
            Internal notes
          </h3>
          <p className="mt-1 whitespace-pre-wrap text-slate-700">
            {job.internalNotes ?? 'None.'}
          </p>

          <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                Customer PO / reference
              </dt>
              <dd className="text-slate-900">{job.customerPoRef ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Schedule</dt>
              <dd className="text-slate-900">
                {job.scheduledStart
                  ? `${formatDateTime(job.scheduledStart, settings.timezone)}${job.scheduledEnd ? ` – ${formatDateTime(job.scheduledEnd, settings.timezone)}` : ''}`
                  : 'Not scheduled yet'}
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-sm text-slate-500">{JOB_STATUS_DESCRIPTIONS[job.status]}</p>
        </section>

        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">History</h2>
          <ol className="mt-4 space-y-3 text-sm">
            {job.history.map((entry) => (
              <li key={entry.id} className="border-l-2 border-slate-200 pl-3">
                <p className="font-medium text-slate-900">
                  {entry.fromStatus
                    ? `${JOB_STATUS_LABELS[entry.fromStatus]} → ${JOB_STATUS_LABELS[entry.toStatus]}`
                    : JOB_STATUS_LABELS[entry.toStatus]}
                </p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(entry.changedAt, settings.timezone)}
                  {entry.changedByName ? ` · ${entry.changedByName}` : null}
                </p>
                {entry.onHoldReason ? (
                  <p className="mt-1 text-xs text-amber-800">
                    {ON_HOLD_REASON_LABELS[entry.onHoldReason]}
                  </p>
                ) : null}
                {entry.reason ? <p className="mt-1 text-slate-700">{entry.reason}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      </div>

      {mayMove && !finished && moves.length > 0 ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Move this job on</h2>
          <p className="mt-1 mb-5 text-sm text-slate-600">
            Every move is timestamped, attributed and kept on the history above. On hold always
            records why.
          </p>
          <TransitionJobForm
            action={transitionJobAction.bind(null, job.id)}
            status={job.status}
            nextStatuses={moves}
          />
        </section>
      ) : null}

      {mayEdit ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Correct the paperwork</h2>
          <p className="mt-1 mb-5 text-sm text-slate-600">
            Status is changed above, not here. Every edit is in the audit log.
          </p>
          <EditJobForm
            action={updateJobAction.bind(null, job.id)}
            description={job.description}
            internalNotes={job.internalNotes}
            customerPoRef={job.customerPoRef}
          />
        </section>
      ) : null}
    </div>
  )
}

function SlaPanel({
  label,
  sla,
  metAt,
  timeZone,
  explanation,
}: {
  label: string
  sla: SlaResult
  metAt: Date | null
  timeZone: string
  explanation: string
}) {
  const overdueMs =
    sla.state === 'breached' && sla.elapsedMs !== null && sla.elapsedMs < 0 ? -sla.elapsedMs : 0

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p
        className={
          sla.state === 'breached'
            ? 'mt-1 text-lg font-semibold text-red-700'
            : sla.state === 'at-risk'
              ? 'mt-1 text-lg font-semibold text-amber-800'
              : 'mt-1 text-lg font-semibold text-slate-900'
        }
      >
        {sla.state === 'met'
          ? 'Met'
          : sla.state === 'breached'
            ? 'Breached'
            : sla.state === 'at-risk'
              ? 'At risk'
              : 'On time'}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        {sla.dueAt ? <>Due {formatDateTime(sla.dueAt, timeZone)}</> : 'No clock running.'}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        {sla.state === 'met' && metAt ? (
          <>Recorded {formatDateTime(metAt, timeZone)}</>
        ) : sla.state === 'breached' ? (
          overdueMs > 0 ? (
            <>Overdue by {formatDuration(overdueMs)}</>
          ) : (
            <>The target has passed and nothing has been recorded.</>
          )
        ) : sla.remainingMs !== null ? (
          <>{formatDuration(sla.remainingMs)} left</>
        ) : null}
      </p>
      <p className="mt-2 text-xs text-slate-500">{explanation}</p>
    </div>
  )
}
