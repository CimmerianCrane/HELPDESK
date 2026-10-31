import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  AmendReportForm,
  ApproveReportForm,
  ReturnReportForm,
  SubmitAmendmentForm,
} from '@/components/office/report-forms'
import {
  DeclineFindingForm,
  FindingStatusForm,
  FollowUpJobForm,
} from '@/components/office/finding-forms'
import { cardClass } from '@/components/office/ui'
import { formatDate, formatDateTime } from '@/lib/format'
import { dayKey } from '@/lib/time'
import { FINDING_SEVERITY_LABELS, FINDING_STATUS_LABELS } from '@/lib/validation/findings'
import { calibrationWarnings, templateSchema } from '@/lib/templates/schema'
import { requireAuth } from '@/server/auth/context'
import { NotFoundError } from '@/server/auth/errors'
import { can } from '@/server/auth/permissions'
import { describeFinding, findingsForReport } from '@/server/findings/findings'
import { listJobTypes } from '@/server/jobs/jobs'
import { getReport, issuedPdfUrl } from '@/server/reports/approval'
import { REPORT_STATUS_LABELS, SAFE_TO_OPERATE_LABELS } from '@/server/reports/labels'
import { getSettings } from '@/server/settings/settings'
import {
  acknowledgeDeclineAction,
  amendReportAction,
  approveReportAction,
  createFollowUpJobAction,
  returnReportAction,
  submitAmendmentAction,
  updateFindingStatusAction,
} from '../actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  try {
    const report = await getReport(await requireAuth(), id)
    return {
      title: `${report.documentNumber ?? report.job.number} — Cimmerian Crane Services`,
    }
  } catch (error) {
    if (error instanceof NotFoundError) return { title: 'Report — Cimmerian Crane Services' }
    throw error
  }
}

