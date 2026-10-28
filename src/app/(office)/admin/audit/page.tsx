import type { Metadata } from 'next'
import Link from 'next/link'
import { AuditTrailPanel } from '@/components/office/audit-trail'
import { cardClass } from '@/components/office/ui'
import { formatDateTime } from '@/lib/format'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import {
  AUDIT_ENTITIES,
  auditEntityLabels,
  searchAuditLog,
  type AuditLogRow,
} from '@/server/audit/audit'
import { getSettings } from '@/server/settings/settings'

export const metadata: Metadata = { title: 'Audit log — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The cross-entity audit viewer (brief §11, §12.9).
 *
 * The office holds `audit.read`; everyone else has no audit trail to see and no business guessing at
 * one. The filter set is deliberately small — entity type, record id, who, and a date range — because
 * the questions asked of an audit log are "what happened to this record" and "what did this person do
 * on Tuesday", and a full-text search over a JSON diff would answer neither better.
 *
 * The entries themselves are rendered by the same panel a record's own page shows. One renderer, so
 * the viewer and the record cannot describe the same change differently.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; entityId?: string; userId?: string; from?: string; to?: string }>
}) {
  const context = await requireAuth()
  if (!can(context.role, 'audit.read')) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <h1 className="font-semibold text-amber-900">The audit log is for administrators</h1>
        <p className="mt-1 text-sm text-amber-900">
          It holds a before-and-after of every business record in the system. You are signed in as a{' '}
          {context.role.toLowerCase()}.
        </p>
      </div>
    )
  }

  // The filters and the timezone do not depend on each other.
  const [params, settings] = await Promise.all([searchParams, getSettings()])

  const { rows, truncated } = await searchAuditLog(
    context,
    {
      entity: params.entity,
      entityId: params.entityId,
      userId: params.userId,
      from: params.from,
      to: params.to,
    },
    settings.timezone,
  )
  // Depends on the rows above: one more round trip, unavoidably.
  const labels = await auditEntityLabels(context, rows)

  const filtered = Boolean(params.entity || params.entityId || params.userId || params.from || params.to)

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/users" className="text-sm text-slate-600 underline hover:text-slate-900">
          ← Administration
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Audit log</h1>
        <p className="mt-1 text-slate-600">
          Every create, change and deletion, newest first. Append-only: nothing here can be edited or
          removed.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label htmlFor="entity" className="block text-sm font-medium text-slate-700">
            Record type
          </label>
          <select
            id="entity"
            name="entity"
            defaultValue={params.entity ?? ''}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          >
            <option value="">Everything</option>
            {AUDIT_ENTITIES.map((entity) => (
              <option key={entity} value={entity}>
                {entity}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="entityId" className="block text-sm font-medium text-slate-700">
            Record id
          </label>
          <input
            id="entityId"
            name="entityId"
            defaultValue={params.entityId ?? ''}
            placeholder="The row's id"
            className="mt-1 block w-64 rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="from" className="block text-sm font-medium text-slate-700">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={params.from ?? ''}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="to" className="block text-sm font-medium text-slate-700">
            to
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={params.to ?? ''}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800"
        >
          Filter
        </button>

        {filtered ? (
          <Link href="/admin/audit" className="text-sm text-slate-600 underline">
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-slate-900">
            {filtered ? 'Nothing matches those filters.' : 'Nothing has been recorded yet.'}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Entries appear here as soon as anything is created, changed or deleted.
          </p>
        </div>
      ) : (
        <AuditRowsTable rows={rows} labels={labels} timezone={settings.timezone} />
      )}

      {truncated ? (
        <p className="text-sm text-slate-600">
          Showing the newest 100 entries. Narrow the filters, or use a record&apos;s own page and its
          id to see its whole trail.
        </p>
      ) : null}
    </div>
  )
}

function AuditRowsTable({
  rows,
  labels,
  timezone,
}: {
  rows: AuditLogRow[]
  labels: Awaited<ReturnType<typeof auditEntityLabels>>
  timezone: string
}) {
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Audit entries</caption>
          <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">When</th>
              <th scope="col" className="px-4 py-3 font-medium">Who</th>
              <th scope="col" className="px-4 py-3 font-medium">What</th>
              <th scope="col" className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const label = labels.get(`${row.entity}:${row.entityId}`)
              return (
                <tr key={row.id} className="align-top">
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {formatDateTime(row.createdAt, timezone)}
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    {row.user?.name ?? 'System'}
                    {row.user ? (
                      <span className="block text-xs text-slate-500">{row.user.email}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs tracking-wide text-slate-500 uppercase">{row.entity}</span>
                    <span className="block text-slate-900">
                      {label?.href ? (
                        <Link href={label.href} className="underline">
                          {label.label}
                        </Link>
                      ) : (
                        (label?.label ?? row.entityId)
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        row.action === 'CREATE'
                          ? 'rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800'
                          : row.action === 'DELETE'
                            ? 'rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-800'
                            : 'rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700'
                      }
                    >
                      {row.action.toLowerCase()}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <AuditTrailPanel entries={rows} timeZone={timezone} title="What changed, entry by entry" />
    </div>
  )
}
