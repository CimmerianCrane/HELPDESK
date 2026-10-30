import { describe, expect, it } from 'vitest'
import {
  createCsvExporter,
  invoiceExportRows,
  paymentExportRows,
} from '@/server/accounting/accounting'
import type { InvoiceSummary } from '@/server/invoices/invoices'
import { parseCsv } from '@/lib/csv'

/**
 * The accounting export (slice 21).
 *
 * What matters and what the tests pin: only billed money leaves, the amounts are the ones stored on
 * the invoice rather than recomputed, and the file's dates are `YYYY-MM-DD` — an importer reading
 * `DD/MM/YYYY` cannot tell March from April.
 */

const TZ = 'Asia/Singapore'

function invoice(overrides: Partial<InvoiceSummary> = {}): InvoiceSummary {
  return {
    id: 'inv-1',
    number: 'INV-2026-0001',
    status: 'ISSUED',
    // 2026-10-28 09:30 Singapore = 2026-10-28 01:30 UTC; the day key is the office's day.
    issueDate: new Date('2026-10-28T01:30:00Z'),
    dueDate: new Date('2026-11-27T00:00:00Z'),
    overdue: false,
    gstRate: 0.09,
    subtotal: 300,
    gstAmount: 27,
    total: 327,
    amountPaid: 0,
    balance: 327,
    editable: false,
    payable: true,
    externalRef: null,
    externalPushedAt: null,
    createdAt: new Date('2026-10-28T01:00:00Z'),
    customer: { id: 'c1', name: 'Acme Cranes' },
    job: { id: 'j1', number: 'JOB-2026-0007', status: 'INVOICED' },
    lines: [
      { id: 'l1', description: 'Replace hoist brake pads', quantity: 2, unitPrice: 100, lineTotal: 200 },
      { id: 'l2', description: 'Labour', quantity: 1, unitPrice: 100, lineTotal: 100 },
    ],
    payments: [],
    ...overrides,
  }
}

describe('which money is exported', () => {
  it('leaves out drafts and void invoices', () => {
    const rows = invoiceExportRows([
      invoice({ number: 'INV-A', status: 'DRAFT' }),
      invoice({ number: 'INV-B', status: 'VOID' }),
      invoice({ number: 'INV-C', status: 'ISSUED' }),
      invoice({ number: 'INV-D', status: 'PART_PAID' }),
      invoice({ number: 'INV-E', status: 'PAID' }),
    ])

    expect(rows.map((row) => row.number)).toEqual(['INV-C', 'INV-D', 'INV-E'])
  })

  it('describes the charges in one cell, so the importer still has a readable line', () => {
    const [row] = invoiceExportRows([invoice()])
    expect(row?.description).toBe('Replace hoist brake pads; Labour')
    expect(row?.jobNumber).toBe('JOB-2026-0007')
  })
})

describe('the CSV file', () => {
  const exporter = createCsvExporter(TZ)

  it('writes an importer-readable header and one row per invoice, in cents-exact amounts', () => {
    const csv = exporter.invoices(
      invoiceExportRows([invoice({ total: 327.5, gstAmount: 27.5, balance: 327.5 })]),
      'SGD',
    )
    const table = parseCsv(csv)

    expect(table.headers.slice(0, 3)).toEqual(['Invoice number', 'Issue date', 'Due date'])
    expect(table.rows).toHaveLength(1)

    const values = table.rows[0]!.values
    expect(values['Issue date']).toBe('2026-10-28')
    expect(values['Due date']).toBe('2026-11-27')
    expect(values['Total (incl GST)']).toBe('327.50')
    expect(values['GST rate (%)']).toBe('9')
    expect(values.Currency).toBe('SGD')
  })

  it('writes payments against their invoice, oldest first, with the method spelled out', () => {
    const csv = exporter.payments(
      paymentExportRows([
        invoice({
          payments: [
            {
              id: 'p2',
              amount: 127,
              method: 'CHEQUE',
              reference: 'CHQ-9',
              paidAt: new Date('2026-11-05T02:00:00Z'),
            },
            {
              id: 'p1',
              amount: 200,
              method: 'BANK_TRANSFER',
              reference: null,
              paidAt: new Date('2026-11-01T02:00:00Z'),
            },
          ],
        }),
      ]),
      'SGD',
    )
    const table = parseCsv(csv)

    expect(table.rows.map((row) => row.values['Amount'])).toEqual(['200.00', '127.00'])
    expect(table.rows[0]!.values.Method).toBe('Bank transfer')
    expect(table.rows[1]!.values.Reference).toBe('CHQ-9')
    expect(table.rows[0]!.values['Invoice number']).toBe('INV-2026-0001')
  })

  it('exports a header and no rows when nothing is billed', () => {
    const rows = paymentExportRows([invoice({ status: 'DRAFT' })])
    expect(rows).toEqual([])
    // Header only — `parseCsv` is an importer and refuses that, so check the raw text.
    expect(exporter.payments(rows, 'SGD').split('\r\n')).toEqual([
      'Payment date,Invoice number,Customer,Method,Reference,Amount,Currency',
    ])
  })

  it('quotes a customer name containing a comma', () => {
    const csv = exporter.invoices(
      invoiceExportRows([invoice({ customer: { id: 'c1', name: 'Acme, Pte Ltd' } })]),
      'SGD',
    )
    expect(parseCsv(csv).rows[0]!.values.Customer).toBe('Acme, Pte Ltd')
  })
})
