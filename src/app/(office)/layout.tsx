import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import type { Capability } from '@/server/auth/permissions'
import { getAuthContext } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { unreadNotificationCount } from '@/server/notifications/inbox'
import { ROLE_LABELS } from '@/server/users/labels'
import { signOutAction } from '@/app/actions'
import { ShellNav, type NavLink } from '@/components/office/shell-nav'

/**
 * The office shell, and the real gate for everything inside it: `getAuthContext()` reads the user
 * from the database, so a deactivated account or a revoked role stops working here on the very next
 * request rather than when a cookie happens to expire.
 *
 * A layout is the gate for pages. Server actions re-check independently — a layout never runs for a
 * background call.
 *
 * Hi-Vis Industrial: the charcoal chrome is the L-frame (sidebar plus top band), and the work sits on
 * an off-white sheet inset from the frame's right and bottom edges, with no elevation. The hazard
 * band across the very top is the product's own device — a barrier edge, not decoration — and it is
 * the only place besides the primary action bar where yellow appears outside the navigation.
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
  group: string
}[] = [
  // Five destinations (UI-REVIEW §5). `group` is the top-level area; only the area you are in shows
  // its pages. Every list is in the order a person scans it, and the first item is where the area
  // opens when it is collapsed.
  { href: '/dashboard', label: 'Dashboard', capability: null, group: 'Today' },
  { href: '/inbox', label: 'Inbox', capability: 'notification.read', group: 'Today' },
  { href: '/tickets', label: 'Tickets', capability: 'ticket.read', group: 'Work' },
  { href: '/jobs', label: 'Jobs', capability: 'job.read.all', group: 'Work' },
  { href: '/schedule', label: 'Schedule', capability: 'job.schedule', group: 'Work' },
  { href: '/reports', label: 'Reports', capability: 'report.approve', group: 'Work' },
  { href: '/quotes', label: 'Quotes', capability: 'quote.read', group: 'Work' },
  { href: '/customers', label: 'Customers', capability: 'customer.read', group: 'Register' },
  { href: '/cranes', label: 'Cranes', capability: 'crane.register.read', group: 'Register' },
  { href: '/schedules', label: 'Schedules', capability: 'crane.read', group: 'Register' },
  { href: '/certificates', label: 'Certificates', capability: 'certificate.read', group: 'Register' },
  { href: '/calibrations', label: 'Calibrations', capability: 'resource.read', group: 'Register' },
  { href: '/parts', label: 'Parts', capability: 'part.read', group: 'Register' },
  { href: '/suppliers', label: 'Suppliers', capability: 'part.read', group: 'Register' },
  { href: '/invoices', label: 'Invoices', capability: 'invoice.read', group: 'Money' },
  { href: '/stock-takes', label: 'Stock takes', capability: 'stock.move', group: 'Money' },
  { href: '/reports/profitability', label: 'Profitability', capability: 'report.financial', group: 'Money' },
  { href: '/reports/utilisation', label: 'Utilisation', capability: 'report.financial', group: 'Money' },
  { href: '/admin/users', label: 'Users', capability: 'user.manage', group: 'Admin' },
  { href: '/admin/compliance', label: 'Compliance', capability: 'compliancerule.manage', group: 'Admin' },
  { href: '/admin/sla', label: 'Service levels', capability: 'sla.manage', group: 'Admin' },
  { href: '/admin/audit', label: 'Audit', capability: 'audit.read', group: 'Admin' },
  { href: '/admin/system', label: 'System', capability: 'user.manage', group: 'Admin' },
]

export default async function OfficeLayout({ children }: { children: ReactNode }) {
  const context = await getAuthContext()
  if (!context) redirect('/login')
  // A customer login belongs in the portal, not in a shell whose nav is empty for it (slice 31).
  if (!can(context.role, 'dashboard.office') && can(context.role, 'portal.read')) redirect('/portal')

  const visible = NAV.filter((item) => !item.capability || can(context.role, item.capability))
  // The badge is the only reason the inbox is not a screen nobody opens. One extra count per office
  // render; the `(userId, readAt)` index makes it a lookup, not a scan.
  const unread = can(context.role, 'notification.read')
    ? await unreadNotificationCount(context)
    : 0

  const links: NavLink[] = visible.map((item) => ({
    href: item.href,
    label: item.label,
    group: item.group,
    badge: item.href === '/inbox' ? unread : undefined,
  }))

  return (
    <div className="relative min-h-screen bg-anchor lg:flex">
      <ShellNav links={links} user={{ name: context.name, role: ROLE_LABELS[context.role] }} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 12px of hazard stripe across the whole window — the one full-bleed yellow on the shell. */}
        <div className="hazard-band h-3 shrink-0" aria-hidden />

        {/* The top band: the spine of the screen, and where the account and the way out live. Below
            `lg` its left end belongs to ShellNav's Menu button, so the band keeps that space clear. */}
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-anchor px-4 py-3 pl-20 sm:px-6 lg:px-8">
          {/* The sidebar carries the name at `lg`. Below that, the band keeps it: the mark alone does
              not tell someone which app this is. */}
          <div className="flex items-center gap-2 lg:hidden">
            <span className="font-display text-lg leading-none font-semibold text-on-anchor">
              CIMMERIAN
            </span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {/* Dropped at phone width: the account is one row above this one's neighbours and the
                dashboard repeats it. At tablet width the band has room for it. */}
            <div className="hidden text-right sm:block">
              <p className="text-sm leading-tight font-medium text-on-anchor">{context.name}</p>
              <p className="text-xs leading-tight text-on-anchor-muted">{ROLE_LABELS[context.role]}</p>
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

        {/* Framed sheet: the work sits on the sheet, inset from the frame's right and bottom edges
            with a soft corner and no elevation (app-screens.md §3.1). Below `lg` there is no frame
            to inset into, so the sheet is the screen. */}
        <main className="flex min-w-0 flex-1 flex-col bg-anchor lg:pt-1 lg:pr-3 lg:pb-3">
          <div className="min-h-0 flex-1 bg-sheet px-4 py-6 sm:px-6 lg:rounded-xl lg:px-8 lg:py-8">
            {/* A helpdesk is read as tables. A 72rem cap centres the sheet and leaves a dead band on
                either side of a wide monitor, so the only limit here is a generous one that keeps a
                paragraph from running the whole width of a 2K screen. */}
            <div className="mx-auto w-full max-w-[1600px]">{children}</div>
          </div>
        </main>
      </div>
    </div>
  )
}
