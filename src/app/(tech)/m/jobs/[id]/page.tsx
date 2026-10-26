import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { JobSheet } from '@/components/tech/job-sheet'
import { requireAuth } from '@/server/auth/context'
import { isAppError } from '@/server/auth/errors'
import { getSettings } from '@/server/settings/settings'
import { technicianJob } from '@/server/tech/my-jobs'

export const metadata: Metadata = { title: 'Job — Cimmerian Crane' }

/**
 * One visit. The dispatch link lands here, which is why the page is a real route rather than a
 * panel on the list: the office sends a URL, and the technician taps it from a message.
 */
export default async function TechJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await requireAuth()

  const settings = await getSettings()
  const job = await technicianJob(context, id).catch((error: unknown) => {
    // "Not found" and "not yours" are the same answer, deliberately — see the service.
    if (isAppError(error) && error.status === 404) notFound()
    throw error
  })

  return (
    <div className="space-y-5">
      <Link href="/m/jobs" className="text-sm font-medium text-blue-700 underline underline-offset-2">
        ← My jobs
      </Link>
      <JobSheet job={job} timeZone={settings.timezone} />
    </div>
  )
}
