import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { getAuthContext } from '@/server/auth/context'
import { ROLE_LABELS } from '@/server/users/labels'

export const metadata: Metadata = { title: 'Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * Public. The only page outside the sign-in flow that does not require an account.
 *
 * It wears the same chrome as the login screen — charcoal ground, hazard band, the mark — because
 * it is the same first impression. It sits on `bg-anchor`, so every piece of text here takes an
 * `on-anchor` tone; `text-ink` on this ground is 1:1 and renders the page blank.
 */
export default async function HomePage() {
  const context = await getAuthContext()

  return (
    <main className="flex min-h-screen flex-col bg-anchor">
      <div className="hazard-band h-3 shrink-0" aria-hidden />

      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-xl">
          <div className="flex items-center gap-3">
            <Image
              src="/cimmerian-mark.png"
              alt=""
              width={48}
              height={48}
              className="size-12 rounded"
              priority
            />
            <span className="font-display text-lg leading-none font-semibold tracking-wide text-on-anchor">
              CIMMERIAN
              <span className="mt-1 block text-xs font-normal tracking-normal text-on-anchor-muted">
                Crane services
              </span>
            </span>
          </div>

          <h1 className="mt-8 font-display text-[40px] leading-[1.05] font-semibold text-on-anchor">
            Helpdesk &amp; job management
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-on-anchor-muted">
            Servicing, breakdown repairs, inspections, load testing, parts and compliance documents
            for overhead cranes and hoists.
          </p>

          <div className="mt-10">
            {context ? (
              <p className="text-on-anchor-muted">
                Signed in as {context.name} ({ROLE_LABELS[context.role]}).{' '}
                <Link
                  href="/dashboard"
                  className="font-medium text-on-anchor underline underline-offset-4 hover:text-hivis"
                >
                  Go to the dashboard
                </Link>
              </p>
            ) : (
              <Link
                href="/login"
                className="inline-block rounded-md bg-hivis px-6 py-3 font-semibold text-ink hover:bg-hivis/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-anchor"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
