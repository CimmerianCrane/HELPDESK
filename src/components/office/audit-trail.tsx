import Link from 'next/link'
import { formatDateTime } from '@/lib/format'
import type { AuditLogRow } from '@/server/audit/audit'

/**
 * "Who changed what" for one record (brief §11, §12.9).
 *
 * The before/after column is rendered generically, because the audit log is generic: the reader wants
 * to see what moved, and a hand-written panel per entity would be a third place the field names are
 * spelled out. Values print as JSON rather than through a formatter, so a nested change is visible
 * rather than flattened into "[object Object]".
 *
 * Only rendered for a caller holding `audit.read` — the caller checks before loading, and the service
 * refuses regardless.
 */
export function AuditTrailPanel({
  entries,
  timeZone,
  title = 'Who changed what',
  emptyMessage = 'Nothing has been changed since it was created.',
}: {
  entries: AuditLogRow[]
  timeZone: string
  title?: string
  emptyMessage?: string
}) {
  return (
    <section
      aria-labelledby="audit-trail-heading"
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2 id="audit-trail-heading" className="font-semibold text-slate-900">
        {title}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Append-only. Every create, change and deletion, with the values before and after.
      </p>

      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <ol className="mt-4 space-y-3 text-sm">
          {entries.map((entry) => (
            <li key={entry.id} className="border-l-2 border-slate-200 pl-3">
              <p className="font-medium text-slate-900">
                {ACTION_LABELS[entry.action] ?? entry.action} by {entry.user?.name ?? 'the system'}
              </p>
              <p className="text-xs text-slate-500">
                {formatDateTime(entry.createdAt, timeZone)}
                {entry.ip ? ` · ${entry.ip}` : null}
              </p>
              <AuditDiff before={entry.before} after={entry.after} />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

const ACTION_LABELS = { CREATE: 'Created', UPDATE: 'Changed', DELETE: 'Deleted' } as const

function AuditDiff({ before, after }: { before: unknown; after: unknown }) {
  const from = (before ?? {}) as Record<string, unknown>
  const to = (after ?? {}) as Record<string, unknown>
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])]
  if (keys.length === 0) return null

  return (
    <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
      {keys.map((key) => (
        <li key={key}>
          <span className="font-mono text-slate-500">{key}</span>{' '}
          {before !== null && before !== undefined && key in from ? (
            <>
              <span className="text-red-800 line-through">{display(from[key])}</span>{' '}
              <span className="text-emerald-800">{display(to[key])}</span>
            </>
          ) : (
            <span className="text-emerald-800">{display(to[key])}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function display(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/** The full-trail link shown on a record's panel, for an admin. */
export function AuditTrailLink({ href }: { href: string }) {
  return (
    <Link href={href} className="mt-3 inline-block text-sm text-slate-700 underline">
      See every entry for this record in the audit log
    </Link>
  )
}
