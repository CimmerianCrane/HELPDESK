import type { Metadata, Viewport } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { ShellNav, ShellNavTrigger, type NavLink } from '@/components/shell/shell-nav'
import { AppUpdate } from '@/components/tech/app-update'
import { FieldBar } from '@/components/tech/field-bar'
import { SyncStatus } from '@/components/tech/sync-status'
import { TechSignOut } from '@/components/tech/tech-sign-out'
import { SyncProvider } from '@/offline/use-tech-sync'
import { getAuthContext } from '@/server/auth/context'
import { FIELD_BAR, fieldNavFor } from '@/server/auth/nav'
import { can } from '@/server/auth/permissions'
import { unreadNotificationCount } from '@/server/notifications/inbox'
import { ROLE_LABELS } from '@/server/users/labels'

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
 * Hi-Vis Industrial, at arm's length in sunlight: the charcoal bar with its hazard stripe and the
 * Cimmerian mark is the same chrome as the office, so the phone and the desk read as one product. The bar stays charcoal
 * rather than yellow because a yellow header at full width is a glare patch, and the yellow is worth
 * more on the one action a shift turns on.
 *
 * Navigation is one list for both shells (`server/auth/nav.ts`): a phone gets the bottom bar, and a
 * browser window at desk width gets the same rail the office has. The rail is deliberately absent in
 * the installed app — its links leave `/m/`.
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
  themeColor: '#1f2328',
  width: 'device-width',
  initialScale: 1,
  // Draw under the tablet's system bars but keep the content inside them; each edge adds its own
  // safe-area padding below. Zoom is deliberately left enabled.
  viewportFit: 'cover',
}

export default async function TechLayout({ children }: { children: ReactNode }) {
  const context = await getAuthContext()
  // `/m/login`, not `/login`: inside an installed app a redirect out to the website leaves the app
  // and opens Chrome, which is the one thing an installable field app must not do.
  if (!context) redirect('/m/login')
  if (!context.technicianId) redirect('/dashboard')

  // The same rows the office rail reads, so the field shell can never offer a screen this role
  // cannot open. A technician's list is short by construction — the capability map decides it.
  const links: NavLink[] = fieldNavFor(context.role).map((item) => ({
    href: item.href,
    label: item.label,
    icon: item.icon,
    group: item.group,
  }))
  const unread = can(context.role, 'notification.read')
    ? await unreadNotificationCount(context)
    : 0
  const bar = links
    .filter((link) => (FIELD_BAR as readonly string[]).includes(link.href))
    .map((link) => ({ ...link, badge: link.href === '/inbox' ? unread : undefined }))

  return (
    <SyncProvider>
      <div className="relative min-h-dvh bg-sheet lg:flex">
        {/* The same charcoal rail as the office, but only in a browser tab wide enough for it. In the
            installed app it stays hidden and `FieldBar` stays shown, even in landscape: the rail's
            office links leave `/m/`, and leaving the app for Chrome is the one thing an installed
            field app must not do. Both use the same query so neither wins by cascade order. */}
        <div className="contents max-lg:hidden [@media(display-mode:standalone)]:hidden">
          <ShellNav links={links} user={{ name: context.name, role: ROLE_LABELS[context.role] }} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <AppUpdate />
          <header className="sticky top-0 z-10 bg-anchor">
            {/* The status bar sits over the hazard band in standalone mode, so the band is pushed
                clear of it rather than being hidden by it. */}
            <div className="pt-[env(safe-area-inset-top)]">
              <div className="hazard-band h-2" aria-hidden />
            </div>
            {/* The Menu button is the band's first child below `lg`; it is absent in the installed
                app, where the rail is hidden at every width and the bar is the navigation. */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
              {/* One SyncStatus, never two copies: at `lg` the rail carries the name and role, so the
                  header keeps the sync state alone; below it the state sits under the name. */}
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="max-lg:[@media(display-mode:standalone)]:hidden">
                  <ShellNavTrigger />
                </div>
                <Image
                  src="/cimmerian-mark.png"
                  width={26}
                  height={26}
                  alt=""
                  className="size-[26px] shrink-0 rounded-[3px] lg:hidden"
                  priority
                />
                <div className="min-w-0">
                  <p className="truncate font-display text-lg leading-none font-semibold text-on-anchor lg:hidden">
                    {context.name}
                  </p>
                  <SyncStatus />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {/* The rail carries this at `lg`, but the installed app hides the rail entirely, so
                    the one screen every role shares needs its own way in here. */}
                <Link
                  href="/account/password"
                  className="rounded-md border border-on-anchor-muted/40 px-3 py-1.5 text-sm text-on-anchor active:bg-white/10"
                >
                  Password
                </Link>
                <TechSignOut />
              </div>
            </div>
          </header>

          {/* The bottom padding is paid only where the bar is drawn — below `lg`, and everywhere in
              the installed app — using the same two conditions as `FieldBar` itself (see
              `.field-bottom-pad`), so the page is never left with a band of empty space. */}
          <main className="field-bottom-pad mx-auto w-full max-w-lg px-4 pt-4 md:max-w-4xl md:px-6 lg:max-w-6xl lg:px-8">
            {children}
          </main>
        </div>

        {/* The phone's bar: the three or four things a thumb reaches for, and nothing else. The
            rail above `lg` carries everything the role may open. */}
        <FieldBar links={bar} />
      </div>
    </SyncProvider>
  )
}
