import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ReportForm } from '@/components/tech/report-form'
import { requireAuth } from '@/server/auth/context'
import { isAppError } from '@/server/auth/errors'
import { technicianJob } from '@/server/tech/my-jobs'

export const metadata: Metadata = { title: 'Report — Cimmerian Crane' }

/**
 * The report for one crane on one job.
 *
 * The crane is a query parameter because a report belongs to a machine, not to a visit: a service
 * call with three cranes produces three reports, each signed separately. Everything the form needs
 * is already in the job the phone cached, so this page adds no query of its own.
 */
export default async function TechReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ crane?: string }>
}) {
  const { id } = await params
  const { crane: craneId } = await searchParams
  const context = await requireAuth()

  const job = await technicianJob(context, id).catch((error: unknown) => {
    if (isAppError(error) && error.status === 404) notFound()
    throw error
  })

  const crane = job.cranes.find((entry) => entry.id === craneId)
  if (!crane) notFound()

  return (
    <div className="space-y-5">
      <Link
        href={`/m/jobs/${id}`}
        className="text-sm font-medium text-blue-700 underline underline-offset-2"
      >
        ← {job.number}
      </Link>
      <ReportForm job={job} crane={crane} technicianName={context.name} />
    </div>
  )
}
