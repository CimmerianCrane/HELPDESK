import { createElement } from 'react'
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { formatDate, formatMoney } from '@/lib/format'
import { INVOICE_STATUS_LABELS, type InvoiceStatusName } from '@/lib/validation/invoices'

/**
 * A tax invoice as a PDF (slice 20).
 *
 * Same contract as the quote and delivery-order renderers: everything volatile is an argument and the
 * document dates are pinned, so re-rendering an unchanged invoice produces the same bytes. Unlike a
 * quotation this **is** a tax invoice, and it says so — the GST registration number, if the office has
 * one in Settings later, belongs in the header rather than being invented here.
 */

export interface InvoicePdfInput {
  number: string
  createdAt: Date
  issueDate: Date | null
  dueDate: Date | null
  timeZone: string
  currency: string
  customer: { name: string }
  job: { number: string } | null
  status: InvoiceStatusName
  gstRate: number
  subtotal: number
  gstAmount: number
  total: number
  amountPaid: number
  lines: Array<{ description: string; quantity: number; unitPrice: number; lineTotal: number }>
}

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 40, paddingHorizontal: 32, fontSize: 9, color: '#0f172a' },
  header: { borderBottomWidth: 1, borderBottomColor: '#cbd5e1', paddingBottom: 6, marginBottom: 10 },
  brand: { fontSize: 14, fontWeight: 'bold' },
  subtitle: { color: '#475569', marginTop: 2 },
  docNumber: { position: 'absolute', right: 32, top: 32, fontSize: 11, fontWeight: 'bold' },
  section: { marginTop: 12 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    backgroundColor: '#f1f5f9',
    paddingVertical: 3,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0' },
  cell: { flex: 1, paddingVertical: 2, paddingHorizontal: 4 },
  cellLabel: { color: '#475569' },
  tableHead: { flexDirection: 'row', backgroundColor: '#f8fafc', borderBottomWidth: 0.5 },
  tableHeadCell: { flex: 1, paddingVertical: 2, paddingHorizontal: 4, fontWeight: 'bold' },
  totals: { marginTop: 8, alignSelf: 'flex-end', width: 240 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1 },
  grandTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
    marginTop: 2,
    paddingTop: 3,
    fontWeight: 'bold',
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
    marginTop: 2,
    paddingTop: 3,
  },
  notice: { marginTop: 16, fontSize: 7, color: '#475569' },
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 32,
    right: 32,
    fontSize: 7,
    color: '#64748b',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
})

function quantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '')
}

function percent(rate: number): string {
  const value = rate * 100
  return `${Number.isInteger(value) ? value : value.toFixed(2)}%`
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const money = (value: number) => formatMoney(value, input.currency)
  const balance = Math.max(0, input.total - input.amountPaid)
  // Pinned to the day it was issued once it has one; a draft has no issue date and falls back to
  // when it was raised, so its bytes are still reproducible.
  const documentDate = input.issueDate ?? input.createdAt

  return renderToBuffer(
    createElement(
      Document,
      {
        title: `${input.number} — Tax invoice`,
        author: 'Cimmerian Crane Services',
        subject: input.job ? `Job ${input.job.number}` : undefined,
        creationDate: documentDate,
        modificationDate: documentDate,
      },
      createElement(
        Page,
        { size: 'A4', style: styles.page },
        createElement(Text, { style: styles.docNumber }, input.number),
        createElement(
          View,
          { style: styles.header },
          createElement(Text, { style: styles.brand }, 'Cimmerian Crane Services'),
          createElement(Text, { style: styles.subtitle }, 'Tax invoice'),
          createElement(
            Text,
            { style: styles.subtitle },
            `${input.customer.name}${input.job ? ` · Job ${input.job.number}` : ''} · ${INVOICE_STATUS_LABELS[input.status]}`,
          ),
        ),

        createElement(
          View,
          { style: styles.section },
          createElement(
            View,
            { style: styles.tableHead },
            createElement(Text, { style: styles.tableHeadCell }, 'Issued'),
            createElement(Text, { style: styles.tableHeadCell }, 'Due'),
            createElement(Text, { style: styles.tableHeadCell }, 'Customer'),
            createElement(Text, { style: styles.tableHeadCell }, 'Job'),
          ),
          createElement(
            View,
            { style: styles.row },
            createElement(
              Text,
              { style: styles.cell },
              formatDate(input.issueDate ?? input.createdAt, input.timeZone),
              input.issueDate ? '' : ' (draft)',
            ),
            createElement(
              Text,
              { style: styles.cell },
              input.dueDate ? formatDate(input.dueDate, input.timeZone) : '—',
            ),
            createElement(Text, { style: styles.cell }, input.customer.name),
            createElement(Text, { style: styles.cell }, input.job?.number ?? '—'),
          ),
        ),

        createElement(
          View,
          { style: styles.section },
          createElement(Text, { style: styles.sectionTitle }, 'Charges'),
          createElement(
            View,
            { style: styles.tableHead },
            createElement(Text, { style: [styles.tableHeadCell, { flex: 4 }] }, 'Description'),
            createElement(Text, { style: styles.tableHeadCell }, 'Qty'),
            createElement(Text, { style: styles.tableHeadCell }, 'Unit price'),
            createElement(Text, { style: styles.tableHeadCell }, 'Amount'),
          ),
          ...input.lines.map((line, index) =>
            createElement(
              View,
              { key: index, style: styles.row },
              createElement(Text, { style: [styles.cell, { flex: 4 }] }, line.description),
              createElement(Text, { style: styles.cell }, quantity(line.quantity)),
              createElement(Text, { style: styles.cell }, money(line.unitPrice)),
              createElement(Text, { style: styles.cell }, money(line.lineTotal)),
            ),
          ),
        ),

        createElement(
          View,
          { style: styles.totals },
          createElement(
            View,
            { style: styles.totalRow },
            createElement(Text, { style: styles.cellLabel }, 'Subtotal'),
            createElement(Text, null, money(input.subtotal)),
          ),
          createElement(
            View,
            { style: styles.totalRow },
            createElement(Text, { style: styles.cellLabel }, `GST (${percent(input.gstRate)})`),
            createElement(Text, null, money(input.gstAmount)),
          ),
          createElement(
            View,
            { style: styles.grandTotal },
            createElement(Text, null, 'Total'),
            createElement(Text, null, money(input.total)),
          ),
          input.amountPaid > 0
            ? createElement(
                View,
                { style: styles.totalRow },
                createElement(Text, { style: styles.cellLabel }, 'Paid'),
                createElement(Text, null, money(input.amountPaid)),
              )
            : null,
          input.amountPaid > 0
            ? createElement(
                View,
                { style: styles.balanceRow },
                createElement(Text, null, 'Balance due'),
                createElement(Text, null, money(balance)),
              )
            : null,
        ),

        createElement(
          Text,
          { style: styles.notice },
          'Amounts are in the currency shown and include GST at the rate stated above. Please quote ' +
            `${input.number} with your payment. This is a company document; it is not a statutory ` +
            'certificate of test and examination.',
        ),

        createElement(
          View,
          { style: styles.footer, fixed: true },
          createElement(Text, null, input.number),
          createElement(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}` }),
          createElement(Text, null, `Issued ${formatDate(input.issueDate ?? input.createdAt, input.timeZone)}`),
        ),
      ),
    ) as never,
  ) as Promise<Buffer>
}
