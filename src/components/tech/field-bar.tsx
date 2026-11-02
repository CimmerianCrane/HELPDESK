'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * The phone's bottom bar. A client component only because the current item needs the pathname —
 * the layout that renders it is a server component, and the bar must not turn the whole field shell
 * client-side just to underline one label.
 *
 * "My jobs" is current on `/m/jobs` and every page under it, so a job sheet still reads as work in
 * the My jobs section rather than as nothing.
 */
export function FieldBar({
  links,
}: {
  links: Array<{ href: string; label: string; badge?: number }>
}) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Field"
      // `field-bar` carries the only rule that hides it — the same `@media` block that pays this
      // bar's height on `main` — so the bar and the space reserved for it can never disagree.
      className="field-bar fixed inset-x-0 bottom-0 border-t border-line bg-field pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-lg md:max-w-4xl">
        {links.map((link) => {
          const current = pathname === link.href || pathname.startsWith(`${link.href}/`)
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={current ? 'page' : undefined}
              className={`flex flex-1 items-center justify-center gap-1.5 border-t-2 py-4 text-center text-sm font-medium text-ink active:bg-raised ${
                current ? 'border-hivis' : 'border-transparent'
              }`}
            >
              {link.label}
              {link.badge ? (
                <span className="rounded bg-hivis px-1.5 text-xs font-semibold text-ink">
                  {link.badge > 99 ? '99+' : link.badge}
                </span>
              ) : null}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
