import type { Metadata } from 'next'
import Link from 'next/link'
import { getAuthContext } from '@/server/auth/context'
import { ROLE_LABELS } from '@/server/users/labels'

export const metadata: Metadata = { title: 'Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/** Public. The only page outside the sign-in flow that does not require an account. */
export default async function HomePage() {
  const context = await getAuthContext()

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm font-medium tracking-wide text-slate-500 uppercase">
        Cimmerian Crane Services
      </p>
      <h1 className="mt-2 text-3xl font-semibold text-slate-900">Helpdesk &amp; Job Management</h1>
      <p className="mt-4 text-slate-700">
        Servicing, breakdown repairs, inspections, load testing, parts and compliance documents for
        overhead cranes and hoists.
      </p>

      <div className="mt-10">
        {context ? (
          <p className="text-slate-700">
            Signed in as {context.name} ({ROLE_LABELS[context.role]}).{' '}
            <Link href="/dashboard" className="font-medium text-slate-900 underline">
              Go to the dashboard
            </Link>
          </p>
        ) : (
          <Link
            href="/login"
            className="inline-block rounded-md bg-slate-900 px-5 py-2.5 font-medium text-white hover:bg-slate-800"
          >
            Sign in
          </Link>
        )}
      </div>
    </main>
  )
}
