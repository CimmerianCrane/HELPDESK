import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { cardClass } from '@/components/office/ui'
import { ImportForm } from '@/components/office/import-form'
import { CUSTOMER_IMPORT_COLUMNS, REQUIRED_IMPORT_COLUMNS } from '@/lib/validation/import'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { MAX_IMPORT_ROWS } from '@/server/customers/import'
import { applyImportAction, previewImportAction } from './actions'

export const metadata: Metadata = { title: 'Import customers — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

export default async function ImportCustomersPage() {
  const context = await requireAuth()
  // A page is not a permission check on its own — the actions re-check — but showing a form nobody
  // can submit is worse than sending them back to the list.
  if (!can(context.role, 'customer.import')) redirect('/customers')

  return (
    <div className="space-y-8">
      <div>
        <Link href="/customers" className="text-sm text-muted underline">
          ← Customers
        </Link>
        <h1 className="mt-2 text-title font-semibold text-ink">Import customers</h1>
        <p className="mt-1 text-muted">
          Add a list of customers from a spreadsheet. You will see exactly what will happen before
          anything is saved.
        </p>
      </div>

      <section className={cardClass}>
        <h2 className="font-semibold text-ink">The file</h2>
        <ul className="mt-2 space-y-1 text-sm text-muted">
          <li>
            One header row, then one customer per row — up to {MAX_IMPORT_ROWS} rows per file.
          </li>
          <li>
            Required column: <code className="font-mono">{REQUIRED_IMPORT_COLUMNS.join(', ')}</code>.
            Optional:{' '}
            {CUSTOMER_IMPORT_COLUMNS.filter(
              (column) => !REQUIRED_IMPORT_COLUMNS.includes(column),
            ).join(', ')}
            .
          </li>
          <li>Column names are not case-sensitive, and “Legal Name” means the same as “legalName”.</li>
          <li>
            A row whose name already exists is skipped, so importing the same file twice is safe.
          </li>
          <li>Addresses and contacts are not imported — add those on each customer afterwards.</li>
        </ul>
        <p className="mt-4">
          {/* A route handler that returns a file, not a page: a plain anchor is what makes the
              browser download it rather than Next client-side navigating to it. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/customers/import/template"
            className="text-sm font-medium text-ink underline"
          >
            Download the template
          </a>
        </p>
      </section>

      <section className={cardClass}>
        <h2 className="mb-5 font-semibold text-ink">Choose a file</h2>
        <ImportForm
          previewAction={previewImportAction}
          applyAction={applyImportAction}
          noun="customer"
          nameHeading="Customer"
        />
      </section>
    </div>
  )
}
