import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { signOutAction } from '@/app/actions'
import { ShellNav, ShellNavTrigger, type NavLink } from '@/components/shell/shell-nav'
import { getAuthContext } from '@/server/auth/context'
import { navFor } from '@/server/auth/nav'
import { ROLE_LABELS } from '@/server/users/labels'

/**
 * The customer portal shell (slice 31) — the same rail as the office and the field, so a customer
 * reads one product rather than a second website. The destinations come from the shared list in
 * `server/auth/nav.ts` filtered by capability, exactly as the office rail's do; the portal used to
 * carry its own hand-written array.
 *
 * The gate is the same shape as the other shells — `getAuthContext()` reads the user from the
 * database on every request — with one addition: this is a customer's screen, so a staff login that
 * wanders onto `/portal` is sent to their own dashboard rather than shown a portal scoped to nothing
 * it can see.
 *
 * `portal.read` is still asserted by each page's service, which is what actually decides.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Customer portal — Cimmerian Crane Services' }

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const context = await getAuthContext()
  if (!context) redirect('/login')
  // The customer link, not the capability: Admin holds every capability (`ALL`). Same gate as
  // `requirePortalPage`, which each page runs because a layout redirect does not stop a page.
  if (!context.customerId) redirect('/dashboard')

  const links: NavLink[] = navFor(context.role).map((item) => ({
    href: item.href,
    label: item.label,
    icon: item.icon,
    group: item.group,
  }))

  return (
    <div className="relative min-h-screen bg-anchor lg:flex">
      <ShellNav links={links} user={{ name: context.name, role: ROLE_LABELS[context.role] }} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="hazard-band h-3 shrink-0" aria-hidden />

        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-anchor px-4 py-3 sm:px-6 lg:px-8">
          <ShellNavTrigger />

          <span className="font-display text-lg leading-none font-semibold text-on-anchor lg:hidden">
            CIMMERIAN
          </span>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm leading-tight font-medium text-on-anchor">{context.name}</p>
              <p className="text-xs leading-tight text-on-anchor-muted">Customer</p>
            </div>
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-md border border-on-anchor-muted/40 px-3 py-1.5 text-sm text-on-anchor hover:border-hivis hover:text-hivis"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        {/* The same framed sheet as the office: the customer's work is content, not chrome, so it
            sits on the off-white sheet inside the charcoal frame. */}
        <main className="flex min-w-0 flex-1 flex-col bg-anchor lg:pt-1 lg:pr-3 lg:pb-3">
          <div className="min-h-0 flex-1 bg-sheet px-4 py-6 sm:px-6 lg:rounded-xl lg:px-8 lg:py-8">
            <div className="mx-auto w-full max-w-4xl">{children}</div>
          </div>
        </main>
      </div>
    </div>
  )
}
