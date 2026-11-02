import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthContext } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { ChangePasswordForm } from './form'

export const metadata: Metadata = { title: 'Change password — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * Self-service password change.
 *
 * Outside all three shells on purpose: office staff, technicians and customers all need it, and each
 * shell is gated differently. It therefore gates itself — a layout would not run for it, and
 * `getAuthContext()` is the same check the shells use.
 */
export default async function ChangePasswordPage() {
  const context = await getAuthContext()
  if (!context) redirect('/login')

  // Where "back" goes depends on which shell the person came from, so it is decided here rather than
  // trusting a `?from=` that anything could set.
  const back = context.customerId
    ? '/portal'
    : context.technicianId
      ? '/m/jobs'
      : can(context.role, 'dashboard.office')
        ? '/dashboard'
        : '/m/jobs'

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <Link href={back} className="text-sm text-muted underline">
        ← Back
      </Link>

      <h1 className="mt-4 text-title font-semibold text-ink">Change password</h1>
      <p className="mt-1 text-sm text-muted">
        Signed in as {context.name} ({context.email}).
      </p>

      <div className="mt-6 rounded-lg bg-panel p-6">
        <ChangePasswordForm />
      </div>
    </main>
  )
}
