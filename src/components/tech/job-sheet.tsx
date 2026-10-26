import Link from 'next/link'
import { formatDate, formatDateTime } from '@/lib/format'
import { JOB_STATUS_LABELS } from '@/server/jobs/labels'
import type { TechJobDetail } from '@/server/tech/my-jobs'

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
  const start = job.scheduledStart ? new Date(job.scheduledStart) : null
  const end = job.scheduledEnd ? new Date(job.scheduledEnd) : null

  const sections = groupChecklist(job.checklist)

  return (
    <article className="space-y-5">
      <header className="space-y-1">
        <p className="text-sm font-medium text-slate-500">
          {job.number} · {job.jobTypeName}
        </p>
        <h1 className="text-2xl leading-tight font-semibold text-slate-900">{job.customerName}</h1>
        <p className="text-slate-700">{job.siteName}</p>
        <p className="flex flex-wrap items-center gap-2 pt-1 text-sm">
          <span className="rounded-full bg-slate-900 px-2.5 py-0.5 font-medium text-white">
            {JOB_STATUS_LABELS[job.status as keyof typeof JOB_STATUS_LABELS] ?? job.status}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-700">
            {job.priority}
          </span>
          {job.isLead && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-medium text-emerald-900">
              You are the lead
            </span>
          )}
        </p>
      </header>

      <section aria-labelledby="when" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="when" className="text-base font-semibold text-slate-900">
          When
        </h2>
        <p className="mt-1 text-lg text-slate-900">
          {start ? formatDateTime(start, timeZone) : 'Not scheduled yet'}
          {end && ` – ${formatDateTime(end, timeZone).slice(-5)}`}
        </p>
        {job.operatingHours && (
          <p className="mt-1 text-sm text-slate-600">Site hours: {job.operatingHours}</p>
        )}
      </section>

      {job.warnings.length > 0 && (
        <section
          aria-labelledby="before"
          className="rounded-xl border border-red-300 bg-red-50 p-4"
        >
          <h2 id="before" className="text-base font-semibold text-red-900">
            Before you start
          </h2>
          <ul className="mt-2 space-y-1 text-red-900">
            {job.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="where" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="where" className="text-base font-semibold text-slate-900">
          Where
        </h2>
        {job.address ? (
          <p className="mt-1 text-slate-900">{job.address}</p>
        ) : (
          <p className="mt-1 text-slate-600">No address recorded.</p>
        )}

        {job.contact ? (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="text-sm text-slate-500">Ask for</p>
            <p className="text-slate-900">
              {job.contact.name}
              <span className="text-slate-500"> · {job.contact.role.toLowerCase().replace(/_/g, ' ')}</span>
            </p>
            {job.contact.phone && (
              // A live number is a button, not a number to retype with gloves on.
              <a
                href={`tel:${job.contact.phone}`}
                className="mt-1 inline-block text-lg font-medium text-blue-700 underline"
              >
                {job.contact.phone}
              </a>
            )}
          </div>
        ) : (
          <p className="mt-3 text-slate-600">No site contact recorded.</p>
        )}

        <dl className="mt-3 space-y-3 border-t border-slate-100 pt-3 text-sm">
          <div>
            <dt className="text-slate-500">Access</dt>
            <dd className="text-slate-900">{job.accessNotes ?? 'Nothing recorded.'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Induction</dt>
            <dd className="text-slate-900">{job.inductionRequirements ?? 'Nothing recorded.'}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="what" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="what" className="text-base font-semibold text-slate-900">
          What needs doing
        </h2>
        <p className="mt-1 whitespace-pre-line text-slate-900">
          {job.description ?? 'No description recorded. Check the cranes below.'}
        </p>
      </section>

      {job.crew.length > 0 && (
        <section aria-labelledby="crew" className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 id="crew" className="text-base font-semibold text-slate-900">
            On this visit
          </h2>
          <ul className="mt-1 space-y-1 text-slate-900">
            {job.crew.map((person) => (
              <li key={person.name}>
                {person.name}
                {person.isLead && <span className="text-slate-500"> · lead</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {job.cranes.length > 0 && (
        <section aria-labelledby="cranes" className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 id="cranes" className="text-base font-semibold text-slate-900">
            Cranes
          </h2>
          <ul className="mt-2 space-y-4">
            {job.cranes.map((crane) => {
              // A bundle cached before slice 8 has neither field; it gets no link rather than an error.
              const report = (job.reports ?? []).find((entry) => entry.craneId === crane.id)
              return (
              <li key={crane.assetTag} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
                <p className="font-medium text-slate-900">{crane.assetTag}</p>
                <p className="text-sm text-slate-600">
                  {crane.type.replace(/_/g, ' ').toLowerCase()} · SWL {crane.swlKg} kg
                </p>
                {crane.status === 'RESTRICTED' && (
                  <p className="mt-1 rounded-md bg-red-100 px-2 py-1 text-sm font-medium text-red-900">
                    Do Not Operate{crane.restrictedReason ? `: ${crane.restrictedReason}` : ''}
                  </p>
                )}
                {crane.recent.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 text-sm text-slate-600">
                    {crane.recent.map((entry) => (
                      <li key={`${entry.kind}-${entry.at}`}>
                        {formatDate(new Date(entry.at), timeZone)} — {entry.label}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    Nothing on record for this machine.
                  </p>
                )}
                {job.reportTemplate && crane.id && (
                  report ? (
                    <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
                      Report {report.status.toLowerCase().replace(/_/g, ' ')}
                      {report.submittedAt && ` · ${formatDate(new Date(report.submittedAt), timeZone)}`}
                    </p>
                  ) : (
                    <Link
                      href={`/m/jobs/${job.id}/report?crane=${crane.id}`}
                      className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2 font-medium text-white"
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
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <h2 id="checklist" className="text-base font-semibold text-slate-900">
            Checklist
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            What this job type requires. You fill it in on the report.
          </p>
          <div className="mt-3 space-y-4">
            {sections.map((section) => (
              <div key={section.name}>
                <h3 className="text-sm font-medium text-slate-700">{section.name}</h3>
                <ul className="mt-1 space-y-1">
                  {section.items.map((item) => (
                    <li key={item.code} className="text-slate-900">
                      {item.label}
                      {item.unit && <span className="text-slate-500"> ({item.unit})</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
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
