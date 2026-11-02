'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { craneQrValueFromPayload } from '@/lib/cranes/qr'
import { formatDate, formatDateTime } from '@/lib/format'
import { techDb, type CachedJob } from '@/offline/db'
import { JOB_STATUS_LABELS } from '@/server/jobs/labels'
import type { TechJobDetail } from '@/server/tech/my-jobs'
import { QrScanner, detectorSupported } from './qr-scanner'

/**
 * One visit, as it reads on a phone held in one hand at a site gate.
 *
 * Deliberately plain: no tables, no truncation, no icons that need a legend. The order is the order
 * the questions come in — when am I there, where is it, how do I get in, who do I ask for, what is
 * wrong with the machine, what do I have to check.
 *
 * It takes plain data rather than an id so the same component renders a live page and a job read
 * back out of Dexie with no signal. If it queried anything, the offline copy would be a second,
 * subtly different screen.
 */
export function JobSheet({ job, timeZone }: { job: TechJobDetail; timeZone: string }) {
  const router = useRouter()
  const [scanning, setScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState<string | null>(null)

  const handleScan = async (raw: string) => {
    setScanning(false)
    const qrValue = craneQrValueFromPayload(raw)
    if (!qrValue) {
      setScanMessage(`That code is not a crane label: ${raw.slice(0, 40)}`)
      return
    }

    // This job's cranes first — the common case is the machine in front of you. Then whatever the
    // super has cached, so a crane on another visit still resolves with no signal.
    const onJob = job.cranes.find((crane) => crane.qrValue === qrValue)
    if (onJob) {
      if (job.reportTemplate && !job.reports.some((entry) => entry.craneId === onJob.id)) {
        router.push(`/m/jobs/${job.id}/report?crane=${onJob.id}`)
      } else {
        setScanMessage(`${onJob.assetTag} is on this job.`)
      }
      return
    }

    // Then any other visit cached on this tablet, so a crane scanned from the van still lands
    // somewhere useful with no signal. The cranes table is keyed by asset tag, hence the scan of the
    // cached jobs rather than a lookup.
    const jobs = await techDb.jobs.toArray().catch(() => [] as CachedJob[])
    const other = jobs.find((entry) => entry.cranes.some((crane) => crane.qrValue === qrValue))
    if (!other) {
      setScanMessage(
        `No crane on this tablet matches ${qrValue}. It may have been added since the last sync.`,
      )
      return
    }

    const crane = other.cranes.find((entry) => entry.qrValue === qrValue)
    router.push(`/m/jobs/${other.id}`)
    setScanMessage(`${crane?.assetTag ?? qrValue} is on job ${other.number}.`)
  }

  const start = job.scheduledStart ? new Date(job.scheduledStart) : null
  const end = job.scheduledEnd ? new Date(job.scheduledEnd) : null

  const sections = groupChecklist(job.checklist)

  return (
    <article className="space-y-5">
      <header className="space-y-1">
        <p className="text-sm font-medium text-muted">
          {job.number} · {job.jobTypeName}
        </p>
        <h1 className="text-title leading-tight font-semibold text-ink">{job.customerName}</h1>
        <p className="text-ink">{job.siteName}</p>
        <p className="flex flex-wrap items-center gap-2 pt-1 text-sm">
          <span className="rounded-full bg-accent px-2.5 py-0.5 font-medium text-white">
            {JOB_STATUS_LABELS[job.status as keyof typeof JOB_STATUS_LABELS] ?? job.status}
          </span>
          <span className="rounded-full bg-raised px-2.5 py-0.5 font-medium text-ink">
            {job.priority}
          </span>
          {job.isLead && (
            <span className="rounded-full bg-pos/10 px-2.5 py-0.5 font-medium text-pos">
              You are the lead
            </span>
          )}
        </p>
      </header>

      <section aria-labelledby="when" className="rounded-lg bg-panel p-4">
        <h2 id="when" className="text-base font-semibold text-ink">
          When
        </h2>
        <p className="mt-1 text-lg text-ink">
          {start ? formatDateTime(start, timeZone) : 'Not scheduled yet'}
          {end && ` – ${formatDateTime(end, timeZone).slice(-5)}`}
        </p>
        {job.operatingHours && (
          <p className="mt-1 text-sm text-muted">Site hours: {job.operatingHours}</p>
        )}
      </section>

      {job.warnings.length > 0 && (
        <section
          aria-labelledby="before"
          className="rounded-xl border border-neg/40 bg-neg/10 p-4"
        >
          <h2 id="before" className="text-base font-semibold text-neg">
            Before you start
          </h2>
          <ul className="mt-2 space-y-1 text-neg">
            {job.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="where" className="rounded-lg bg-panel p-4">
        <h2 id="where" className="text-base font-semibold text-ink">
          Where
        </h2>
        {job.address ? (
          <p className="mt-1 text-ink">{job.address}</p>
        ) : (
          <p className="mt-1 text-muted">No address recorded.</p>
        )}

        {job.contact ? (
          <div className="mt-3 border-t border-rule pt-3">
            <p className="text-sm text-muted">Ask for</p>
            <p className="text-ink">
              {job.contact.name}
              <span className="text-muted"> · {job.contact.role.toLowerCase().replace(/_/g, ' ')}</span>
            </p>
            {job.contact.phone && (
              // A live number is a button, not a number to retype with gloves on.
              <a
                href={`tel:${job.contact.phone}`}
                className="mt-1 inline-block text-lg font-medium text-info underline"
              >
                {job.contact.phone}
              </a>
            )}
          </div>
        ) : (
          <p className="mt-3 text-muted">No site contact recorded.</p>
        )}

        <dl className="mt-3 space-y-3 border-t border-rule pt-3 text-sm">
          <div>
            <dt className="text-muted">Access</dt>
            <dd className="text-ink">{job.accessNotes ?? 'Nothing recorded.'}</dd>
          </div>
          <div>
            <dt className="text-muted">Induction</dt>
            <dd className="text-ink">{job.inductionRequirements ?? 'Nothing recorded.'}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="what" className="rounded-lg bg-panel p-4">
        <h2 id="what" className="text-base font-semibold text-ink">
          What needs doing
        </h2>
        <p className="mt-1 whitespace-pre-line text-ink">
          {job.description ?? 'No description recorded. Check the cranes below.'}
        </p>
      </section>

      {job.crew.length > 0 && (
        <section aria-labelledby="crew" className="rounded-lg bg-panel p-4">
          <h2 id="crew" className="text-base font-semibold text-ink">
            On this visit
          </h2>
          <ul className="mt-1 space-y-1 text-ink">
            {job.crew.map((person) => (
              <li key={person.name}>
                {person.name}
                {person.isLead && <span className="text-muted"> · lead</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {job.cranes.length > 0 && (
        <section aria-labelledby="cranes" className="rounded-lg bg-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="cranes" className="text-base font-semibold text-ink">
              Cranes
            </h2>
            {detectorSupported() && !scanning && (
              <button
                type="button"
                onClick={() => {
                  setScanMessage(null)
                  setScanning(true)
                }}
                className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink active:bg-raised"
              >
                Scan crane
              </button>
            )}
          </div>
          {scanMessage && (
            <p role="status" className="mt-2 rounded-md bg-raised px-3 py-2 text-sm text-ink">
              {scanMessage}
            </p>
          )}
          <ul className="mt-2 space-y-4">
            {job.cranes.map((crane) => {
              // A bundle cached before slice 8 has neither field; it gets no link rather than an error.
              const report = (job.reports ?? []).find((entry) => entry.craneId === crane.id)
              return (
              <li key={crane.assetTag} className="border-t border-rule pt-3 first:border-0 first:pt-0">
                <p className="font-medium text-ink">{crane.assetTag}</p>
                <p className="text-sm text-muted">
                  {crane.type.replace(/_/g, ' ').toLowerCase()} · SWL {crane.swlKg} kg
                </p>
                {crane.status === 'RESTRICTED' && (
                  <p className="mt-1 rounded-md bg-neg/10 px-2 py-1 text-sm font-medium text-neg">
                    Do Not Operate{crane.restrictedReason ? `: ${crane.restrictedReason}` : ''}
                  </p>
                )}
                {crane.recent.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 text-sm text-muted">
                    {crane.recent.map((entry) => (
                      <li key={`${entry.kind}-${entry.at}`}>
                        {formatDate(new Date(entry.at), timeZone)} — {entry.label}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted">
                    Nothing on record for this machine.
                  </p>
                )}
                {job.reportTemplate && crane.id && (
                  report ? (
                    <p className="mt-3 rounded-md bg-pos/10 px-3 py-2 text-sm font-medium text-pos">
                      Report {report.status.toLowerCase().replace(/_/g, ' ')}
                      {report.submittedAt && ` · ${formatDate(new Date(report.submittedAt), timeZone)}`}
                    </p>
                  ) : (
                    <Link
                      href={`/m/jobs/${job.id}/report?crane=${crane.id}`}
                      className="mt-3 inline-block rounded-lg bg-accent px-4 py-2 font-medium text-white"
                    >
                      Fill report
                    </Link>
                  )
                )}
              </li>
              )
            })}
          </ul>
        </section>
      )}

      {sections.length > 0 && (
        <section
          aria-labelledby="checklist"
          className="rounded-lg bg-panel p-4"
        >
          <h2 id="checklist" className="text-base font-semibold text-ink">
            Checklist
          </h2>
          <p className="mt-1 text-sm text-muted">
            {job.isServiceReport
              ? 'Grade every component on the report and note what needs replacing.'
              : 'What this job type requires. You fill it in on the report.'}
          </p>
          <div className="mt-3 space-y-4">
            {sections.map((section) => (
              <div key={section.name}>
                <h3 className="text-sm font-medium text-ink">{section.name}</h3>
                <ul className="mt-1 space-y-1">
                  {section.items.map((item) => (
                    <li key={item.code} className="text-ink">
                      {item.label}
                      {item.unit && <span className="text-muted"> ({item.unit})</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {scanning && (
        <QrScanner onScan={(raw) => void handleScan(raw)} onCancel={() => setScanning(false)} />
      )}
    </article>
  )
}

/** Checklist items arrive flat with a section name; a phone wants them grouped and in order. */
function groupChecklist(
  items: TechJobDetail['checklist'],
): Array<{ name: string; items: TechJobDetail['checklist'] }> {
  const bySection = new Map<string, TechJobDetail['checklist']>()
  for (const item of items) {
    const list = bySection.get(item.section) ?? []
    list.push(item)
    bySection.set(item.section, list)
  }
  return [...bySection.entries()].map(([name, list]) => ({ name, items: list }))
}
