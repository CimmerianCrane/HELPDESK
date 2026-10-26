import Link from 'next/link'
import { formatDateTime } from '@/lib/format'
import { addDays, dayKey } from '@/lib/time'
import type { TechJobSummary } from '@/server/tech/my-jobs'

/**
 * The technician's work list.
 *
 * Grouped by day rather than sorted by date, because the question is never "what is next" in the
 * abstract — it is "what am I doing today" and "what have I got tomorrow". Undated work sits at the
 * bottom under its own heading: it is real, it is theirs, and hiding it would make the list quietly
 * incomplete.
 */
export function JobList({
  jobs,
  timeZone,
  now = new Date(),
}: {
  jobs: TechJobSummary[]
  timeZone: string
  now?: Date
}) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-lg font-medium text-slate-900">Nothing booked</p>
        <p className="mt-1 text-slate-600">
          You have no open jobs. The office will send work here when it is planned.
        </p>
      </div>
    )
  }

  const today = dayKey(now, timeZone)
  const tomorrow = dayKey(addDays(now, 1), timeZone)

  const groups = new Map<string, TechJobSummary[]>()
  for (const job of jobs) {
    const key = job.scheduledStart ? dayKey(new Date(job.scheduledStart), timeZone) : 'undated'
    const list = groups.get(key) ?? []
    list.push(job)
    groups.set(key, list)
  }

  const ordered = [...groups.entries()].sort(([a], [b]) => {
    if (a === 'undated') return 1
    if (b === 'undated') return -1
    return a.localeCompare(b)
  })

  return (
    <div className="space-y-6">
      {ordered.map(([key, list]) => (
        <section key={key} aria-labelledby={`day-${key}`} className="space-y-3">
          <h2 id={`day-${key}`} className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            {key === 'undated' ? 'Waiting for a date' : dayHeading(key, today, tomorrow, list[0]!, timeZone)}
          </h2>
          <ul className="space-y-3">
            {list.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/m/jobs/${job.id}`}
                  className="block rounded-xl border border-slate-200 bg-white p-4 active:bg-slate-50"
                >
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-slate-900">{job.customerName}</span>
                    <span className="shrink-0 text-sm text-slate-600">
                      {job.scheduledStart
                        ? formatDateTime(new Date(job.scheduledStart), timeZone).slice(-5)
                        : '—'}
                    </span>
                  </p>
                  <p className="text-sm text-slate-600">{job.siteName}</p>
                  <p className="mt-1 text-sm text-slate-700">
                    {job.number} · {job.jobTypeName}
                  </p>
                  <p className="mt-2 flex flex-wrap gap-2 text-xs font-medium">
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-white">
                      {job.status.replace(/_/g, ' ').toLowerCase()}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                      {job.priority}
                    </span>
                    {job.restricted > 0 && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-900">
                        Do not operate
                      </span>
                    )}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function dayHeading(
  key: string,
  today: string,
  tomorrow: string,
  sample: TechJobSummary,
  timeZone: string,
): string {
  if (key === today) return 'Today'
  if (key === tomorrow) return 'Tomorrow'
  const start = sample.scheduledStart ? new Date(sample.scheduledStart) : null
  if (!start) return key
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  }).format(start)
}
