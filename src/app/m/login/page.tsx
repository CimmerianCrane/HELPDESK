import type { Metadata } from 'next'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { LoginForm } from '@/app/(auth)/login/login-form'
import { getAuthContext } from '@/server/auth/context'

export const metadata: Metadata = { title: 'Sign in — Cimmerian Crane' }
export const dynamic = 'force-dynamic'

/**
 * Sign-in inside the installed app.
 *
 * The website's `/login` is outside the manifest's `/m/` scope, so a session that expires on a
 * tablet redirects there, which opens Chrome and leaves the app. This screen is the same form and
 * the same server action, scoped so it stays in the app window. The login always returns to
 * `/m/jobs` — the deep link is lost, which is the accepted trade (docs/PLAN-TABLET-APP.md).
 *
 * Deliberately outside the `(tech)` route group: its layout sends unauthenticated visitors here, and
 * a login page behind that gate would be a redirect loop.
 */
export default async function TechLoginPage() {
  if (await getAuthContext()) redirect('/m/jobs')

  return (
    <main className="flex min-h-dvh flex-col bg-anchor">
      <div className="pt-[env(safe-area-inset-top)]">
        <div className="hazard-band h-2 shrink-0" aria-hidden />
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3">
            <Image
              src="/cimmerian-mark.png"
              alt="Cimmerian Crane Services"
              width={44}
              height={44}
              className="size-11 rounded-[3px]"
              priority
            />
            <span className="font-display text-[20px] leading-none font-semibold tracking-wide text-on-anchor">
              CIMMERIAN
              <span className="block font-sans text-[10px] font-medium tracking-[0.18em] text-on-anchor-muted">
                FIELD
              </span>
            </span>
          </div>

          <h1 className="mt-6 font-display text-title font-semibold text-on-anchor">Sign in</h1>
          <p className="mt-1 mb-6 text-sm text-on-anchor-muted">
            Your jobs work with or without signal.
          </p>

          <div className="rounded-xl bg-sheet p-6">
            <LoginForm next="/m/jobs" />
          </div>

          <p className="mt-6 text-xs text-on-anchor-muted">
            Trouble signing in? Ask the office to reset your password.
          </p>
        </div>
      </div>
    </main>
  )
}
