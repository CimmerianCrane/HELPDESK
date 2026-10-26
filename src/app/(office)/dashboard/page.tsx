import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { formatDateTime } from '@/lib/format'
import { errorMessage } from '@/lib/logger'
import { requireAuth } from '@/server/auth/context'
import { capabilitiesFor } from '@/server/auth/permissions'
import { getSettings } from '@/server/settings/settings'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/server/users/labels'

export const metadata: Metadata = { title: 'Dashboard — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const context = await requireAuth()
  const settings = await getSettings()

  let database: 'up' | 'down' = 'down'
  let detail = ''
  try {
    await db.$queryRaw`SELECT 1`
    database = 'up'
  } catch (error) {
    detail = errorMessage(error)
  }

  const capabilities = capabilitiesFor(context.role)

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">
        {context.name.split(' ')[0] ? `Hello, ${context.name.split(' ')[0]}` : 'Hello'}
      </h1>
      <p className="mt-1 text-slate-600">
        Signed in as <span className="font-medium text-slate-900">{ROLE_LABELS[context.role]}</span>
        . {ROLE_DESCRIPTIONS[context.role]}
      </p>

      <dl className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Database</dt>
          <dd className={database === 'up' ? 'mt-1 font-semibold text-emerald-700' : 'mt-1 font-semibold text-red-700'}>
            {database}
          </dd>
          {detail ? <p className="mt-1 font-mono text-xs text-red-700">{detail}</p> : null}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Timezone</dt>
          <dd className="mt-1 font-semibold text-slate-900">{settings.timezone}</dd>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Now</dt>
          <dd className="mt-1 font-semibold text-slate-900">
            {formatDateTime(new Date(), settings.timezone)}
          </dd>
        </div>
      </dl>

      <section className="mt-10">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
          What this role can do
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Straight from the permission map, so it is always what the server will actually allow — not
          a hand-written description that can drift.
        </p>

        {capabilities.includes('*') ? (
          <p className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
            Everything.
          </p>
        ) : capabilities.length === 0 ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Nothing yet. The customer portal is not built.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {capabilities.map((capability) => (
              <li
                key={capability}
                className="rounded border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-700"
              >
                {capability}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
