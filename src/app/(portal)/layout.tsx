import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { signOutAction } from '@/app/actions'
import { getAuthContext } from '@/server/auth/context'

/**
 * The customer portal shell (slice 31).
 *
 * The gate is the same shape as the office and technician shells — `getAuthContext()` reads the user
 * from the database on every request — with one addition: this is a customer's screen, so a staff
 * login that wanders onto `/portal` is sent to their own dashboard rather than shown a portal that
 * is scoped to nothing it can see.
 *
 * Unlike the office nav, every link here is unconditional because every page is written for one
 * audience. `portal.read` is still asserted by each page's service, which is what actually decides.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Customer portal — Cimmerian Crane Services' }

const NAV = [
  { href: '/portal', label: 'Overview' },
  { href: '/portal/jobs', label: 'Jobs' },
  { href: '/portal/cranes', label: 'Cranes' },
  { href: '/portal/certificates', label: 'Certificates' },
  { href: '/portal/reports', label: 'Reports' },
] as const

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const context = await getAuthContext()
  if (!context) redirect('/login')
  // The customer link, not the capability: Admin holds every capability (`ALL`). Same gate as
  // `requirePortalPage`, which each page runs because a layout redirect does not stop a page.
  if (!context.customerId) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:gap-x-6 sm:px-6">
          <Link href="/portal" className="shrink-0 font-semibold text-slate-900">
            Cimmerian Crane
          </Link>

          <nav
            aria-label="Main"
            className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto sm:flex-1"
          >
            {NAV.map((item) => (
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
            <div className="hidden text-right sm:block">
              <p className="text-sm leading-tight font-medium text-slate-900">{context.name}</p>
              <p className="text-xs leading-tight text-slate-500">Customer</p>
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

      <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
    </div>
  )
}
