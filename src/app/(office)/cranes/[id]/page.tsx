import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  AcknowledgeReregistrationButton,
  ArchiveCraneButton,
  CraneForm,
  RestrictCraneButton,
  UnrestrictCraneButton,
} from '@/components/office/crane-forms'
import { cardClass } from '@/components/office/ui'
import { AuditTrailLink, AuditTrailPanel } from '@/components/office/audit-trail'
import { ArchiveScheduleButton, ScheduleForm } from '@/components/office/crane-schedule-forms'
import {
  ArchiveCertificateButton,
  CertificateForm,
} from '@/components/office/certificate-forms'
import { formatDate } from '@/lib/format'
import {
  FINDING_SEVERITY_LABELS,
  FINDING_STATUS_LABELS,
} from '@/lib/validation/findings'
import { findingsForCrane } from '@/server/findings/findings'
import { SCHEDULE_TYPE_LABELS } from '@/lib/validation/schedules'
import { CERTIFICATE_TYPE_LABELS } from '@/lib/validation/certificates'
import { DueBadge } from '@/components/office/job-badges'
import { daysUntil } from '@/server/schedules/recurrence'
import { schedulesForCrane } from '@/server/schedules/schedules'
import { listJobTypes } from '@/server/jobs/jobs'
import { certificatesForCrane, certificateDueLabel } from '@/server/certificates/certificates'
import { requireAuth } from '@/server/auth/context'
import { NotFoundError } from '@/server/auth/errors'
import { can } from '@/server/auth/permissions'
import { auditTrail } from '@/server/audit/audit'
import { getCrane } from '@/server/cranes/cranes'
import { craneReportTimeline } from '@/server/reports/approval'
import { SAFE_TO_OPERATE_LABELS } from '@/server/reports/labels'
import {
  CRANE_STATUS_DESCRIPTIONS,
  CRANE_STATUS_LABELS,
  CRANE_TYPE_LABELS,
} from '@/lib/cranes/labels'
import { getSettings } from '@/server/settings/settings'
import { rulesForCraneType } from '@/server/compliance/rules'
import { listSites } from '@/server/sites/sites'
import {
  acknowledgeReregistrationAction,
  archiveCraneAction,
  restrictCraneAction,
  unrestrictCraneAction,
  updateCraneAction,
} from '../actions'
import {
  archiveScheduleAction,
  createScheduleAction,
  updateScheduleAction,
} from '../../schedules/actions'
import {
  archiveCertificateAction,
  createCertificateAction,
  updateCertificateAction,
} from '../../certificates/actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  try {
    const crane = await getCrane(await requireAuth(), id)
    return { title: `${crane.assetTag} — Cimmerian Crane Services` }
  } catch (error) {
    if (error instanceof NotFoundError) return { title: 'Crane — Cimmerian Crane Services' }
    throw error
  }
}

