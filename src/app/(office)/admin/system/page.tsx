import type { Metadata } from 'next'
import { cardClass } from '@/components/office/ui'
import { formatDateTime } from '@/lib/format'
import { errorMessage } from '@/lib/logger'
import { db } from '@/lib/db'
import { requireAuth } from '@/server/auth/context'
import { capabilitiesFor } from '@/server/auth/permissions'
import { getSettings } from '@/server/settings/settings'
import { ROLE_LABELS } from '@/server/users/labels'

export const metadata: Metadata = { title: 'System — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * What the office dashboard used to carry (UI-REVIEW §3.3): database status, timezone, the clock,
 * and every capability the signed-in role holds. Moved here because none of it is a dispatcher's
 * first question, and on the board it read as developer scaffolding.
 *
 * Still straight from the permission map rather than from a copy of it, so it is what the server will
 * actually allow, not what somebody typed into a table.
 */
export default async function SystemPage() {
  const context = await requireAuth()

  const [settings, database] = await Promise.all([
    getSettings(),
    db.$queryRaw`SELECT 1`.then(
      () => ({ up: true as const, detail: '' }),
      (error: unknown) => ({ up: false as const, detail: errorMessage(error) }),
    ),
  ])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-title font-semibold text-ink">System</h1>
        <p className="mt-1 text-muted">
          The running environment, and what your role is allowed to do. Nothing here changes anything.
        </p>
      </div>

      <section className={cardClass}>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Database</dt>
            <dd className={database.up ? 'font-medium text-pos' : 'font-medium text-neg'}>
              {database.up ? 'up' : 'down'}
            </dd>
            {database.detail ? <p className="mt-1 text-xs text-neg">{database.detail}</p> : null}
          </div>
          <div>
            <dt className="text-xs text-muted">Timezone</dt>
            <dd className="font-medium text-ink">{settings.timezone}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Now</dt>
            <dd data-num className="font-medium text-ink">
              {formatDateTime(new Date(), settings.timezone)}
            </dd>
          </div>
        </dl>
      </section>

      <section className={cardClass}>
        <h2 className="font-semibold text-ink">
          Capabilities for {ROLE_LABELS[context.role]}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Straight from the permission map, so this is what the server will actually allow.
        </p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {capabilitiesFor(context.role).map((capability) => (
            <li key={capability} className="rounded bg-field px-2 py-1 text-xs text-muted">
              <code>{capability}</code>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
