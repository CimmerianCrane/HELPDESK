import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EditJobForm, TransitionJobForm } from '@/components/office/job-forms'
import { AuditTrailLink, AuditTrailPanel } from '@/components/office/audit-trail'
import { JobStatusBadge, OnHoldBadge } from '@/components/office/job-badges'
import {
  AssignTechnicianForm,
  BumpJobForm,
  BookResourceForm,
  RescheduleJobForm,
  UnassignTechnicianForm,
} from '@/components/office/schedule-forms'
import { PriorityBadge } from '@/components/office/ticket-badges'
import { cardClass } from '@/components/office/ui'
import {
  CreateDeliveryOrderForm,
  ReceiveDeliveryOrderForm,
  ReturnDeliveryOrderForm,
} from '@/components/office/delivery-order-forms'
import {
  deliveryOrdersForJob,
  issuedPartsForJob,
} from '@/server/delivery-orders/delivery-orders'
import { DELIVERY_STATUS_LABELS } from '@/lib/validation/delivery-orders'
import { formatDateTime, formatDuration } from '@/lib/format'
import { utcToLocalInput } from '@/lib/time'
import { auditTrail } from '@/server/audit/audit'
import { requireAuth } from '@/server/auth/context'
import { NotFoundError } from '@/server/auth/errors'
import { can } from '@/server/auth/permissions'
import { JOB_STATUS_DESCRIPTIONS, JOB_STATUS_LABELS, ON_HOLD_REASON_LABELS } from '@/server/jobs/labels'
import { getJob, listJobs, metadataForJob } from '@/server/jobs/jobs'
import { REPORT_STATUS_LABELS } from '@/server/reports/labels'
import { reportsForJob } from '@/server/reports/reports'
import { isTerminal, nextStatuses } from '@/server/jobs/status'
import { dispatchPack } from '@/server/schedule/dispatch'
import { listResources, listTechnicians } from '@/server/schedule/roster'
import { jobStaffing } from '@/server/schedule/scheduling'
import { dueLabelFor, schedulesForJobCranes } from '@/server/schedules/schedules'
import { SCHEDULE_TYPE_LABELS } from '@/lib/validation/schedules'
import { getSettings } from '@/server/settings/settings'
import type { SlaResult } from '@/server/sla/sla'
import { updateJobAction, transitionJobAction } from '../actions'
import {
  createDeliveryOrderAction,
  receiveDeliveryOrderAction,
  returnDeliveryOrderAction,
} from './delivery-orders/actions'
import {
  assignTechnicianAction,
  bookResourceAction,
  bumpJobAction,
  dispatchJobFormAction,
  releaseResourceAction,
  rescheduleJobAction,
  unassignTechnicianAction,
} from '../../schedule/actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const context = await requireAuth()
  try {
    const [job] = await metadataForJob(context, id)
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

  // Read from the permission map, not the database, so these cost nothing and can gate the batch below.
  const mayMove = can(context.role, 'job.transition')
  const mayEdit = can(context.role, 'job.create')
  const maySchedule = can(context.role, 'job.schedule')
  const mayAssign = can(context.role, 'job.assign')
  const mayDispatch = can(context.role, 'job.dispatch')
  const mayDeliver = can(context.role, 'deliveryorder.write')

  const [
    jobResult,
    settings,
    staffing,
    technicians,
    resources,
    dispatch,
    allJobs,
    reports,
    trail,
    completionSchedules,
    deliveries,
    deliverableParts,
  ] = await Promise.all([
      getJob(context, id).then(
        (job) => ({ job }),
        (error: unknown) => {
          if (error instanceof NotFoundError) notFound()
          throw error
        },
      ),
      getSettings(),
      // Everything below keys off the id in the URL, not off the job row, so it runs alongside the
      // job read rather than waiting a full round trip for it.
      jobStaffing(context, id),
      mayAssign ? listTechnicians(context) : Promise.resolve([]),
      maySchedule && can(context.role, 'resource.read')
        ? listResources(context)
        : Promise.resolve([]),
      mayDispatch
        ? dispatchPack(context, id).catch((error) => {
            if (error instanceof NotFoundError) return null
            throw error
          })
        : Promise.resolve(null),
      can(context.role, 'job.bump') ? listJobs(context, {}) : Promise.resolve([]),
      reportsForJob(context, id),
      can(context.role, 'audit.read') ? auditTrail(context, 'Job', id, 20) : Promise.resolve([]),
      // The schedules this visit could complete (slice 12). Keyed off the id in the URL like the
      // rest, so it joins the same batch; the job row decides below whether they are offered.
      mayMove && can(context.role, 'schedule.manage')
        ? schedulesForJobCranes(context, id)
        : Promise.resolve([]),
      // Delivery orders (slice 18). Reading them follows the job, so anybody who can read it sees
      // the paperwork; only `deliveryorder.write` raises or receipts one.
      can(context.role, 'part.read') ? deliveryOrdersForJob(context, id) : Promise.resolve([]),
      mayDeliver && can(context.role, 'part.read')
        ? issuedPartsForJob(context, id)
        : Promise.resolve([]),
    ])
  const job = jobResult.job

  // Only the bump candidates need the job row (to exclude itself), so the filter stays here.
  const unplaced = allJobs.filter(
    (row) => row.id !== job.id && (!row.scheduledStart || row.priority === 'P1'),
  )

  const moves = nextStatuses(job.status)
  const finished = isTerminal(job.status)

  const rescheduleDefaultStart = staffing.scheduledStart
    ? utcToLocalInput(staffing.scheduledStart, settings.timezone)
    : ''
  const rescheduleDefaultEnd = staffing.scheduledEnd
    ? utcToLocalInput(staffing.scheduledEnd, settings.timezone)
    : ''

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

      {maySchedule || mayAssign || mayDispatch ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Who is going</h2>
          <p className="mt-1 text-sm text-slate-600">
            The visit, the crew and the kit. The board is the fast way to move things; this is the
            precise way.
          </p>

          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">Visit</h3>
              <p className="mt-1 text-sm text-slate-900">
                {staffing.scheduledStart
                  ? `${formatDateTime(staffing.scheduledStart, settings.timezone)}${
                      staffing.scheduledEnd
                        ? ` – ${formatDateTime(staffing.scheduledEnd, settings.timezone)}`
                        : ''
                    }`
                  : 'Not scheduled yet.'}
              </p>

              {maySchedule && !finished ? (
                <div className="mt-4">
                  <RescheduleJobForm
                    action={rescheduleJobAction.bind(null, job.id)}
                    timezone={settings.timezone}
                    defaultStart={rescheduleDefaultStart}
                    defaultEnd={rescheduleDefaultEnd}
                  />
                </div>
              ) : null}
            </div>

            <div>
              <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">Crew</h3>
              {staffing.technicians.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">Nobody assigned.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {staffing.technicians.map((entry) => (
                    <li key={entry.technicianId} className="rounded-md border border-slate-200 p-2">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: entry.colour ?? '#94a3b8' }}
                        />
                        <span className="text-sm font-medium text-slate-900">{entry.name}</span>
                        {entry.isLead ? (
                          <span className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600">
                            lead
                          </span>
                        ) : null}
                      </div>
                      {entry.competency.missing.length > 0 || entry.competency.expired.length > 0 ? (
                        <p className="mt-1 text-xs text-amber-800">
                          {entry.competency.missing.length > 0
                            ? `Missing: ${entry.competency.missing.join(', ')}. `
                            : ''}
                          {entry.competency.expired.length > 0
                            ? `Expired: ${entry.competency.expired.join(', ')}.`
                            : ''}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {mayAssign && !finished ? (
                <div className="mt-4 space-y-4">
                  <AssignTechnicianForm
                    action={assignTechnicianAction.bind(null, job.id)}
                    technicians={technicians}
                  />
                  <UnassignTechnicianForm
                    action={unassignTechnicianAction.bind(null, job.id)}
                    technicians={staffing.technicians.map((entry) => ({
                      technicianId: entry.technicianId,
                      name: entry.name,
                      isLead: entry.isLead,
                    }))}
                  />
                </div>
              ) : null}
            </div>
          </div>

          {maySchedule && resources.length > 0 && !finished ? (
            <div className="mt-6 border-t border-slate-200 pt-4">
              <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                Booked out
              </h3>
              {staffing.resources.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">Nothing booked yet.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {staffing.resources.map((resource) => (
                    <li
                      key={resource.resourceId}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="text-slate-900">{resource.name}</span>
                      <form action={async () => releaseResourceAction(job.id, resource.resourceId)}>
                        <button type="submit" className="text-slate-600 underline hover:text-red-700">
                          Release
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 max-w-md">
                <BookResourceForm
                  action={bookResourceAction.bind(null, job.id)}
                  resources={resources}
                />
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {mayDispatch && dispatch ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Dispatch</h2>
          <p className="mt-1 text-sm text-slate-600">
            Sends the technicians what they need on the road — where to go, who to ask for, what the
            machine has had done to it — and moves the job to Dispatched.
          </p>

          {dispatch.warnings.length > 0 ? (
            <ul className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {dispatch.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Site</dt>
              <dd className="text-slate-900">
                {dispatch.siteName}
                {dispatch.address ? `, ${dispatch.address}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                Ask for
              </dt>
              <dd className="text-slate-900">
                {dispatch.contact
                  ? `${dispatch.contact.name}${dispatch.contact.phone ? ` — ${dispatch.contact.phone}` : ''}`
                  : 'Nobody recorded.'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Access</dt>
              <dd className="text-slate-900">{dispatch.accessNotes ?? 'Not recorded.'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                Checklist
              </dt>
              <dd className="text-slate-900">
                {dispatch.checklist.length > 0
                  ? `${dispatch.checklist.length} items`
                  : 'None for this kind of work.'}
              </dd>
            </div>
          </dl>

          <div className="mt-4">
            <form action={dispatchJobFormAction.bind(null, job.id)}>
              <button
                type="submit"
                disabled={staffing.technicians.length === 0}
                className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {staffing.technicians.length === 0
                  ? 'Nobody to dispatch to'
                  : job.status === 'DISPATCHED'
                    ? 'Send the details again'
                    : 'Dispatch to the crew'}
              </button>
            </form>
          </div>
        </section>
      ) : null}

      {job.parentJob || job.followUps.length > 0 ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Follow-ups</h2>
          <p className="mt-1 text-sm text-slate-600">
            A job raised from a finding is linked to the job that reported it, so the crane&rsquo;s
            history reads as one chain rather than two unrelated visits.
          </p>
          {job.parentJob ? (
            <p className="mt-3 text-sm text-slate-700">
              Raised from a finding on{' '}
              <Link href={`/jobs/${job.parentJob.id}`} className="underline hover:text-slate-900">
                {job.parentJob.number}
              </Link>
              .
            </p>
          ) : null}
          {job.followUps.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {job.followUps.map((entry) => (
                <li key={entry.id} className="text-slate-700">
                  <Link href={`/jobs/${entry.id}`} className="underline hover:text-slate-900">
                    {entry.number}
                  </Link>{' '}
                  <JobStatusBadge status={entry.status} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Reports</h2>
        {reports.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            No report yet. The technician fills one in per crane on the phone.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {reports.map((report) => (
              <li
                key={report.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2 last:border-0"
              >
                <span>
                  <Link
                    href={`/reports/${report.id}`}
                    className="font-medium text-slate-900 underline"
                  >
                    {report.documentNumber ?? `Report for ${report.craneTag}`}
                  </Link>{' '}
                  <span className="text-slate-500">{REPORT_STATUS_LABELS[report.status]}</span>
                </span>
                <span className="text-slate-600">
                  {report.craneTag} · {formatDateTime(report.submittedAt, settings.timezone)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {can(context.role, 'part.read') ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Delivery orders</h2>
          <p className="mt-1 text-sm text-slate-600">
            Paperwork for the parts issued on this job. Lines come from the stock movements the
            technician recorded, so the delivery and the store ledger are the same rows. Loan kit is
            booked back here.
          </p>

          {deliveries.length > 0 ? (
            <ul className="mt-4 space-y-4">
              {deliveries.map((order) => (
                <li key={order.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-slate-900">{order.number}</span>
                    <span className="text-xs text-slate-600">
                      {DELIVERY_STATUS_LABELS[order.status]}
                      {order.issuedAt
                        ? ` · issued ${formatDateTime(order.issuedAt, settings.timezone)}`
                        : ''}
                      {order.receiverName ? ` · signed by ${order.receiverName}` : ''}
                    </span>
                  </div>

                  {order.deliveryAddress.length > 0 ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Deliver to {order.deliveryAddress.join(', ')}
                    </p>
                  ) : null}

                  <table className="mt-2 w-full text-left text-sm">
                    <thead>
                      <tr className="text-xs text-slate-500">
                        <th className="py-1 font-medium">Part</th>
                        <th className="py-1 font-medium">Ordered</th>
                        <th className="py-1 font-medium">Received</th>
                        <th className="py-1 font-medium">Terms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.lines.map((line) => (
                        <tr key={line.id} className="border-t border-slate-100">
                          <td className="py-1 text-slate-800">
                            {line.description}
                            {line.serialOrBatch ? (
                              <span className="text-slate-500"> · {line.serialOrBatch}</span>
                            ) : null}
                          </td>
                          <td className="py-1 text-slate-800">{line.quantity}</td>
                          <td
                            className={
                              line.receivedQuantity >= line.quantity
                                ? 'py-1 text-slate-800'
                                : 'py-1 text-amber-800'
                            }
                          >
                            {line.receivedQuantity}
                          </td>
                          <td className="py-1 text-slate-800">
                            {line.chargeType === 'LOAN'
                              ? line.outstanding
                                ? `Loan · ${line.returnedQuantity} of ${line.quantity} back`
                                : 'Loan · returned'
                              : line.chargeType === 'WARRANTY'
                                ? 'Warranty'
                                : 'Chargeable'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <a
                    href={`/api/delivery-orders/${order.id}/pdf`}
                    className="mt-2 inline-block text-sm text-slate-600 underline hover:text-slate-900"
                  >
                    Download the delivery order PDF
                  </a>

                  {mayDeliver && order.status !== 'RETURNED' ? (
                    <div className="mt-3 space-y-3">
                      <details>
                        <summary className="cursor-pointer text-sm font-medium text-slate-700">
                          Record who took the parts
                        </summary>
                        <ReceiveDeliveryOrderForm
                          action={receiveDeliveryOrderAction.bind(null, order.id, job.id)}
                          deliveryOrderId={order.id}
                          lines={order.lines}
                        />
                      </details>
                      {order.lines.some((line) => line.chargeType === 'LOAN') ? (
                        <details>
                          <summary className="cursor-pointer text-sm font-medium text-slate-700">
                            Book loan kit back
                          </summary>
                          <ReturnDeliveryOrderForm
                            action={returnDeliveryOrderAction.bind(null, order.id, job.id)}
                            deliveryOrderId={order.id}
                            lines={order.lines}
                          />
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-slate-600">
              None yet. A delivery order is raised from the parts a technician issues.
            </p>
          )}

          {mayDeliver ? (
            <div className="mt-4 border-t border-slate-200 pt-4">
              <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                Raise one from the parts issued
              </h3>
              <div className="mt-2">
                <CreateDeliveryOrderForm
                  action={createDeliveryOrderAction.bind(null, job.id)}
                  parts={deliverableParts.map((part) => ({
                    ...part,
                    issuedAt: part.issuedAt.toISOString(),
                  }))}
                  timezone={settings.timezone}
                />
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

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

      {trail.length > 0 ? (
        <div className="space-y-2">
          <AuditTrailPanel entries={trail} timeZone={settings.timezone} />
          <AuditTrailLink href={`/admin/audit?entity=Job&entityId=${job.id}`} />
        </div>
      ) : null}

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
            completionSchedules={completionSchedules.map((schedule) => ({
              id: schedule.id,
              label: `${schedule.crane.assetTag} — ${SCHEDULE_TYPE_LABELS[schedule.scheduleType]}`,
              dueLabel: dueLabelFor(schedule, settings.timezone),
              overdue: schedule.overdue,
            }))}
          />
        </section>
      ) : null}

      {can(context.role, 'job.bump') &&
      staffing.scheduledStart &&
      !finished &&
      unplaced.length > 0 ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Something more urgent needs this slot</h2>
          <p className="mt-1 mb-5 text-sm text-slate-600">
            Displacing this visit sends it back to Approved with its dates cleared, and records who
            decided, what took the slot and why. The job taking the slot is not placed automatically.
          </p>
          <div className="max-w-md">
            <BumpJobForm
              action={bumpJobAction.bind(null, job.id)}
              candidates={unplaced.slice(0, 50).map((row) => ({
                id: row.id,
                number: row.number,
                priority: row.priority,
                customerName: row.customer.tradingName ?? row.customer.legalName,
              }))}
            />
          </div>
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
