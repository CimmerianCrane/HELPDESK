import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { SyncStatus } from '@/components/tech/sync-status'
import { TechSignOut } from '@/components/tech/tech-sign-out'
import { SyncProvider } from '@/offline/use-tech-sync'
import { getAuthContext } from '@/server/auth/context'

/**
 * The technician shell: mobile-first, one column, big tap targets, and the real gate for everything
 * inside it.
 *
 * The gate is the same shape as the office one — `getAuthContext()` reads the user from the database
 * on every request — with one addition. The phone is a technician's screen, so an office login that
 * wanders onto `/m/jobs` is sent to the dashboard rather than shown an empty list it cannot fill.
 * Somebody with `job.read.own` but no technician record would otherwise be scoped to nothing and
 * spend a morning wondering why they have no work.
 *
 * The cached pages are still gated on the way in: the service worker only ever serves documents
 * that were fetched with a session, and signing out clears the data cache (see `TechSignOut`).
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  applicationName: 'Cimmerian Crane',
  manifest: '/m/manifest',
  // iOS ignores the manifest's display mode and needs this instead, or the app opens in Safari.
  appleWebApp: { capable: true, title: 'Cimmerian Crane', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
}

export default async function TechLayout({ children }: { children: ReactNode }) {
  const context = await getAuthContext()
  if (!context) redirect('/login')
  if (!context.technicianId) redirect('/dashboard')

  return (
    <SyncProvider>
      <div className="min-h-screen bg-slate-50">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{context.name}</p>
              <SyncStatus />
            </div>
            <TechSignOut />
          </div>
        </header>

        <main className="mx-auto max-w-lg px-4 pt-4 pb-24">{children}</main>

        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
        >
          <div className="mx-auto flex max-w-lg">
            <Link
              href="/m/jobs"
              className="flex-1 py-4 text-center font-medium text-slate-900 active:bg-slate-100"
            >
              My jobs
            </Link>
          </div>
        </nav>
      </div>
    </SyncProvider>
  )
}