export default async function CranePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await requireAuth()

  let crane
  try {
    crane = await getCrane(context, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    throw error
  }

  const mayManageSchedules = can(context.role, 'schedule.manage')

  const [sites, settings, timeline, trail, schedules, certificates, rules, jobTypes, openFindings] = await Promise.all([
    listSites(context, { customerId: crane.site.customerId }),
    getSettings(),
    craneReportTimeline(context, crane.id),
    can(context.role, 'audit.read')
      ? auditTrail(context, 'Crane', crane.id, 20)
      : Promise.resolve([]),
    schedulesForCrane(context, crane.id),
    can(context.role, 'certificate.read')
      ? certificatesForCrane(context, crane.id)
      : Promise.resolve([]),
    // The rules a schedule can be based on. Only the ones in force for this kind of crane, and only
    // for someone who can write a schedule — everyone else has no form to put them in.
    mayManageSchedules ? rulesForCraneType(context, crane.type) : Promise.resolve([]),
    // The kind of work a due schedule can raise (slice 15). Only the role with a form to put it in
    // needs the list.
    mayManageSchedules ? listJobTypes(context) : Promise.resolve([]),
    // Findings the report raised and nobody has answered (slice 16). `crane.read` is the capability
    // every office role and every technician holds; the scope filter decides which cranes.
    can(context.role, 'crane.read')
      ? findingsForCrane(context, crane.id, { openOnly: true })
      : Promise.resolve([]),
  ])

  const mayWrite = can(context.role, 'crane.write')
  const mayRestrict = can(context.role, 'crane.restrict')
  const mayWriteCertificates = can(context.role, 'certificate.write')
  const siteOptions = sites.map((row) => ({ id: row.id, name: row.name }))
  const restricted = crane.status === 'RESTRICTED'

  return (
    <div className="space-y-8">
      <div>
        <Link href="/cranes" className="text-sm text-slate-600 underline hover:text-slate-900">
          ← Crane register
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{crane.assetTag}</h1>
            <p className="mt-1 text-slate-600">
              {CRANE_TYPE_LABELS[crane.type]}
              {crane.brand ? ` · ${crane.brand}` : ''}
              {crane.model ? ` ${crane.model}` : ''}
              {' · '}
              <Link href={`/sites/${crane.site.id}`} className="underline">
                {crane.site.name}
              </Link>
              {' · '}
              <Link href={`/customers/${crane.site.customerId}`} className="underline">
                {crane.site.customerName}
              </Link>
            </p>
          </div>

          <div className="text-right">
            <span
              className={
                restricted
                  ? 'rounded border border-red-300 bg-red-50 px-2 py-1 text-sm font-medium text-red-800'
                  : 'rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700'
              }
            >
              {CRANE_STATUS_LABELS[crane.status]}
            </span>
            <p className="mt-1 max-w-xs text-xs text-slate-500">
              {CRANE_STATUS_DESCRIPTIONS[crane.status]}
            </p>
          </div>
        </div>
      </div>

      {restricted ? (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4">
          <h2 className="font-semibold text-red-900">Do not operate</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-red-900">{crane.restrictedReason}</p>
          <p className="mt-2 text-xs text-red-800">
            Restricted {formatDate(crane.restrictedAt, settings.timezone)}.
          </p>
        </div>
      ) : null}

      {crane.reregistrationRequiredAt ? (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">Re-registration may be required</h2>
          <p className="mt-1 text-sm text-amber-900">{crane.reregistrationReason}</p>
          <p className="mt-2 text-xs text-amber-800">
            Flagged {formatDate(crane.reregistrationRequiredAt, settings.timezone)}. Whether the unit
            must be re-registered is the Authorised Examiner&rsquo;s call — this is a prompt, not a
            finding.
          </p>
          {mayWrite ? (
            <div className="mt-3">
              <AcknowledgeReregistrationButton
                action={acknowledgeReregistrationAction.bind(null, crane.id)}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className={`${cardClass} lg:col-span-2`}>
          <h2 className="font-semibold text-slate-900">The crane</h2>

          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Safe working load</dt>
              <dd className="mt-1 text-slate-900">{crane.swlKg.toLocaleString()} kg</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Serial number</dt>
              <dd className="mt-1 text-slate-900">{crane.serialNumber ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Year of manufacture</dt>
              <dd className="mt-1 text-slate-900">{crane.yearOfManufacture ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Hour meter</dt>
              <dd className="mt-1 text-slate-900">
                {crane.hourMeter === null ? '—' : crane.hourMeter.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Statutory registration</dt>
              <dd className="mt-1 text-slate-900">
                {crane.statutoryRegistrationNo ?? '—'}
                {crane.registrationDate
                  ? ` · ${formatDate(crane.registrationDate, settings.timezone)}`
                  : ''}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Owner of record</dt>
              <dd className="mt-1 text-slate-900">{crane.ownerEntity ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Location on site</dt>
              <dd className="mt-1 text-slate-900">{crane.locationOnSite ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Added to register</dt>
              <dd className="mt-1 text-slate-900">{formatDate(crane.createdAt, settings.timezone)}</dd>
            </div>
            {crane.notes ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Notes</dt>
                <dd className="mt-1 whitespace-pre-wrap text-slate-900">{crane.notes}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Label</h2>
          <p className="mt-1 text-sm text-slate-600">
            Every crane has a QR sticker. It points at this record, so a technician can scan the
            machine instead of searching the register.
          </p>
          <p className="mt-3 font-mono text-xs text-slate-500">{crane.qrValue}</p>
          <p className="mt-4">
            <Link href={`/cranes/${crane.id}/label`} className="text-sm font-medium text-slate-900 underline">
              Print the label
            </Link>
          </p>
        </section>
      </div>

      <section className={cardClass} aria-labelledby="schedules-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="schedules-heading" className="font-semibold text-slate-900">
            Schedules
          </h2>
          <Link href="/schedules" className="text-sm text-slate-600 underline">
            All schedules
          </Link>
        </div>

        {schedules.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            Nothing recurs on this crane yet. A schedule records what is due and when — a monthly
            service, an annual examination, a load test.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 text-sm">
            {schedules.map((schedule) => {
              const days = daysUntil(schedule.nextDueDate)
              return (
                <li key={schedule.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                  <div>
                    <p className="font-medium text-slate-900">
                      {SCHEDULE_TYPE_LABELS[schedule.scheduleType]}
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {schedule.intervalMonths ? `every ${schedule.intervalMonths} mo` : 'one-off'}
                        {schedule.ruleReference ? ` · from “${schedule.ruleReference}”` : ''}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Last done {formatDate(schedule.lastDoneDate, settings.timezone)}
                      {' · '}
                      due {formatDate(schedule.nextDueDate, settings.timezone)}
                    </p>
                    {schedule.notes ? (
                      <p className="mt-1 text-xs text-slate-600">{schedule.notes}</p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <DueBadge bucket={schedule.dueBucket} days={days} />
                    {mayManageSchedules ? (
                      <div className="mt-2">
                        <ArchiveScheduleButton
                          action={archiveScheduleAction.bind(
                            null,
                            schedule.id,
                            crane.id,
                          )}
                          label={SCHEDULE_TYPE_LABELS[schedule.scheduleType].toLowerCase()}
                        />
                      </div>
                    ) : null}
                  </div>
                  {mayManageSchedules ? (
                    <details className="w-full">
                      <summary className="cursor-pointer text-sm text-slate-700 underline">
                        Edit this schedule
                      </summary>
                      <div className="mt-3">
                        <ScheduleForm
                          action={updateScheduleAction.bind(null, schedule.id)}
                          value={schedule}
                          rules={rules}
                          jobTypes={jobTypes}
                          submitLabel="Save schedule"
                          idPrefix={`schedule-${schedule.id}`}
                        />
                      </div>
                    </details>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        {mayManageSchedules ? (
          <details className="mt-5 border-t border-slate-100 pt-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-900">
              Add a schedule
            </summary>
            <p className="mt-2 mb-4 text-sm text-slate-600">
              Intervals are configured here, not assumed by the app. A statutory examination is the
              Authorised Examiner&rsquo;s; a company inspection of ours is tracked the same way but is never
              called a certificate.
            </p>
            <ScheduleForm
              action={createScheduleAction}
              crane={{ id: crane.id, assetTag: crane.assetTag, siteName: crane.site.name }}
              rules={rules}
              jobTypes={jobTypes}
              submitLabel="Add schedule"
              idPrefix="crane-schedule"
            />
          </details>
        ) : null}
      </section>

      <section className={cardClass} aria-labelledby="certificates-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="certificates-heading" className="font-semibold text-slate-900">
            Certificates
          </h2>
          <Link href="/certificates" className="text-sm text-slate-600 underline">
            All certificates
          </Link>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Documents issued to this crane by someone else — an Authorised Examiner, a calibration lab.
          Our technicians&rsquo; reports are company inspections and appear in the timeline below; they
          are never certificates.
        </p>

        {certificates.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            Nothing is on file for this crane yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 text-sm">
            {certificates.map((certificate) => {
              const days = daysUntil(certificate.dueDate)
              return (
                <li key={certificate.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900">
                        {CERTIFICATE_TYPE_LABELS[certificate.type]}
                        <span
                          className={
                            certificate.statutory
                              ? 'ml-2 rounded border border-indigo-300 bg-indigo-50 px-1.5 py-0.5 text-xs font-normal text-indigo-800'
                              : 'ml-2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-normal text-slate-600'
                          }
                        >
                          {certificate.statutory ? 'AE statutory certificate' : 'Supporting document'}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {certificate.certificateNumber ?? 'No number'}
                        {certificate.issuer ? ` · ${certificate.issuer}` : ''}
                        {certificate.statedSwlKg !== null
                          ? ` · ${certificate.statedSwlKg.toLocaleString()} kg`
                          : ''}
                      </p>
                      <p className="text-xs text-slate-500">
                        Issued {formatDate(certificate.issueDate, settings.timezone)}
                        {' · '}expires {formatDate(certificate.expiryDate, settings.timezone)}
                        {certificate.nextDueDate
                          ? ` · next due ${formatDate(certificate.nextDueDate, settings.timezone)}`
                          : ''}
                        {certificate.job ? (
                          <>
                            {' · '}
                            <Link href={`/jobs/${certificate.job.id}`} className="underline">
                              {certificate.job.number}
                            </Link>
                          </>
                        ) : null}
                        {certificate.file ? (
                          <>
                            {' · '}
                            <a href={certificate.file.downloadUrl} className="underline">
                              {certificate.file.filename}
                            </a>
                          </>
                        ) : null}
                      </p>
                      {certificate.notes ? (
                        <p className="mt-1 text-xs text-slate-600">{certificate.notes}</p>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <DueBadge bucket={certificate.dueBucket} days={days} />
                      <p className="mt-1 text-xs text-slate-500">{certificateDueLabel(certificate)}</p>
                      {mayWriteCertificates ? (
                        <div className="mt-2">
                          <ArchiveCertificateButton
                            action={archiveCertificateAction.bind(
                              null,
                              certificate.id,
                              crane.id,
                            )}
                            label={CERTIFICATE_TYPE_LABELS[certificate.type].toLowerCase()}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {mayWriteCertificates ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm text-slate-700 underline">
                        Edit this certificate
                      </summary>
                      <div className="mt-3">
                        <CertificateForm
                          action={updateCertificateAction.bind(null, certificate.id)}
                          craneId={crane.id}
                          value={certificate}
                          submitLabel="Save certificate"
                          idPrefix={`certificate-${certificate.id}`}
                        />
                      </div>
                    </details>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        {mayWriteCertificates ? (
          <details className="mt-5 border-t border-slate-100 pt-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-900">
              Add a certificate
            </summary>
            <p className="mt-2 mb-4 text-sm text-slate-600">
              Record what was issued and when it lapses. Nothing here is signed by us: the issuer is
              the Authorised Examiner, lab or firm named on the document.
            </p>
            <CertificateForm
              action={createCertificateAction}
              craneId={crane.id}
              submitLabel="Add certificate"
              idPrefix="crane-certificate"
            />
          </details>
        ) : null}
      </section>

      <section className={cardClass} aria-labelledby="findings-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="findings-heading" className="font-semibold text-slate-900">
            Open findings
          </h2>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Defects our technicians recorded that nobody has answered yet — until the work is done or
          the customer declines it in writing. Closing one happens on the report that raised it.
        </p>
        {openFindings.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">Nothing outstanding on this crane.</p>
        ) : (
          <ul className="mt-4 space-y-3 text-sm">
            {openFindings.map((finding) => (
              <li key={finding.id} className="border-l-2 border-slate-200 pl-3">
                <p className="font-medium text-slate-900">
                  {finding.component} · {FINDING_SEVERITY_LABELS[finding.severity]}
                  <span className="ml-2 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-normal text-slate-700">
                    {FINDING_STATUS_LABELS[finding.status]}
                  </span>
                </p>
                <p className="text-slate-700">{finding.description}</p>
                {finding.recommendation ? (
                  <p className="text-slate-500">Recommendation: {finding.recommendation}</p>
                ) : null}
                <p className="mt-1 text-xs text-slate-500">
                  <Link href={`/reports/${finding.report.id}`} className="underline">
                    {finding.report.docNumber ?? finding.report.jobNumber}
                  </Link>
                  {' · raised '}
                  {formatDate(finding.createdAt, settings.timezone)}
                  {finding.followUpJob
                    ? ' · follow-up job ' + finding.followUpJob.number
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Timeline</h2>
        {timeline.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            Nothing has been reported on this crane yet.
          </p>
        ) : (
          <ol className="mt-4 space-y-3 text-sm">
            {timeline.map((entry) => (
              <li key={entry.id} className="border-l-2 border-slate-200 pl-3">
                <p className="font-medium text-slate-900">
                  {entry.documentNumber ?? 'Report awaiting approval'}
                  {' · '}
                  <Link href={`/reports/${entry.id}`} className="underline">
                    {entry.job.jobType.name}
                  </Link>
                </p>
                <p className="text-xs text-slate-500">
                  {formatDate(entry.approvedAt ?? entry.submittedAt, settings.timezone)}
                  {' · '}
                  <Link href={`/jobs/${entry.job.id}`} className="underline">
                    {entry.job.number}
                  </Link>
                  {entry.safeToOperate
                    ? ` · Safe to operate: ${SAFE_TO_OPERATE_LABELS[entry.safeToOperate as keyof typeof SAFE_TO_OPERATE_LABELS] ?? entry.safeToOperate}`
                    : null}
                  {entry.amendmentOfId ? ' · Amendment' : null}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {trail.length > 0 ? (
        <div className="space-y-2">
          <AuditTrailPanel entries={trail} timeZone={settings.timezone} />
          <AuditTrailLink href={`/admin/audit?entity=Crane&entityId=${crane.id}`} />
        </div>
      ) : null}

      {mayRestrict ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Restriction</h2>
          {restricted ? (
            <div className="mt-3">
              <p className="mb-3 text-sm text-slate-600">
                Clearing the restriction puts the crane back in service. The reason stays in the audit
                log.
              </p>
              <UnrestrictCraneButton action={unrestrictCraneAction.bind(null, crane.id)} />
            </div>
          ) : (
            <div className="mt-3">
              <RestrictCraneButton action={restrictCraneAction.bind(null, crane.id)} />
            </div>
          )}
        </section>
      ) : null}

      {mayWrite ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Edit this crane</h2>
          <p className="mt-1 mb-5 text-sm text-slate-600">
            The QR value never changes — the sticker is already on the machine. The asset tag can be
            corrected.
          </p>
          <CraneForm
            action={updateCraneAction.bind(null, crane.id)}
            value={{ ...crane, registrationDate: crane.registrationDate }}
            sites={siteOptions}
            customerId={crane.site.customerId}
            submitLabel="Save crane"
            idPrefix="edit-crane"
          />
        </section>
      ) : null}

      {mayWrite ? (
        <section className="rounded-lg border border-red-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Archive</h2>
          <div className="mt-3">
            <ArchiveCraneButton
              action={archiveCraneAction.bind(null, crane.id)}
              assetTag={crane.assetTag}
              hasHistory={crane.historyCount > 0}
            />
          </div>
        </section>
      ) : null}
    </div>
  )
}
