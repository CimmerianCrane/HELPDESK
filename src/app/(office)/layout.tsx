import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import type { Capability } from '@/server/auth/permissions'
import { getAuthContext } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { ROLE_LABELS } from '@/server/users/labels'
import { signOutAction } from '@/app/actions'

/**
 * The office shell, and the real gate for everything inside it: `getAuthContext()` reads the user
 * from the database, so a deactivated account or a revoked role stops working here on the very next
 * request rather than when a cookie happens to expire.
 *
 * A layout is the gate for pages. Server actions re-check independently — a layout never runs for a
 * background call.
 *
 * shortcut: a layout cannot see the pathname, so a signed-out visitor asking for a deep link is sent
 * to /login and lands on the dashboard afterwards rather than where they were going. Add middleware
 * that appends ?next= when link-sharing makes that annoying (slice 9 emails report links).
 */
export const dynamic = 'force-dynamic'

const NAV: readonly {
  href: string
  label: string
  capability: Capability | null
  match?: string
}[] = [
  { href: '/dashboard', label: 'Dashboard', capability: null },
  { href: '/customers', label: 'Customers', capability: 'customer.read' },
  { href: '/cranes', label: 'Cranes', capability: 'crane.register.read' },
  { href: '/tickets', label: 'Tickets', capability: 'ticket.read' },
  { href: '/jobs', label: 'Jobs', capability: 'job.read.all' },
  { href: '/quotes', label: 'Quotes', capability: 'quote.read' },
  { href: '/invoices', label: 'Invoices', capability: 'invoice.read' },
  { href: '/parts', label: 'Parts', capability: 'part.read' },
  { href: '/reports', label: 'Reports', capability: 'report.approve' },
  { href: '/schedule', label: 'Schedule', capability: 'job.schedule' },
  { href: '/schedules', label: 'Schedules', capability: 'crane.read' },
  { href: '/certificates', label: 'Certificates', capability: 'certificate.read' },
  { href: '/admin/compliance', label: 'Compliance', capability: 'compliancerule.manage' },
  { href: '/admin/users', label: 'Users', capability: 'user.manage' },
  { href: '/admin/audit', label: 'Audit', capability: 'audit.read' },
]

export default async function OfficeLayout({ children }: { children: ReactNode }) {
  const context = await getAuthContext()
  if (!context) redirect('/login')

  const links = NAV.filter((item) => !item.capability || can(context.role, item.capability))

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        {/* Wraps at phone width. Brand, four nav links and Sign out do not fit across 390px, and
            left in one row the nav overlays the sign-out button — which is not a cosmetic problem:
            the button becomes unclickable because the link sits on top of it. On a phone the nav
            drops to its own row (`order-last w-full`) and the rest stays on the first. */}
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:gap-x-6 sm:px-6">
          <Link href="/dashboard" className="shrink-0 font-semibold text-slate-900">
            Cimmerian Crane
          </Link>

          <nav
            aria-label="Main"
            className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto sm:flex-1"
          >
            {links.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="shrink-0 rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {/* Dropped at phone width: brand, nav, name and role on one row leave no slack at 390px,
                and the dashboard repeats the name anyway. */}
            <div className="hidden text-right sm:block">
              <p className="text-sm leading-tight font-medium text-slate-900">{context.name}</p>
              <p className="text-xs leading-tight text-slate-500">{ROLE_LABELS[context.role]}</p>
            </div>
            <form action={signOutAction} className="shrink-0">
              <button
                type="submit"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  )
}
