import type { Metadata } from 'next'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { safeNext } from '@/lib/safe-next'
import { getAuthContext } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The first screen anyone sees, so it wears the product's own face: the charcoal chrome with the
 * hazard band across the top, the crane mark, and the sign-in card as the one white sheet on it.
 */
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
    // The same rule the action uses. `next.startsWith('/')` alone accepts `//evil.com`.
    redirect(safeNext(next, home))
  }

  return (
    <main className="flex min-h-screen flex-col bg-anchor">
      <div className="hazard-band h-3 shrink-0" aria-hidden />

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3">
            <Image
              src="/cimmerian-mark.png"
              alt="Cimmerian Crane Services"
              width={52}
              height={52}
              className="size-[52px] rounded-[3px]"
              priority
            />
            <span className="font-display text-[22px] leading-none font-semibold tracking-wide text-on-anchor">
              CIMMERIAN
              <span className="block font-sans text-[10px] font-medium tracking-[0.18em] text-on-anchor-muted">
                CRANE SERVICES
              </span>
            </span>
          </div>

          <h1 className="mt-6 font-display text-title font-semibold text-on-anchor">Sign in</h1>
          <p className="mt-1 mb-6 text-sm text-on-anchor-muted">
            Helpdesk and job management for crane servicing.
          </p>

          <div className="rounded-xl bg-sheet p-6">
            <LoginForm next={next ?? '/dashboard'} />
          </div>

          <p className="mt-6 text-xs text-on-anchor-muted">
            Trouble signing in? Ask an administrator to reset your password. Accounts lock for 15
            minutes after 10 failed attempts.
          </p>
        </div>
      </div>
    </main>
  )
}
