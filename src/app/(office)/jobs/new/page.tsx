import type { Metadata } from 'next'
import Link from 'next/link'
import { CreateJobForm } from '@/components/office/job-forms'
import { cardClass } from '@/components/office/ui'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { listJobFormOptions } from '@/server/jobs/jobs'
import { createJobAction } from '../actions'

export const metadata: Metadata = { title: 'Create a job — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * Raising work that did not come from a phone call: a scheduled service, a follow-up from a report,
 * a job the customer asked for by email weeks ago. A call is still better recorded as a ticket, so
 * it has a response clock and a triage decision attached.
 */
export default async function NewJobPage() {
  const context = await requireAuth()

  if (!can(context.role, 'job.create')) {
    return (
      <div className={`${cardClass} max-w-xl`}>
        <h1 className="font-semibold text-ink">Not available for your role</h1>
        <p className="mt-1 text-sm text-muted">
          A {context.role.toLowerCase()} cannot create jobs. Ask a dispatcher to raise it.
        </p>
        <Link href="/jobs" className="mt-4 inline-block text-sm text-ink underline">
          Back to jobs
        </Link>
      </div>
    )
  }

  const options = await listJobFormOptions(context)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/jobs" className="text-sm text-muted underline hover:text-ink">
          ← Jobs
        </Link>
        <h1 className="mt-2 text-title font-semibold text-ink">Create a job</h1>
        <p className="mt-1 text-muted">
          The job number is allocated on save, and its response and resolution targets are fixed from
          that moment so a later change to the SLA policy cannot rewrite this job&apos;s history.
        </p>
      </div>

      {options.customers.length === 0 ? (
        <div className={cardClass}>
          <p className="font-medium text-ink">No customers to choose from.</p>
          <p className="mt-1 text-sm text-muted">
            Add a customer and at least one site before raising work against them.
          </p>
          <Link href="/customers" className="mt-4 inline-block text-sm text-ink underline">
            Go to customers
          </Link>
        </div>
      ) : options.jobTypes.length === 0 ? (
        <div className={cardClass}>
          <p className="font-medium text-ink">No kinds of work are configured.</p>
          <p className="mt-1 text-sm text-muted">
            Job types come from the seed data. Run <code>npm run seed</code> or add one in Admin.
          </p>
        </div>
      ) : (
        <section className={cardClass}>
          <CreateJobForm action={createJobAction} options={options} />
        </section>
      )}
    </div>
  )
}
