import { createElement } from 'react'
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { formatDateTime } from '@/lib/format'
import type { ServiceReportContent } from '@/lib/validation/service-report'

/**
 * The Service Report as a PDF (slice 39).
 *
 * A section per crane, a paragraph per graded part, worst first — the shape the paper Service Report
 * has. It takes the content as stored on the row, never a rebuild from the checklists, for the same
 * reason the report PDF takes the template version from the report: an issued document must render as
 * approved even after a checklist template is superseded. Volatile values are arguments and
 * `creationDate` is pinned, so the same report renders to the same bytes (the diff test depends on it).
 */

export interface ServiceReportPdfInput {
  documentNumber: string
  content: ServiceReportContent
  issuedAt: Date
  timeZone: string
  job: { number: string }
  customer: { name: string; siteName: string; siteAddress: string[] }
}

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 40, paddingHorizontal: 32, fontSize: 9, color: '#0f172a' },
  header: { borderBottomWidth: 1, borderBottomColor: '#cbd5e1', paddingBottom: 6, marginBottom: 10 },
  docNumber: { fontSize: 12, fontWeight: 'bold', marginBottom: 4 },
  brand: { fontSize: 14, fontWeight: 'bold' },
  subtitle: { fontSize: 8, color: '#475569' },
  section: { marginTop: 12 },
  craneTitle: { fontSize: 11, fontWeight: 'bold', borderBottomWidth: 1, borderBottomColor: '#94a3b8', paddingBottom: 3 },
  craneMeta: { fontSize: 8, color: '#475569', marginTop: 2 },
  paragraph: { marginTop: 6 },
  component: { fontSize: 9, fontWeight: 'bold' },
  body: { fontSize: 9 },
  notice: { marginTop: 16, fontSize: 7, color: '#64748b', fontStyle: 'italic' },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 32,
    right: 32,
    fontSize: 7,
    color: '#64748b',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
})

export async function renderServiceReportPdf(input: ServiceReportPdfInput): Promise<Buffer> {
  return renderToBuffer(
    createElement(
      Document,
      {
        title: `${input.documentNumber} — Service Report`,
        author: 'Cimmerian Crane Services',
        subject: `Job ${input.job.number}`,
        creationDate: input.issuedAt,
        modificationDate: input.issuedAt,
      },
      createElement(
        Page,
        { size: 'A4', style: styles.page },
        createElement(Text, { style: styles.docNumber }, input.documentNumber),
        createElement(
          View,
          { style: styles.header },
          createElement(Text, { style: styles.brand }, 'Cimmerian Crane Services'),
          createElement(Text, { style: styles.subtitle }, `Service Report · Job ${input.job.number}`),
          createElement(
            Text,
            { style: styles.subtitle },
            `${input.customer.name} · ${input.customer.siteName} · Issued ${formatDateTime(input.issuedAt, input.timeZone)}`,
          ),
          input.customer.siteAddress.length > 0
            ? createElement(Text, { style: styles.subtitle }, input.customer.siteAddress.join(', '))
            : null,
        ),

        ...input.content.cranes.map((crane) =>
          createElement(
            View,
            { key: crane.craneId, style: styles.section },
            createElement(Text, { style: styles.craneTitle }, crane.assetTag),
            crane.type ? createElement(Text, { style: styles.craneMeta }, crane.type) : null,
            ...crane.paragraphs.map((paragraph, index) =>
              createElement(
                View,
                { key: index, style: styles.paragraph },
                createElement(Text, { style: styles.component }, paragraph.component),
                createElement(Text, { style: styles.body }, paragraph.text),
              ),
            ),
          ),
        ),

        createElement(
          Text,
          { style: styles.notice },
          'Company servicing record. This is not a statutory certificate of test and examination; ' +
            'statutory documents are issued by an Authorised Examiner.',
        ),

        createElement(
          View,
          { style: styles.footer, fixed: true },
          createElement(Text, null, `${input.documentNumber} · ${input.job.number}`),
          createElement(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}` }),
        ),
      ),
    ) as never,
  ) as Promise<Buffer>
}
