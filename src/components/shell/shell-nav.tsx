'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useSyncExternalStore } from 'react'
import { Icon, type IconName } from './icons'

export interface NavLink {
  href: string
  label: string
  icon: IconName
  group: string
  badge?: number
}

const COLLAPSED_KEY = 'cimmerian.nav.collapsed'

/**
 * Both the rail's width and whether its sheet is open live outside React and are read through
 * `useSyncExternalStore`: the server snapshots are `false`/`null`, the first client render agrees
 * with them, and the stored value arrives without a cascading render.
 *
 * The open flag is stored as *the route it was opened on*, so following a link closes the sheet by
 * inspection — no effect resetting it, and no render with the sheet still covering the page.
 */
const collapsedListeners = new Set<() => void>()
const openListeners = new Set<() => void>()
let openedOn: string | null = null

function subscribeCollapsed(onChange: () => void) {
  collapsedListeners.add(onChange)
  return () => {
    collapsedListeners.delete(onChange)
  }
}

function subscribeOpen(onChange: () => void) {
  openListeners.add(onChange)
  return () => {
    openListeners.delete(onChange)
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    // A blocked storage API is not a reason to lose the nav.
    return false
  }
}

function readOpenedOn(): string | null {
  return openedOn
}

function setOpenedOn(path: string | null) {
  openedOn = path
  for (const listener of openListeners) listener()
}

/**
 * The Menu button, rendered by each shell's own top band so the band pays for it as a normal flex
 * child. It lived inside the rail and floated absolutely over the header, which forced both headers
 * to carry a hardcoded `pl-24` left padding to keep the brand clear of it.
 *
 * Hidden at `lg`, where the rail is a static column. Below that it is the only way into the nav.
 */
export function ShellNavTrigger() {
  const pathname = usePathname()
  const current = useSyncExternalStore(subscribeOpen, readOpenedOn, () => null)
  const open = current === pathname

  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls="office-nav"
      onClick={() => setOpenedOn(open ? null : pathname)}
      className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-on-anchor hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hivis lg:hidden"
    >
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <path d="M2 4.5h12M2 8h12M2 11.5h12" />
      </svg>
      Menu
    </button>
  )
}

/**
 * The one navigation every signed-in surface renders — the office, the field shell at desk width and
 * the office and the field. One component, one list (`server/auth/nav.ts`), so no two surfaces can offer
 * different destinations for the same role.
 *
 * One instance moved by CSS: a charcoal sidebar at `lg`, an off-canvas sheet below it. Two copies
 * would give every link two accessible names.
 *
 * Decisions here, all from the app-screen study and the owner's two reviews:
 * - **Every section is open.** The rail used to show five areas with only the one you were in
 *   expanded, so finding a page in another area was two steps and you could not see what existed
 *   without visiting it. Sections are now labelled headings and all their pages are listed.
 * - **One mark per page.** A chip carrying the area's initial said nothing about the page; a line
 *   icon does, and it is what survives when the rail collapses to 64px.
 * - **Rows are full ink, not grey.** `on-anchor` is 14.6:1 on the rail; the muted grey it used to be
 *   read washed out.
 * - **Admin is a utility, pinned to the foot.** Settings-shaped destinations sit at the bottom of a
 *   sidebar, and hoisting one area out closes the dead band above the account.
 * - **The account is the bottom block**, so the rake has a base line instead of a void.
 *
 * The current page is Hi-Vis yellow on charcoal — the same read as a barriered edge, and the highest
 * contrast pairing the palette has (9.8:1). Its section heading is yellow too, so the rail says
 * where you are as well as what you are on.
 *
 * A finder exists because sections keep the register and admin pages below the fold; the rail also
 * collapses to 64px of marks (a remembered desktop preference).
 *
 * Sign-out deliberately does not live here: every shell already carries it in the top band at every
 * width, and a second control with the same name would be ambiguous to assistive tech and to the
 * tests that click it.
 */
