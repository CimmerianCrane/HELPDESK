import { createElement } from 'react'
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { formatDate, formatMoney } from '@/lib/format'
import { QUOTE_STATUS_LABELS, type QuoteStatusName } from '@/lib/validation/quotes'

/**
 * A quotation as a PDF (slice 19).
 *
 * The same contract as the delivery-order and report renderers: everything volatile is an argument,
 * and the document dates are pinned to when the quote was raised, so re-rendering an unchanged quote
 * produces the same bytes. It says "quotation" and never "tax invoice" — the brief keeps the two
 * documents distinct (CLAUDE.md rule 3).
 */

export interface QuotePdfInput {
  number: string
  createdAt: Date
  timeZone: string
  currency: string
  customer: { name: string }
  job: { number: string } | null
  validUntil: Date | null
  status: QuoteStatusName
  notes: string | null
  gstRate: number
  subtotal: number
  gstAmount: number
  total: number
  lines: Array<{
    description: string
    quantity: number
    unitPrice: number
    lineTotal: number
    isVariation: boolean
  }>
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
  totals: { marginTop: 8, alignSelf: 'flex-end', width: 220 },
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

export async function renderQuotePdf(input: QuotePdfInput): Promise<Buffer> {
  const money = (value: number) => formatMoney(value, input.currency)

  return renderToBuffer(
    createElement(
      Document,
      {
        title: `${input.number} — Quotation`,
        author: 'Cimmerian Crane Services',
        subject: input.job ? `Job ${input.job.number}` : undefined,
        // Pinned for the same reason the other renderers pin them: same input, same bytes.
        creationDate: input.createdAt,
        modificationDate: input.createdAt,
      },
      createElement(
        Page,
        { size: 'A4', style: styles.page },
        createElement(Text, { style: styles.docNumber }, input.number),
        createElement(
          View,
          { style: styles.header },
          createElement(Text, { style: styles.brand }, 'Cimmerian Crane Services'),
          createElement(Text, { style: styles.subtitle }, 'Quotation'),
          createElement(
            Text,
            { style: styles.subtitle },
            `${input.customer.name}${input.job ? ` · Job ${input.job.number}` : ''} · ${QUOTE_STATUS_LABELS[input.status]}`,
          ),
        ),

        createElement(
          View,
          { style: styles.section },
          createElement(
            View,
            { style: styles.tableHead },
            createElement(Text, { style: styles.tableHeadCell }, 'Quoted on'),
            createElement(Text, { style: styles.tableHeadCell }, 'Valid until'),
            createElement(Text, { style: styles.tableHeadCell }, 'Customer'),
            createElement(Text, { style: styles.tableHeadCell }, 'Job'),
          ),
          createElement(
            View,
            { style: styles.row },
            createElement(Text, { style: styles.cell }, formatDate(input.createdAt, input.timeZone)),
            createElement(
              Text,
              { style: styles.cell },
              input.validUntil ? formatDate(input.validUntil, input.timeZone) : 'No expiry',
            ),
            createElement(Text, { style: styles.cell }, input.customer.name),
            createElement(Text, { style: styles.cell }, input.job?.number ?? '—'),
          ),
        ),

        createElement(
          View,
          { style: styles.section },
          createElement(Text, { style: styles.sectionTitle }, 'Lines'),
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
              createElement(
                Text,
                { style: [styles.cell, { flex: 4 }] },
                `${line.description}${line.isVariation ? ' (variation)' : ''}`,
              ),
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
        ),

        ...(input.notes
          ? [
              createElement(
                View,
                { style: styles.section },
                createElement(Text, { style: styles.sectionTitle }, 'Notes'),
                createElement(Text, null, input.notes),
              ),
            ]
          : []),

        createElement(
          Text,
          { style: styles.notice },
          'This is a quotation, not a tax invoice. Prices are exclusive of GST except where shown, ' +
            'and remain open for acceptance until the valid-until date above. Work outside the lines ' +
            'quoted here is a variation and will be priced separately.',
        ),

        createElement(
          View,
          { style: styles.footer, fixed: true },
          createElement(Text, null, `${input.number}${input.job ? ` · ${input.job.number}` : ''}`),
          createElement(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}` }),
          createElement(Text, null, `Quoted ${formatDate(input.createdAt, input.timeZone)}`),
        ),
      ),
    ) as never,
  ) as Promise<Buffer>
}
