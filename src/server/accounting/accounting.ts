import { csvEscape } from '@/lib/csv'
import { db, type Tx } from '@/lib/db'
import { dayKey } from '@/lib/time'
import { PAYMENT_METHOD_LABELS } from '@/lib/validation/invoices'
import { centsToDecimalString } from '@/lib/validation/money'
import { assertCan } from '@/server/auth/permissions'
import type { AuthContext } from '@/server/auth/types'
import { listInvoices, type InvoiceSummary } from '@/server/invoices/invoices'
import { getSettings } from '@/server/settings/settings'

/**
 * The accounting export (brief §5, §12, §14, slice 21).
 *
 * **It exports what the ledger says, not what today's settings would compute.** The amounts are the
 * ones stored on the invoice and snapshotted when it was issued, so a re-export months later states
 * the GST the customer was charged, not the current rate. This file does no arithmetic of its own:
 * it reads `listInvoices` and formats, which is the same reason the job export calls `listJobs`.
 *
 * **Only billed money is exported.** A draft is still being edited and a void invoice is not a bill;
 * neither belongs in an accounting system. The screen says so above the link.
 *
 * Dates are `YYYY-MM-DD` (`ASSUMPTIONS.md` 130), not the app's `DD/MM/YYYY`: an importer reading
 * `03/04` cannot tell March from April, and the screen's format is for people.
 *
 * The seam for Xero/QuickBooks is `AccountingExporter` — a second driver renders the same two row
 * shapes in whatever the service wants. Nothing above this file knows CSV.
 *
 * Not audited: an export is a read, not a business mutation, and `AuditAction` has no entry for one.
 */

/** The statuses that represent money the business has actually billed. */
const BILLED: ReadonlySet<string> = new Set(['ISSUED', 'PART_PAID', 'PAID'])

export interface InvoiceExportRow {
  number: string
  issueDate: Date | null
  dueDate: Date | null
  customer: string
  status: string
  gstRate: number
  subtotal: number
  gstAmount: number
  total: number
  amountPaid: number
  balance: number
  jobNumber: string | null
  description: string
}

export interface PaymentExportRow {
  invoiceNumber: string
  customer: string
  paidAt: Date
  method: string
  reference: string | null
  amount: number
}

/**
 * How a document becomes the file an accounting system reads. Today `csv`; the Xero/QuickBooks push
 * takes the same rows when it arrives.
 */
export interface AccountingExporter {
  readonly name: string
  invoices(rows: readonly InvoiceExportRow[], currency: string): string
  payments(rows: readonly PaymentExportRow[], currency: string): string
}

const INVOICE_COLUMNS = [
  'Invoice number',
  'Issue date',
  'Due date',
  'Customer',
  'Status',
  'Job',
  'Subtotal (excl GST)',
  'GST',
  'Total (incl GST)',
  'Amount paid',
  'Balance',
  'GST rate (%)',
  'Currency',
  'Description',
] as const

const PAYMENT_COLUMNS = [
  'Payment date',
  'Invoice number',
  'Customer',
  'Method',
  'Reference',
  'Amount',
  'Currency',
] as const

/** Two decimals from the stored Decimal, through cents so no float reaches the file. */
function money(value: number): string {
  return centsToDecimalString(Math.round(value * 100))
}

/** The date as an importer reads it, in the operating timezone the office works in. */
function date(value: Date | null, timeZone: string): string {
  return value ? dayKey(value, timeZone) : ''
}

function row(cells: readonly string[]): string {
  return cells.map(csvEscape).join(',')
}

export function createCsvExporter(timeZone: string): AccountingExporter {
  return {
    name: 'csv',

    invoices(rows, currency) {
      const out = [row(INVOICE_COLUMNS)]
      for (const entry of rows) {
        out.push(
          row([
            entry.number,
            date(entry.issueDate, timeZone),
            date(entry.dueDate, timeZone),
            entry.customer,
            entry.status,
            entry.jobNumber ?? '',
            money(entry.subtotal),
            money(entry.gstAmount),
            money(entry.total),
            money(entry.amountPaid),
            money(entry.balance),
            String(Math.round(entry.gstRate * 10000) / 100),
            currency,
            entry.description,
          ]),
        )
      }
      return out.join('\r\n')
    },

    payments(rows, currency) {
      const out = [row(PAYMENT_COLUMNS)]
      for (const entry of rows) {
        out.push(
          row([
            date(entry.paidAt, timeZone),
            entry.invoiceNumber,
            entry.customer,
            PAYMENT_METHOD_LABELS[entry.method as keyof typeof PAYMENT_METHOD_LABELS] ??
              entry.method,
            entry.reference ?? '',
            money(entry.amount),
            currency,
          ]),
        )
      }
      return out.join('\r\n')
    },
  }
}

// ---------------------------------------------------------------------------
// The rows — pure, so the rounding and the DRAFT/VOID exclusion are unit-tested without a database
// ---------------------------------------------------------------------------

export function invoiceExportRows(invoices: readonly InvoiceSummary[]): InvoiceExportRow[] {
  return invoices
    .filter((invoice) => BILLED.has(invoice.status))
    .map((invoice) => ({
      number: invoice.number,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      customer: invoice.customer.name,
      status: invoice.status,
      gstRate: invoice.gstRate,
      subtotal: invoice.subtotal,
      gstAmount: invoice.gstAmount,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      balance: invoice.balance,
      jobNumber: invoice.job?.number ?? null,
      description: invoice.lines.map((line) => line.description).join('; '),
    }))
}

/** Every payment against a billed invoice, in the order they were recorded. */
export function paymentExportRows(invoices: readonly InvoiceSummary[]): PaymentExportRow[] {
  return invoices
    .filter((invoice) => BILLED.has(invoice.status))
    .flatMap((invoice) =>
      invoice.payments.map((payment) => ({
        invoiceNumber: invoice.number,
        customer: invoice.customer.name,
        paidAt: payment.paidAt,
        method: payment.method,
        reference: payment.reference,
        amount: payment.amount,
      })),
    )
    .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export type AccountingDocument = 'invoices' | 'payments'

export interface AccountingExport {
  filename: string
  csv: string
  rows: number
}

/**
 * One export, behind `invoice.read` — the capability that gates reading a bill at all, so the file
 * cannot reveal money to a role the screens hide from. The filters are the invoice book's own (`q`,
 * `status`) and are read by the same service the screen calls, so a filtered screen and its export
 * describe the same subset; an export that quietly ignored the filter is how the wrong spreadsheet
 * gets emailed.
 */
export async function exportAccounting(
  context: AuthContext,
  raw: unknown = {},
  client: Tx = db,
): Promise<AccountingExport> {
  assertCan(context, 'invoice.read')
  const input = (raw ?? {}) as { what?: string; q?: string; status?: string }
  const what: AccountingDocument = input.what === 'payments' ? 'payments' : 'invoices'

  const settings = await getSettings(client)
  const { invoices } = await listInvoices(
    context,
    { q: input.q ?? '', status: input.status ?? '' },
    client,
  )

  const exporter = createCsvExporter(settings.timezone)
  const invoiceRows = invoiceExportRows(invoices)
  const paymentRows = paymentExportRows(invoices)

  return {
    filename: `${what}-${dayKey(new Date(), settings.timezone)}.csv`,
    csv:
      what === 'payments'
        ? exporter.payments(paymentRows, settings.currency)
        : exporter.invoices(invoiceRows, settings.currency),
    rows: what === 'payments' ? paymentRows.length : invoiceRows.length,
  }
}