export function ShellNav({
  links,
  user,
}: {
  links: NavLink[]
  user: { name: string; role: string }
}) {
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false)
  const currentOpenOn = useSyncExternalStore(subscribeOpen, readOpenedOn, () => null)
  const open = currentOpenOn === pathname
  const setOpen = (next: boolean) => setOpenedOn(next ? pathname : null)

  function toggleCollapsed() {
    const next = !collapsed
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      // Remembered for this visit only.
    }
    for (const listener of collapsedListeners) listener()
  }

  // Sections in the order their first link appears in the nav list.
  const sections: { name: string; items: NavLink[] }[] = []
  for (const link of links) {
    const entry = sections.find((candidate) => candidate.name === link.group)
    if (entry) entry.items.push(link)
    else sections.push({ name: link.group, items: [link] })
  }
  const primary = sections.filter((section) => section.name !== 'Admin')
  const utilities = sections.filter((section) => section.name === 'Admin')

  // `/reports/profitability` must not light up both Reports and Profitability: the longest matching
  // href wins, exactly as a nested route should.
  const currentHref = links
    .filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  const needle = query.trim().toLowerCase()
  const matches = needle
    ? links.filter(
        (link) =>
          link.label.toLowerCase().includes(needle) || link.group.toLowerCase().includes(needle),
      )
    : []

  const labelClass = collapsed ? 'lg:sr-only' : ''

  return (
    <>
      {/* The sheet's scrim. The open/close control is `ShellNavTrigger` in the shell's own band. */}
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-anchor/60 lg:hidden"
        />
      ) : null}

      <aside
        id="office-nav"
        // At `lg` the rail is a column pinned to the viewport, not a block that grows with the page:
        // with every section open the list is taller than a laptop screen, and a rail that stretched
        // would push the account block off the bottom of the window. `h-dvh` plus the nav's own
        // `overflow-y-auto` keeps the foot where it belongs.
        className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-anchor transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:translate-x-0 lg:self-start ${
          collapsed ? 'w-64 lg:w-16' : 'w-64 lg:w-[248px]'
        } ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="hazard-band h-2 shrink-0 lg:h-3" aria-hidden />

        <div
          className={`flex items-center gap-2.5 px-3 pt-4 pb-3 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}
        >
          {/* The first destination is each audience's own front page: `/dashboard` for the office,
              `/m/jobs` in the field. No second rule to keep in step. */}
          <Link
            href={links[0]?.href ?? '/dashboard'}
            className="flex min-w-0 items-center gap-2.5 rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hivis"
          >
            <Image
              src="/cimmerian-mark.png"
              alt=""
              width={28}
              height={28}
              className="size-7 shrink-0 rounded-[3px]"
              priority
            />
            <span className={`min-w-0 text-on-anchor ${labelClass}`}>
              <span className="block font-display text-[18px] leading-none font-semibold tracking-wide">
                CIMMERIAN
              </span>
              <span className="mt-1 block text-[11px] leading-none text-on-anchor-muted">
                Crane services
              </span>
            </span>
          </Link>

          {/* The sheet's own way out. Named apart from the overlay's "Close menu": this button is in
              the DOM even while the sheet is translated off-screen, so two controls answering to
              "Menu" would make the band's button ambiguous to assistive tech and to the e2e helper. */}
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="ml-auto rounded-md p-1.5 text-on-anchor-muted hover:bg-white/10 hover:text-on-anchor focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hivis lg:hidden"
          >
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
        </div>

        {/* The finder. Every page is listed now, but the register and admin sections sit below the
            fold on a laptop; hidden in the collapsed rail, where there is no room to type. */}
        <div className={`px-2.5 pb-2 ${collapsed ? 'lg:hidden' : ''}`}>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a screen"
            aria-label="Find a screen"
            className="w-full rounded-md border border-white/10 bg-anchor-soft px-2.5 py-1.5 text-sm text-on-anchor placeholder:text-on-anchor-muted focus:border-hivis focus:outline-none"
          />
        </div>

        <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {needle ? (
            <ul className="space-y-0.5 pt-1">
              {matches.length === 0 ? (
                <li className="px-2 py-2 text-sm text-on-anchor-muted">No screen by that name.</li>
              ) : (
                matches.map((item) => (
                  <li key={item.href}>
                    <NavRow
                      item={item}
                      current={item.href === currentHref}
                      collapsed={collapsed}
                      meta={item.group}
                    />
                  </li>
                ))
              )}
            </ul>
          ) : (
            primary.map((section) => (
              <Section
                key={section.name}
                section={section}
                currentHref={currentHref}
                current={section.items.some((item) => item.href === currentHref)}
                collapsed={collapsed}
                labelClass={labelClass}
              />
            ))
          )}
        </nav>

        {utilities.length > 0 ? (
          <div className="border-t border-white/10 px-2 pt-2">
            {utilities.map((section) => (
              <Section
                key={section.name}
                section={section}
                currentHref={currentHref}
                current={section.items.some((item) => item.href === currentHref)}
                collapsed={collapsed}
                labelClass={labelClass}
              />
            ))}
          </div>
        ) : null}

        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Show labels' : 'Hide labels'}
          className={`mx-2 mb-1 hidden items-center gap-2 rounded-md px-2 py-1.5 text-sm text-on-anchor-muted hover:bg-white/10 hover:text-on-anchor focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hivis lg:flex ${
            collapsed ? 'lg:justify-center lg:px-0' : ''
          }`}
        >
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className={`size-4 shrink-0 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <path d="M10 3.5 5.5 8l4.5 4.5" />
          </svg>
          <span className={labelClass}>{collapsed ? 'Show labels' : 'Hide labels'}</span>
        </button>

        {/* Who you are, pinned to the foot, so the rail closes on a person rather than a void. */}
        <div
          className={`mt-auto flex items-center gap-2.5 border-t border-white/10 px-3 py-3 ${
            collapsed ? 'lg:justify-center lg:px-0' : ''
          }`}
        >
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-md bg-anchor-soft font-display text-sm font-semibold text-on-anchor"
          >
            {initials(user.name)}
          </span>
          {/* The account block is also the way to the one screen every role has in common. */}
          <Link href="/account/password" className={`min-w-0 ${labelClass}`}>
            <span className="block truncate text-sm leading-tight text-on-anchor hover:underline">
              {user.name}
            </span>
            <span className="block truncate text-xs leading-tight text-on-anchor-muted">
              Change password
            </span>
          </Link>
        </div>
      </aside>
    </>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

/**
 * One labelled block of the rail. Always open: its pages are the whole point of the section, and a
 * section you have to open is a page you cannot find without visiting it first.
 */
function Section({
  section,
  currentHref,
  current,
  collapsed,
  labelClass,
}: {
  section: { name: string; items: NavLink[] }
  currentHref: string | undefined
  current: boolean
  collapsed: boolean
  labelClass: string
}) {
  return (
    <div className="pt-2 first:pt-1">
      <p
        className={`px-2 pb-1 text-[11px] font-semibold tracking-[0.06em] text-on-anchor-muted ${labelClass}`}
      >
        {section.name}
      </p>
      {/* The collapsed rail keeps a rule where the heading was, so the groups do not run together. */}
      {collapsed ? <div className="mx-2 mb-1 hidden border-t border-white/15 lg:block" /> : null}
      <ul className="space-y-0.5">
        {section.items.map((item) => (
          <li key={item.href}>
            <NavRow
              item={item}
              current={item.href === currentHref}
              collapsed={collapsed}
              sectionCurrent={current}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * One destination. The current page is the Hi-Vis fill with charcoal text — the only place yellow is
 * spent in the rail besides the section heading of the page you are on.
 */
function NavRow({
  item,
  current,
  collapsed,
  sectionCurrent = false,
  meta,
}: {
  item: NavLink
  current: boolean
  collapsed: boolean
  /** The row is in the section the current page belongs to. */
  sectionCurrent?: boolean
  /** Shown under the label in finder results only. */
  meta?: string
}) {
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={current ? 'page' : undefined}
      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hivis ${
        collapsed ? 'lg:justify-center lg:px-0' : ''
      } ${current ? 'bg-hivis font-semibold text-ink' : 'text-on-anchor hover:bg-white/10'}`}
    >
      <Icon
        name={item.icon}
        className={`size-[18px] shrink-0 ${
          current ? 'text-ink' : sectionCurrent ? 'text-hivis' : 'text-on-anchor-muted'
        }`}
      />
      <span className={`min-w-0 flex-1 ${collapsed ? 'lg:sr-only' : ''}`}>
        {item.label}
        {meta ? (
          <span className={`block text-xs ${current ? 'text-ink/70' : 'text-on-anchor-muted'}`}>
            {meta}
          </span>
        ) : null}
      </span>
      {item.badge ? (
        current ? (
          <Badge count={item.badge} tone="ink" />
        ) : (
          <Badge count={item.badge} />
        )
      ) : null}
    </Link>
  )
}

function Badge({ count, tone = 'hivis' }: { count: number; tone?: 'hivis' | 'ink' }) {
  return (
    <span
      className={`rounded px-1.5 text-xs font-semibold ${
        tone === 'hivis' ? 'bg-hivis text-ink' : 'bg-ink text-on-anchor'
      }`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
