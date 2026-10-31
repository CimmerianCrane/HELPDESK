import type { Metadata } from 'next'
import { InstallPrompt } from '@/components/tech/install-prompt'
import { JobList } from '@/components/tech/job-list'
import { requireAuth } from '@/server/auth/context'
import { getSettings } from '@/server/settings/settings'
import { myJobs } from '@/server/tech/my-jobs'

export const metadata: Metadata = { title: 'My jobs — Cimmerian Crane' }

/**
 * Server-rendered on purpose. The list a technician opens at the gate has to be right, and a page
 * that renders from the cache first and corrects itself a second later shows yesterday's work as
 * today's. When there is no network the service worker serves the last copy of this page instead.
 */
export default async function MyJobsPage() {
  const context = await requireAuth()
  const [jobs, settings] = await Promise.all([myJobs(context), getSettings()])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-title font-semibold text-ink">My jobs</h1>
        <p className="text-sm text-muted">
          {jobs.length === 1 ? '1 open job' : `${jobs.length} open jobs`}
        </p>
      </div>
      {/* Only here, never on a report: one screen, one decision. */}
      <InstallPrompt />
      <JobList jobs={jobs} timeZone={settings.timezone} />
    </div>
  )
}
