import { db } from '@/lib/db'
import { errorMessage } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const SLICE_0_ITEMS = [
  'Next.js + TypeScript + Tailwind, cross-platform npm scripts',
  'Postgres via Docker Compose, or Supabase via DATABASE_URL / DIRECT_URL',
  'Prisma schema for all four phases',
  'Settings table, document numbering, audit service',
  'Health endpoint, structured logging, error boundaries',
  'Vitest and Playwright harnesses',
]

export default async function HomePage() {
  let database: 'up' | 'down' = 'down'
  let detail = ''

  try {
    await db.$queryRaw`SELECT 1`
    database = 'up'
  } catch (error) {
    detail = errorMessage(error)
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm font-medium tracking-wide text-slate-500 uppercase">
        Cimmerian Crane Services
      </p>
      <h1 className="mt-2 text-3xl font-semibold">Helpdesk &amp; Job Management</h1>

      <p className="mt-6 text-slate-700">
        Database:{' '}
        <span className={database === 'up' ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700'}>
          {database}
        </span>
        {detail ? <span className="mt-2 block font-mono text-xs text-red-700">{detail}</span> : null}
      </p>

      <h2 className="mt-10 text-sm font-semibold tracking-wide text-slate-500 uppercase">
        Slice 0 — foundations
      </h2>
      <ul className="mt-3 space-y-1 text-slate-700">
        {SLICE_0_ITEMS.map((item) => (
          <li key={item}>— {item}</li>
        ))}
      </ul>

      <p className="mt-10 text-sm text-slate-500">
        Next up: slice 1 — authentication, roles and the permission map.
      </p>
    </main>
  )
}
