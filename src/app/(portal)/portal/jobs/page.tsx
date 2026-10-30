import type { Metadata } from 'next'
import Link from 'next/link'
import { cardClass } from '@/components/office/ui'
import { formatDate } from '@/lib/format'
import { requirePortalPage } from '../../guard'
import { portalJobs } from '@/server/portal/portal'
import { getSettings } from '@/server/settings/settings'

export const metadata: Metadata = { title: 'Jobs — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The customer's jobs, newest first. Scoped by `jobReadWhere`, which a CUSTOMER login narrows to
 * its own customer — the same filter a technician's list is narrowed by.
 */
export default async function PortalJobsPage() {
  const context = await requirePortalPage()
  const [jobs, settings] = await Promise.all([portalJobs(context), getSettings()])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Jobs</h1>
        <p className="mt-1 text-slate-600">
          {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} on your account.
        </p>
      </div>

      {jobs.length === 0 ? (
        <p className={`${cardClass} text-sm text-slate-600`}>No jobs on this account yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Your jobs</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Job</th>
                <th scope="col" className="px-4 py-3 font-medium">Work</th>
                <th scope="col" className="px-4 py-3 font-medium">Cranes</th>
                <th scope="col" className="px-4 py-3 font-medium">Visit</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/portal/jobs/${job.id}`}
                      className="font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                    >
                      {job.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{job.jobTypeName}</td>
                  <td className="px-4 py-3 text-slate-600">{job.cranes.join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDate(job.visitAt ?? job.raisedAt, settings.timezone)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {job.status.replace(/_/g, ' ').toLowerCase()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
