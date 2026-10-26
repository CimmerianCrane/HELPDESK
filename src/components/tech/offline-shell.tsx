'use client'

import { useEffect, useState } from 'react'
import { JobList } from '@/components/tech/job-list'
import { JobSheet } from '@/components/tech/job-sheet'
import { ReportForm } from '@/components/tech/report-form'
import { cachedJobs, cachedTimeZone } from '@/offline/db'

/**
 * The page the service worker falls back to when there is no network and no cached copy.
 *
 * It reads which page was *asked for* from `window.location` rather than from Next's router: the
 * document served is this one, but the URL in the address bar is still `/m/jobs/<id>`, and that is
 * the question worth answering. A technician who taps a job in a message and gets their whole list
 * back has been made to do the work twice.
 *
 * Everything here comes out of Dexie, so it works with the radio off.
 */
export function OfflineShell() {
  const [state, setState] = useState<{
    jobs: Awaited<ReturnType<typeof cachedJobs>>
    timeZone: string
    jobId: string | null
    craneId: string | null
  } | null>(null)

  useEffect(() => {
    const path = window.location.pathname
    const report = /^\/m\/jobs\/([^/]+)\/report\/?$/.exec(path)
    const match = report ?? /^\/m\/jobs\/([^/]+)\/?$/.exec(path)
    void Promise.all([cachedJobs(), cachedTimeZone()]).then(([jobs, timeZone]) => {
      setState({
        jobs,
        timeZone: timeZone ?? 'UTC',
        jobId: match?.[1] ?? null,
        craneId: report
          ? new URLSearchParams(window.location.search).get('crane')
          : null,
      })
    })
  }, [])

  if (!state) {
    return <p className="text-slate-600">Reading what this phone has saved…</p>
  }

  const job = state.jobId ? state.jobs.find((entry) => entry.id === state.jobId) : undefined
  const reportCrane =
    job && state.craneId ? job.cranes.find((crane) => crane.id === state.craneId) : undefined

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p className="font-medium text-amber-900">No signal</p>
        <p className="mt-1 text-sm text-amber-900">
          Showing what was saved on this phone. Anything the office changed since then is not here.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 active:bg-amber-100"
        >
          Try again
        </button>
      </div>

      {job && state.craneId ? (
        reportCrane ? (
          <div className="space-y-5">
            <a
              href={`/m/jobs/${job.id}`}
              className="text-sm font-medium text-blue-700 underline underline-offset-2"
            >
              ← {job.number}
            </a>
            <ReportForm job={job} crane={reportCrane} />
          </div>
        ) : (
          <p className="text-slate-700">That crane is not saved on this phone.</p>
        )
      ) : job ? (
        <JobSheet job={job} timeZone={state.timeZone} />
      ) : state.jobId ? (
        <>
          <p className="text-slate-700">
            That job is not saved on this phone. It may have been assigned after the last sync.
          </p>
          <JobList jobs={state.jobs} timeZone={state.timeZone} />
        </>
      ) : (
        <JobList jobs={state.jobs} timeZone={state.timeZone} />
      )}
    </div>
  )
}