/**
 * One report: what was signed, and what the office may do about it.
 *
 * The answers are rendered from `Report.data` against the template **as stored on this report** — the
 * same function the PDF uses — so what a person reads here is what the document says, including for a
 * report filled in under an older template version.
 */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await requireAuth()

  // The report, the settings and the signed-PDF link do not depend on each other. One round trip to
  // the database's region instead of three in series.
  const [report, settings, downloadUrl] = await Promise.all([
    getReport(context, id).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound()
      throw error
    }),
    getSettings(),
    issuedPdfUrl(context, id),
  ])

  const mayDecide = can(context.role, 'report.approve')
  const mayAmend = can(context.role, 'report.amend')
  // Reading a finding's state and raising a follow-up job are dispatch's; moving it along the flow
  // and recording a decline are the technician/admin half of the same screen.
  const mayHandleFindings = can(context.role, 'finding.followUpJob')
  const mayWriteFindings = can(context.role, 'finding.write')
  const [findings, jobTypes] = await Promise.all([
    mayHandleFindings || mayWriteFindings
      ? findingsForReport(context, report.id)
      : Promise.resolve([]),
    mayHandleFindings ? listJobTypes(context) : Promise.resolve([]),
  ])
  const parsed = templateSchema.safeParse(report.template.schema)
  const data = (report.data ?? {}) as Record<string, unknown>

  const openAmendment = report.amendments.find((entry) => entry.status !== 'AMENDED')
  // The register is not passed: the office reads the dates as recorded and the reviewer decides.
  const calibration = parsed.success ? calibrationWarnings(parsed.data, data) : []

  return (
    <div className="space-y-8">
      <div>
        <Link href="/reports" className="text-sm text-muted underline hover:text-ink">
          ← Reports
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-title font-semibold text-ink">
              {report.documentNumber ?? 'Submitted report'}
            </h1>
            <p className="mt-1 text-muted">
              <Link href={`/jobs/${report.job.id}`} className="underline hover:text-ink">
                {report.job.number}
              </Link>
              {' · '}
              {report.job.jobType.name}
              {' · '}
              <Link href={`/cranes/${report.crane.id}`} className="underline hover:text-ink">
                {report.crane.assetTag}
              </Link>
              {' · '}
              <Link
                href={`/customers/${report.job.customer.id}`}
                className="underline hover:text-ink"
              >
                {report.job.customer.tradingName ?? report.job.customer.legalName}
              </Link>
            </p>
          </div>

          <div className="text-right">
            <p className="rounded border border-line bg-field px-2 py-1 text-sm text-ink">
              {REPORT_STATUS_LABELS[report.status]}
            </p>
            {report.safeToOperate ? (
              <p className="mt-1 text-sm text-muted">
                Safe to operate:{' '}
                {SAFE_TO_OPERATE_LABELS[
                  report.safeToOperate as keyof typeof SAFE_TO_OPERATE_LABELS
                ] ?? report.safeToOperate}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {report.status === 'RETURNED' ? (
        <div role="alert" className="rounded-lg border border-warn/40 bg-warn/10 p-4">
          <h2 className="font-semibold text-warn">Sent back for correction</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-warn">{report.returnReason}</p>
        </div>
      ) : null}

      {report.amendmentOfId ? (
        <div className="rounded-lg border border-line bg-sheet p-4 text-sm text-ink">
          This is an amendment of{' '}
          <Link href={`/reports/${report.amendmentOfId}`} className="underline">
            {report.amendmentOf?.documentNumber ?? 'the original report'}
          </Link>
          . Reason: {report.amendmentReason}
        </div>
      ) : null}

      {report.amendments.length > 0 ? (
        <div className="rounded-lg border border-line bg-sheet p-4 text-sm text-ink">
          Corrected by{' '}
          {report.amendments.map((entry, index) => (
            <span key={entry.id}>
              {index > 0 ? ', ' : ''}
              <Link href={`/reports/${entry.id}`} className="underline">
                {entry.documentNumber ?? REPORT_STATUS_LABELS[entry.status].toLowerCase()}
              </Link>
            </span>
          ))}
          .
        </div>
      ) : null}

      <section className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-ink">The document</h2>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              className="rounded-md border border-line bg-field px-4 py-2 font-medium text-ink hover:bg-raised"
            >
              Download the issued PDF
            </a>
          ) : (
            <p className="text-sm text-muted">
              The PDF is rendered when the report is approved.
            </p>
          )}
        </div>

        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted">Signed by</dt>
            <dd className="text-ink">
              {report.technicianSignerName ?? '—'} ·{' '}
              {formatDateTime(report.technicianSignedAt, settings.timezone)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted">Customer</dt>
            <dd className="text-ink">
              {report.customerDeclinedReason
                ? `Did not sign: ${report.customerDeclinedReason}`
                : `${report.customerSignerName ?? '—'}${report.customerSignerDesignation ? `, ${report.customerSignerDesignation}` : ''} · ${formatDateTime(report.customerSignedAt, settings.timezone)}`}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted">Submitted</dt>
            <dd className="text-ink">{formatDateTime(report.submittedAt, settings.timezone)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted">Approved</dt>
            <dd className="text-ink">{formatDateTime(report.approvedAt, settings.timezone)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted">
              Template version
            </dt>
            <dd className="text-ink">
              {report.template.name} · v{report.templateVersion}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted">
              Emailed to customer
            </dt>
            <dd className="text-ink">
              {formatDateTime(report.emailedToCustomerAt, settings.timezone)}
              {report.approvedAt && !report.emailedToCustomerAt
                ? ' · waiting for the daily retry'
                : ''}
            </dd>
          </div>
        </dl>
      </section>

      {parsed.success ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-ink">What was recorded</h2>
          {/* The same check the phone ran, on the dates as recorded — the reviewer decides what to do. */}
          {calibration.length > 0 ? (
            <div role="alert" className="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-4 text-sm text-warn">
              <p className="font-medium">An instrument was out of calibration on the test date</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {calibration.map((warning) => (
                  <li key={`${warning.instrument}-${warning.message}`}>{warning.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-4 space-y-5">
            {parsed.data.sections.map((section) => {
              const rows =
                section.layout === 'table' && Array.isArray(data[section.key])
                  ? (data[section.key] as Array<Record<string, unknown>>)
                  : null

              return (
                <div key={section.key}>
                  <h3 className="text-xs font-medium text-muted">
                    {section.label}
                  </h3>
                  {rows ? (
                    rows.length === 0 ? (
                      <p className="mt-1 text-sm text-muted">None recorded.</p>
                    ) : (
                      <ul className="mt-1 space-y-2 text-sm">
                        {rows.map((row, index) => (
                          <li key={index} className="rounded border border-line p-2">
                            {section.fields.map((field) => (
                              <p key={field.key} className="text-ink">
                                <span className="text-muted">{field.label}: </span>
                                {display(row[field.key], field.unit)}
                              </p>
                            ))}
                          </li>
                        ))}
                      </ul>
                    )
                  ) : (
                    <dl className="mt-1 grid gap-1 text-sm">
                      {section.fields.map((field) => (
                        <div key={field.key} className="flex gap-2">
                          <dt className="w-56 shrink-0 text-muted">{field.label}</dt>
                          <dd className="text-ink">{display(data[field.key], field.unit)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ) : (
        <p role="alert" className="rounded-md border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
          This report was written against a template that no longer parses. The stored answers are
          below; the issued PDF is the record of what was signed.
        </p>
      )}

      {report.findings.length > 0 ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-ink">Findings</h2>
          <p className="mt-1 text-sm text-muted">
            A defect raised on this report. It stays open until the work is recorded as done or the
            customer declines it in writing — a declined repair keeps their signature with it.
          </p>
          <ul className="mt-4 space-y-4 text-sm">
            {report.findings.map((finding) => {
              const summary = findings.find((row) => row.id === finding.id)
              return (
                <li key={finding.id} className="border-l-2 border-line pl-3">
                  <p className="font-medium text-ink">
                    {finding.component} · {FINDING_SEVERITY_LABELS[finding.severity]}
                    <span className="ml-2 rounded border border-line bg-field px-1.5 py-0.5 text-xs font-normal text-ink">
                      {FINDING_STATUS_LABELS[finding.status]}
                    </span>
                  </p>
                  <p className="text-ink">{finding.description}</p>
                  {finding.recommendation ? (
                    <p className="text-muted">Recommendation: {finding.recommendation}</p>
                  ) : null}

                  {summary?.followUpJob ? (
                    <p className="mt-1 text-muted">
                      Follow-up job:{' '}
                      <Link
                        href={`/jobs/${summary.followUpJob.id}`}
                        className="underline hover:text-ink"
                      >
                        {summary.followUpJob.number}
                      </Link>
                    </p>
                  ) : null}

                  {summary?.declined ? (
                    <div className="mt-2 rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
                      Declined by {summary.declined.name ?? 'the customer'}
                      {summary.declined.at
                        ? ` on ${formatDate(summary.declined.at, settings.timezone)}`
                        : ''}
                      {summary.declined.note ? ` — ${summary.declined.note}` : ''}
                      {summary.declined.signatureUrl ? (
                        <>
                          {' · '}
                          <a href={summary.declined.signatureUrl} className="underline">
                            Their signature
                          </a>
                        </>
                      ) : null}
                    </div>
                  ) : null}

                  {(mayHandleFindings || mayWriteFindings) && summary ? (
                    <div className="mt-2 space-y-2">
                      {mayWriteFindings && summary.open ? (
                        <FindingStatusForm
                          action={updateFindingStatusAction.bind(null, finding.id, report.id)}
                          current={finding.status}
                        />
                      ) : null}

                      {mayHandleFindings && summary.open && !summary.followUpJob ? (
                        <details>
                          <summary className="cursor-pointer text-sm font-medium text-ink underline">
                            Raise a follow-up job
                          </summary>
                          <FollowUpJobForm
                            action={createFollowUpJobAction.bind(null, finding.id, report.id)}
                            jobTypes={jobTypes}
                            suggestedPriority={summary.suggestedPriority}
                            suggestedDescription={describeFinding(summary)}
                            severity={finding.severity}
                          />
                        </details>
                      ) : null}

                      {mayWriteFindings && summary.open && finding.recommendation ? (
                        <details>
                          <summary className="cursor-pointer text-sm font-medium text-ink underline">
                            Customer declined this repair
                          </summary>
                          <DeclineFindingForm
                            action={acknowledgeDeclineAction.bind(null, finding.id, report.id)}
                            findingId={finding.id}
                            today={dayKey(new Date(), settings.timezone)}
                          />
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {mayDecide && report.status === 'SUBMITTED' ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-ink">Decide</h2>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <ApproveReportForm
              action={approveReportAction.bind(null, report.id)}
              isAmendment={Boolean(report.amendmentOfId)}
            />
            <ReturnReportForm action={returnReportAction.bind(null, report.id)} />
          </div>
        </section>
      ) : null}

      {mayAmend && report.status === 'APPROVED' && !openAmendment ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-ink">Correct this report</h2>
          <p className="mt-1 mb-5 text-sm text-muted">
            An issued report is never edited. A correction is a new report that copies these answers,
            links back here with your reason, and gets its own number when it is approved.
          </p>
          <div className="max-w-lg">
            <AmendReportForm action={amendReportAction.bind(null, report.id)} />
          </div>
        </section>
      ) : null}

      {mayAmend && report.status === 'DRAFT' && report.amendmentOfId ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-ink">Submit the amendment</h2>
          <p className="mt-1 mb-5 text-sm text-muted">
            It goes back into the queue for approval, and is issued with its own document number.
          </p>
          <SubmitAmendmentForm action={submitAmendmentAction.bind(null, report.id)} />
        </section>
      ) : null}
    </div>
  )
}

function display(value: unknown, unit?: string): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.length > 0 ? `${value.length} recorded` : '—'
  return unit ? `${String(value)} ${unit}` : String(value)
}

