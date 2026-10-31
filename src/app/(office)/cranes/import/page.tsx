import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ImportForm } from '@/components/office/import-form'
import { cardClass } from '@/components/office/ui'
import { CRANE_IMPORT_COLUMNS, REQUIRED_CRANE_COLUMNS } from '@/lib/validation/import-cranes'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { listCustomers } from '@/server/customers/customers'
import { MAX_CRANE_IMPORT_ROWS } from '@/server/cranes/import'
import { applyCraneImportAction, previewCraneImportAction } from './actions'

export const metadata: Metadata = { title: 'Import cranes — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

export default async function ImportCranesPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>
}) {
  const context = await requireAuth()
  if (!can(context.role, 'crane.import')) redirect('/cranes')

  const { customerId } = await searchParams
  const customers = await listCustomers(context, {})
  const chosen = customers.find((customer) => customer.id === customerId)

  return (
    <div className="space-y-8">
      <div>
        <Link href="/cranes" className="text-sm text-muted underline">
          ← Crane register
        </Link>
        <h1 className="mt-2 text-title font-semibold text-ink">Import cranes</h1>
        <p className="mt-1 text-muted">
          Add a register from a spreadsheet. You will see exactly what will happen before anything is
          saved.
        </p>
      </div>

      <section className={cardClass}>
        <h2 className="font-semibold text-ink">Which customer?</h2>
        <p className="mt-1 text-sm text-muted">
          A crane belongs to a customer and stands at one of its sites. The file names the site; the
          site has to exist already.
        </p>

        {/* A GET form: choosing the customer is a page state, so the choice survives a refresh and can
            be bookmarked. */}
        <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-64">
            <label htmlFor="customerId" className="block text-sm font-medium text-ink">
              Customer
            </label>
            <select
              id="customerId"
              name="customerId"
              defaultValue={customerId ?? ''}
              className="mt-1 block w-full rounded-md border border-line bg-field px-3 py-2 text-ink"
            >
              <option value="">Choose…</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.legalName}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-anchor-soft">
            Choose
          </button>
        </form>
      </section>

      <section className={cardClass}>
        <h2 className="font-semibold text-ink">The file</h2>
        <ul className="mt-2 space-y-1 text-sm text-muted">
          <li>One header row, then one crane per row — up to {MAX_CRANE_IMPORT_ROWS} rows per file.</li>
          <li>
            Required columns: <code className="font-mono">{REQUIRED_CRANE_COLUMNS.join(', ')}</code>.
            Optional:{' '}
            {CRANE_IMPORT_COLUMNS.filter((column) => !REQUIRED_CRANE_COLUMNS.includes(column)).join(
              ', ',
            )}
            .
          </li>
          <li>
            <code className="font-mono">siteName</code> must match a site of the chosen customer,
            exactly. Add the site first if it does not exist.
          </li>
          <li>A row whose asset tag is already in the register is skipped, so a re-run is safe.</li>
        </ul>
        <p className="mt-4">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/cranes/import/template" className="text-sm font-medium text-ink underline">
            Download the template
          </a>
        </p>
      </section>

      {chosen ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-ink">Choose a file for {chosen.legalName}</h2>
          <p className="mt-1 mb-5 text-sm text-muted">
            Every crane in the file is added to {chosen.legalName}.
          </p>
          <ImportForm
            previewAction={previewCraneImportAction}
            applyAction={applyCraneImportAction}
            noun="crane"
            nameHeading="Asset tag"
            hiddenFields={{ customerId: chosen.id }}
          />
        </section>
      ) : (
        <p className="text-sm text-muted">Choose a customer above to upload a register.</p>
      )}
    </div>
  )
}
