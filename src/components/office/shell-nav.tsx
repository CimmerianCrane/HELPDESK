'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useSyncExternalStore } from 'react'

export interface NavLink {
  href: string
  label: string
  group: string
  badge?: number
}

const COLLAPSED_KEY = 'cimmerian.nav.collapsed'

/**
 * The rail's width is a remembered desktop preference living outside React, so it is read through
 * `useSyncExternalStore` rather than copied into state in an effect: the server snapshot is `false`,
 * the first client render agrees with it, and the stored value arrives without a cascading render.
 */
const collapsedListeners = new Set<() => void>()

function subscribeCollapsed(onChange: () => void) {
  collapsedListeners.add(onChange)
  return () => {
    collapsedListeners.delete(onChange)
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

/**
 * The office navigation, one instance moved by CSS: a charcoal sidebar on a desktop, an off-canvas
 * sheet on a phone (app-screens.md §12 folds the sidebar away; two copies of the nav would give every
 * link two accessible names and break the tests that count them).
 *
 * Five destinations, not twenty-two (UI-REVIEW §5): the areas are the top level, and only the area
 * you are in shows its own pages below it.
 *
 * Three decisions here, all from the app-screen study:
 * - **Rows are full ink, not grey.** `on-anchor` is 14.6:1 on the rail; the muted grey it used to be
 *   was 7.2:1 and read washed out across five rows. Grey is kept for the meta under a row.
 * - **Admin is a utility, pinned to the bottom.** Settings-shaped destinations sit at the bottom of a
 *   sidebar (study §3.2, five screens), and hoisting one area out closes most of the dead band a
 *   five-row list left above the account.
 * - **The account is the bottom block.** The rail is a rake of destinations with a person at its
 *   foot, so the eye has a base line instead of a void.
 *
 * The active page is Hi-Vis yellow on charcoal — the same read as a barriered edge, and the highest
 * contrast pairing the palette has (9.8:1). It is the one other thing the yellow is spent on. Its
 * area's chip is yellow too, so the rail says where you are as well as what you are on.
 *
 * The rail collapses to 64px of marks (a desktop-only preference, remembered) because a 240px column
 * of five rows over a 900px screen reads as a void. A finder above the list exists because the areas
 * keep 22 pages one click deeper.
 */
export function ShellNav({ links, user }: { links: NavLink[]; user: { name: string; role: string } }) {
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false)

  // The sheet is open only while you are still on the route you opened it on, so following a link
  // closes it — without an effect that would render once more with it still covering the page.
  const [openedOn, setOpenedOn] = useState<string | null>(null)
  const open = openedOn === pathname
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

  // Areas in the order their first link appears in NAV.
  const areas: { area: string; items: NavLink[] }[] = []
  for (const link of links) {
    const entry = areas.find((candidate) => candidate.area === link.group)
    if (entry) entry.items.push(link)
    else areas.push({ area: link.group, items: [link] })
  }
  // Admin is a utility, not a place you work: it goes to the foot of the rail with the account.
  const primary = areas.filter((area) => area.area !== 'Admin')
  const utilities = areas.filter((area) => area.area === 'Admin')

  // `/reports/profitability` must not light up both Reports and Profitability: the longest matching
  // href wins, exactly as a nested route should.
  const currentHref = links
    .filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  const currentArea = areas.find((area) => area.items.some((item) => item.href === currentHref))
  const needle = query.trim().toLowerCase()
  const matches = needle
    ? links.filter(
        (link) =>
          link.label.toLowerCase().includes(needle) ||
          link.group.toLowerCase().includes(needle),
      )
    : []

  const railClass = collapsed ? 'lg:justify-center' : ''
  const labelClass = collapsed ? 'lg:hidden' : ''

  return (
    <>
      {/* On the charcoal band below `lg` (the layout wrapper is relative), clear of the mark. */}
      {open ? null : (
        <button
          type="button"
          aria-expanded={false}
          aria-controls="office-nav"
          onClick={() => setOpen(true)}
          className="absolute top-2.5 left-2 z-50 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-on-anchor hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hivis lg:hidden"
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
      )}

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
        className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-anchor transition-transform duration-200 ease-out lg:static lg:z-auto lg:translate-x-0 ${
          collapsed ? 'w-64 lg:w-16' : 'w-64 lg:w-[240px]'
        } ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="hazard-band h-2 shrink-0 lg:h-3" aria-hidden />

        <div className={`flex items-center gap-2.5 px-3 pt-4 pb-3 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
          <Link
            href="/dashboard"
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

        {/* The finder. Twenty-two pages live one click deeper behind five rows; without it the rail
            is a memory test. Hidden in the rail, where there is no room to type. */}
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
                    <Link
                      href={item.href}
                      aria-current={item.href === currentHref ? 'page' : undefined}
                      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hivis ${
                        item.href === currentHref
                          ? 'bg-hivis font-semibold text-ink'
                          : 'text-on-anchor hover:bg-white/10'
                      }`}
                    >
                      <AreaChip area={item.group} active={item.group === currentArea?.area} />
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                        <span
                          className={`block text-xs ${
                            item.href === currentHref ? 'text-ink/70' : 'text-on-anchor-muted'
                          }`}
                        >
                          {item.group}
                        </span>
                      </span>
                      {item.badge ? <Badge count={item.badge} /> : null}
                    </Link>
                  </li>
                ))
              )}
            </ul>
          ) : (
            <div className="space-y-1 pt-1">
              {primary.map(({ area, items }) => {
                const active = area === currentArea?.area
                // In the rail every area is one mark, including the one you are in: there is no room
                // for its pages, and a chip that opened nothing would read as broken.
                if (!active || collapsed) {
                  return (
                    <AreaRow
                      key={area}
                      area={area}
                      items={items}
                      active={active}
                      railClass={railClass}
                      labelClass={labelClass}
                    />
                  )
                }
                return (
                  <div key={area}>
                    <AreaRow
                      area={area}
                      items={items}
                      active
                      expanded
                      railClass={railClass}
                      labelClass={labelClass}
                    />
                    {/* The pages of the area you are in, under their own left edge. The guide stops
                        at the last row, so the block reads as one tree rather than a new list. */}
                    <ul className="mt-0.5 mb-1 ml-4 space-y-0.5 border-l border-white/15 pl-2">
                      {items.map((item) => (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            aria-current={item.href === currentHref ? 'page' : undefined}
                            className={`flex items-center justify-between gap-2 rounded-md py-1.5 pr-2 pl-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hivis ${
                              item.href === currentHref
                                ? 'bg-hivis font-semibold text-ink'
                                : 'text-on-anchor hover:bg-white/10'
                            }`}
                          >
                            {item.label}
                            {item.badge ? <Badge count={item.badge} /> : null}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </nav>

        {needle ? null : (
          <div className="space-y-1 border-t border-white/10 px-2 pt-2">
            {utilities.map(({ area, items }) => {
              const active = area === currentArea?.area
              return (
                <div key={area}>
                  <AreaRow
                    area={area}
                    items={items}
                    active={active}
                    expanded
                    railClass={railClass}
                    labelClass={labelClass}
                  />
                  {active && !collapsed ? (
                    <ul className="mt-0.5 mb-1 ml-4 space-y-0.5 border-l border-white/15 pl-2">
                      {items.map((item) => (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            aria-current={item.href === currentHref ? 'page' : undefined}
                            className={`flex items-center justify-between gap-2 rounded-md py-1.5 pr-2 pl-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hivis ${
                              item.href === currentHref
                                ? 'bg-hivis font-semibold text-ink'
                                : 'text-on-anchor hover:bg-white/10'
                            }`}
                          >
                            {item.label}
                            {item.badge ? <Badge count={item.badge} /> : null}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )
            })}
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Show labels' : 'Hide labels'}
              className={`hidden w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-on-anchor-muted hover:bg-white/10 hover:text-on-anchor focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hivis lg:flex ${railClass}`}
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
              <span className={labelClass}>
                {collapsed ? 'Show labels' : 'Hide labels'}
              </span>
            </button>
          </div>
        )}

        {/* Who you are, pinned to the foot. The sheet is the only place an account lives on a phone
            (the band shows it from `sm` up); on the desktop rail it closes the rake. The sign-out
            itself stays in the band at every width, so no screen offers two controls with one name. */}
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
          <span className={`min-w-0 ${labelClass}`}>
            <span className="block truncate text-sm leading-tight text-on-anchor">{user.name}</span>
            <span className="block truncate text-xs leading-tight text-on-anchor-muted">
              {user.role}
            </span>
          </span>
        </div>
      </aside>
    </>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

/** The initial of an area on a chip: fixed, so a label is never the only way to read a row. */
function AreaChip({ area, active }: { area: string; active: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-7 shrink-0 place-items-center rounded-md font-display text-xs font-semibold ${
        active ? 'bg-hivis text-ink' : 'bg-white/10 text-on-anchor'
      }`}
    >
      {area.charAt(0).toUpperCase()}
    </span>
  )
}

/**
 * One area. Collapsed, it is its own way in (the chevron says there are pages inside); the area you
 * are in keeps its chip lit and does not repeat a chevron, because its pages are open below it.
 */
function AreaRow({
  area,
  items,
  active,
  expanded = false,
  railClass,
  labelClass,
}: {
  area: string
  items: NavLink[]
  active: boolean
  expanded?: boolean
  railClass: string
  labelClass: string
}) {
  const waiting = items.some((item) => item.badge)
  return (
    <Link
      href={items[0].href}
      title={area}
      aria-label={area}
      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hivis ${railClass} ${
        active ? 'text-on-anchor' : 'text-on-anchor hover:bg-white/10'
      }`}
    >
      <span className="relative">
        <AreaChip area={area} active={active} />
        {waiting ? (
          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-hivis ring-2 ring-anchor" />
        ) : null}
      </span>
      <span className={`min-w-0 flex-1 truncate ${labelClass}`}>{area}</span>
      {expanded ? null : (
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className={`size-3.5 shrink-0 text-on-anchor-muted ${labelClass}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      )}
    </Link>
  )
}

function Badge({ count }: { count: number }) {
  return (
    <span className="rounded bg-hivis px-1.5 text-xs font-semibold text-ink">
      {count > 99 ? '99+' : count}
    </span>
  )
}
