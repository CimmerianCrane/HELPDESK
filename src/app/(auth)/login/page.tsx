import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAuthContext } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams

  // Already signed in? Nothing to do here. A customer login has no dashboard, so it lands on the
  // portal instead — the same split the office layout applies.
  const context = await getAuthContext()
  if (context) {
    const home = can(context.role, 'portal.read') ? '/portal' : '/dashboard'
    redirect(next && next.startsWith('/') ? next : home)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="text-sm font-medium tracking-wide text-slate-500 uppercase">
          Cimmerian Crane Services
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Sign in</h1>
        <p className="mt-2 mb-8 text-sm text-slate-600">
          Helpdesk and job management for crane servicing.
        </p>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm next={next ?? '/dashboard'} />
        </div>

        <p className="mt-6 text-xs text-slate-500">
          Trouble signing in? Ask an administrator to reset your password. Accounts lock for 15
          minutes after 10 failed attempts.
        </p>
      </div>
    </main>
  )
}
