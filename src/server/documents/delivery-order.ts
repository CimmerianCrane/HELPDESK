import { createElement } from 'react'
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { formatDate, formatDateTime } from '@/lib/format'
import { DELIVERY_CHARGE_TYPE_LABELS } from '@/lib/validation/delivery-orders'

/**
 * A delivery order as a PDF (slice 18).
 *
 * The same contract as the report renderer in `render.ts`: everything volatile is an argument, and
 * the document dates are pinned to the issue time, so re-rendering an issued DO produces the same
 * bytes. It is a separate document rather than a branch in the report renderer because it has no
 * template — a DO is one fixed layout for every job type.
 */

export interface DeliveryOrderPdfInput {
  number: string
  issuedAt: Date
  timeZone: string
  customer: { name: string }
  job: { number: string } | null
  deliveryAddress: string[]
  receiverName: string | null
  receivedAt: Date | null
  signature: Uint8Array | null
  lines: Array<{
    description: string
    quantity: number
    receivedQuantity: number
    serialOrBatch: string | null
    condition: string | null
    chargeType: keyof typeof DELIVERY_CHARGE_TYPE_LABELS
    expectedReturnDate: Date | null
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
  signatureLabel: { color: '#475569', fontSize: 8 },
  signatureImage: { height: 46, marginTop: 2, objectFit: 'contain', width: 180 },
  notice: { marginTop: 12, fontSize: 7, color: '#475569' },
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

export async function renderDeliveryOrderPdf(input: DeliveryOrderPdfInput): Promise<Buffer> {
  return renderToBuffer(
    createElement(
      Document,
      {
        title: `${input.number} — Delivery order`,
        author: 'Cimmerian Crane Services',
        subject: input.job ? `Job ${input.job.number}` : undefined,
        // Pinned for the same reason the report renderer pins them: same input, same bytes.
        creationDate: input.issuedAt,
        modificationDate: input.issuedAt,
      },
      createElement(
        Page,
        { size: 'A4', style: styles.page },
        createElement(Text, { style: styles.docNumber }, input.number),
        createElement(
          View,
          { style: styles.header },
          createElement(Text, { style: styles.brand }, 'Cimmerian Crane Services'),
          createElement(Text, { style: styles.subtitle }, 'Delivery order'),
          createElement(
            Text,
            { style: styles.subtitle },
            `${input.customer.name}${input.job ? ` · Job ${input.job.number}` : ''} · Issued ${formatDateTime(input.issuedAt, input.timeZone)}`,
          ),
        ),

        createElement(
          View,
          { style: styles.section },
          createElement(Text, { style: styles.sectionTitle }, 'Deliver to'),
          createElement(Text, null, input.deliveryAddress.join(', ') || 'Address not recorded.'),
        ),

        createElement(
          View,
          { style: styles.section },
          createElement(Text, { style: styles.sectionTitle }, 'Parts'),
          createElement(
            View,
            { style: styles.tableHead },
            createElement(Text, { style: [styles.tableHeadCell, { flex: 2 }] }, 'Part'),
            createElement(Text, { style: styles.tableHeadCell }, 'Serial / batch'),
            createElement(Text, { style: styles.tableHeadCell }, 'Qty'),
            createElement(Text, { style: styles.tableHeadCell }, 'Received'),
            createElement(Text, { style: styles.tableHeadCell }, 'Terms'),
            createElement(Text, { style: styles.tableHeadCell }, 'Return by'),
          ),
          ...input.lines.map((line, index) =>
            createElement(
              View,
              { key: index, style: styles.row },
              createElement(Text, { style: [styles.cell, { flex: 2 }] }, line.description),
              createElement(Text, { style: styles.cell }, line.serialOrBatch ?? '—'),
              createElement(Text, { style: styles.cell }, quantity(line.quantity)),
              createElement(Text, { style: styles.cell }, quantity(line.receivedQuantity)),
              createElement(
                Text,
                { style: styles.cell },
                DELIVERY_CHARGE_TYPE_LABELS[line.chargeType],
              ),
              createElement(
                Text,
                { style: styles.cell },
                line.expectedReturnDate ? formatDate(line.expectedReturnDate, input.timeZone) : '—',
              ),
            ),
          ),
          ...(input.lines.some((line) => line.condition)
            ? input.lines
                .filter((line) => line.condition)
                .map((line, index) =>
                  createElement(
                    Text,
                    { key: `condition-${index}`, style: [styles.cellLabel, { marginTop: 2 }] },
                    `${line.description}: ${line.condition}`,
                  ),
                )
            : []),
        ),

        createElement(
          View,
          { style: [styles.section, { marginTop: 18 }] },
          createElement(Text, { style: styles.sectionTitle }, 'Received by'),
          input.signature
            ? createElement(Image, { style: styles.signatureImage, src: Buffer.from(input.signature) })
            : createElement(Text, { style: { fontStyle: 'italic' } }, 'Not yet signed.'),
          createElement(Text, { style: { marginTop: 2 } }, input.receiverName ?? '—'),
          createElement(
            Text,
            { style: styles.signatureLabel },
            input.receivedAt ? formatDateTime(input.receivedAt, input.timeZone) : '',
          ),
        ),

        createElement(
          Text,
          { style: styles.notice },
          'Loan items remain the property of Cimmerian Crane Services and are to be returned by the ' +
            'date shown. This delivery order records parts issued from stock; it is not a tax invoice.',
        ),

        createElement(
          View,
          { style: styles.footer, fixed: true },
          createElement(Text, null, `${input.number}${input.job ? ` · ${input.job.number}` : ''}`),
          createElement(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}` }),
          createElement(Text, null, `Issued ${formatDate(input.issuedAt, input.timeZone)}`),
        ),
      ),
    ) as never,
  ) as Promise<Buffer>
}
