import { createElement } from 'react'
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { formatDate, formatDateTime } from '@/lib/format'
import type { TemplateSchema, TemplateSection } from '@/lib/templates/schema'
import { SERVICE_GRADE_LABELS, readGrades } from '@/lib/validation/reports'

/**
 * A report as a PDF (slice 9).
 *
 * **Data, not one component per template.** The template declares its sections as data
 * (`src/lib/templates/schema.ts`), the report stores the answers keyed by those fields, and this file
 * turns the two into a document. A component per template would be a third copy of the same shape and
 * would have to be written again for every new job type the office configures.
 *
 * **Reproducibility comes from what is passed in, not from the component.** `renderReportPdf` takes
 * the template schema and version *as stored on the report*, never a lookup of the current template,
 * and every volatile value (timestamps, the document number, the images) is an argument. The page's
 * `creationDate`/`modificationDate` are pinned to the approval time, because `@react-pdf/renderer`
 * defaults them to `new Date()` and the same report would otherwise produce different bytes each
 * render — which would make "re-render an issued report and diff it" untestable.
 *
 * Images are passed in as bytes. This module does no storage I/O: it is called inside the approval
 * transaction and inside the cron retry, and neither should be reading files from a driver.
 */

export interface ReportPdfInput {
  documentNumber: string
  template: TemplateSchema
  templateVersion: number
  data: Record<string, unknown>
  issuedAt: Date
  timeZone: string
  job: { number: string; typeName: string }
  customer: { name: string; siteName: string; siteAddress: string[] }
  crane: {
    assetTag: string
    type: string
    brand: string | null
    model: string | null
    serialNumber: string | null
    swlKg: number
    yearOfManufacture: number | null
    statutoryRegistrationNo: string | null
    locationOnSite: string | null
  }
  signatures: { technician: Uint8Array | null; customer: Uint8Array | null }
  photos: Uint8Array[]
  signers: {
    technicianName: string
    technicianSignedAt: Date | null
    customerName: string | null
    customerDesignation: string | null
    customerSignedAt: Date | null
    customerDeclinedReason: string | null
  }
  findings: Array<{
    component: string
    description: string
    severity: string
    recommendation: string | null
  }>
  safeToOperate: string | null
  /** `RPT-2026-0003-A` for an amendment. Empty for the original. */
  amendmentLabel: string
}

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 40, paddingHorizontal: 32, fontSize: 9, color: '#0f172a' },
  header: { borderBottomWidth: 1, borderBottomColor: '#cbd5e1', paddingBottom: 6, marginBottom: 10 },
  brand: { fontSize: 14, fontWeight: 'bold' },
  subtitle: { color: '#475569', marginTop: 2 },
  docNumber: { position: 'absolute', right: 32, top: 32, fontSize: 11, fontWeight: 'bold' },
  section: { marginTop: 10 },
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
  signatureBox: { flex: 1, marginRight: 12 },
  signatureLabel: { color: '#475569', fontSize: 8 },
  signatureImage: { height: 46, marginTop: 2, objectFit: 'contain' },
  photo: { width: 160, height: 120, objectFit: 'contain', marginRight: 8, marginBottom: 8 },
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

/** Answers are whatever the phone stored; this only decides how to print one. */
function answerText(value: unknown, unit?: string): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.length === 0 ? '—' : `${value.length} recorded`
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return unit ? `${String(value)} ${unit}` : String(value)
}

function FieldRows({
  section,
  data,
}: {
  section: TemplateSection
  data: Record<string, unknown>
}) {
  return createElement(
    View,
    null,
    ...section.fields.map((field) =>
      createElement(
        View,
        { key: field.key, style: styles.row },
        createElement(Text, { style: [styles.cell, styles.cellLabel] }, field.label),
        createElement(
          Text,
          { style: styles.cell },
          answerText(data[field.key], field.unit),
        ),
      ),
    ),
  )
}

function TableSection({
  section,
  data,
}: {
  section: TemplateSection
  data: Record<string, unknown>
}) {
  const rows = Array.isArray(data[section.key])
    ? (data[section.key] as Array<Record<string, unknown>>)
    : []

  if (rows.length === 0) {
    return createElement(Text, { style: styles.cellLabel }, 'None recorded.')
  }

  return createElement(
    View,
    null,
    createElement(
      View,
      { style: styles.tableHead },
      ...section.fields.map((field) =>
        createElement(
          Text,
          { key: field.key, style: styles.tableHeadCell },
          field.unit ? `${field.label} (${field.unit})` : field.label,
        ),
      ),
    ),
    ...rows.map((row, index) =>
      createElement(
        View,
        { key: index, style: styles.row },
        ...section.fields.map((field) =>
          createElement(
            Text,
            { key: field.key, style: styles.cell },
            answerText(row[field.key], field.unit),
          ),
        ),
      ),
    ),
  )
}

function GradeTable({
  grades,
}: {
  grades: Array<[string, { grade: number | null; comment: string | null; label: string | null }]>
}) {
  return createElement(
    View,
    { style: styles.section },
    createElement(Text, { style: styles.sectionTitle }, 'Component grades (1–5)'),
    createElement(
      View,
      { style: styles.tableHead },
      createElement(Text, { style: [styles.tableHeadCell, { flex: 3 }] }, 'Component'),
      createElement(Text, { style: styles.tableHeadCell }, 'Grade'),
      createElement(Text, { style: styles.tableHeadCell }, 'Rating'),
      createElement(Text, { style: [styles.tableHeadCell, { flex: 3 }] }, 'Comment'),
    ),
    ...grades.map(([code, entry], index) =>
      createElement(
        View,
        { key: index, style: styles.row },
        createElement(Text, { style: [styles.cell, { flex: 3 }] }, entry.label ?? code),
        createElement(Text, { style: styles.cell }, String(entry.grade ?? '—')),
        createElement(
          Text,
          { style: styles.cell },
          entry.grade ? SERVICE_GRADE_LABELS[entry.grade] ?? '—' : '—',
        ),
        createElement(Text, { style: [styles.cell, { flex: 3 }] }, entry.comment ?? '—'),
      ),
    ),
  )
}

export async function renderReportPdf(input: ReportPdfInput): Promise<Buffer> {
  const { data } = input
  // A Service Report's grades ride in `Report.data.grades`; read them through the same validator the
  // office page uses so a malformed entry cannot break the document.
  const graded = Object.entries(readGrades(data))
    .filter(([, entry]) => entry.grade !== null)
    .sort((a, b) => (a[1].grade ?? 9) - (b[1].grade ?? 9))
  const photoElements = input.photos
    .filter((bytes) => bytes.byteLength > 0)
    .map((bytes, index) =>
      createElement(Image, {
        key: index,
        style: styles.photo,
        src: Buffer.from(bytes),
      }),
    )

  return renderToBuffer(
    createElement(
      Document,
      {
        title: `${input.documentNumber} — ${input.job.typeName}`,
        author: 'Cimmerian Crane Services',
        subject: `Job ${input.job.number}`,
        // Pinned so the same report renders to the same bytes. Without these react-pdf writes the
        // current time into the info dictionary and the diff test can never pass.
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
          createElement(
            Text,
            { style: styles.subtitle },
            `${input.job.typeName} report · Job ${input.job.number}`,
          ),
          createElement(
            Text,
            { style: styles.subtitle },
            `${input.customer.name} · ${input.customer.siteName} · Issued ${formatDateTime(input.issuedAt, input.timeZone)}`,
          ),
          input.amendmentLabel
            ? createElement(Text, { style: styles.subtitle }, input.amendmentLabel)
            : null,
        ),

        createElement(
          View,
          { style: styles.section },
          createElement(Text, { style: styles.sectionTitle }, 'Crane'),
          createElement(
            View,
            { style: styles.row },
            createElement(Text, { style: [styles.cell, styles.cellLabel] }, 'Crane ID'),
            createElement(Text, { style: styles.cell }, input.crane.assetTag),
            createElement(Text, { style: [styles.cell, styles.cellLabel] }, 'Type'),
            createElement(Text, { style: styles.cell }, input.crane.type),
          ),
          createElement(
            View,
            { style: styles.row },
            createElement(Text, { style: [styles.cell, styles.cellLabel] }, 'Brand / model'),
            createElement(
              Text,
              { style: styles.cell },
              [input.crane.brand, input.crane.model].filter(Boolean).join(' ') || '—',
            ),
            createElement(Text, { style: [styles.cell, styles.cellLabel] }, 'Serial number'),
            createElement(Text, { style: styles.cell }, input.crane.serialNumber ?? '—'),
          ),
          createElement(
            View,
            { style: styles.row },
            createElement(Text, { style: [styles.cell, styles.cellLabel] }, 'Safe working load'),
            createElement(Text, { style: styles.cell }, `${input.crane.swlKg.toLocaleString()} kg`),
            createElement(Text, { style: [styles.cell, styles.cellLabel] }, 'Year of manufacture'),
            createElement(
              Text,
              { style: styles.cell },
              input.crane.yearOfManufacture ? String(input.crane.yearOfManufacture) : '—',
            ),
          ),
          createElement(
            View,
            { style: styles.row },
            createElement(
              Text,
              { style: [styles.cell, styles.cellLabel] },
              'Statutory registration',
            ),
            createElement(Text, { style: styles.cell }, input.crane.statutoryRegistrationNo ?? '—'),
            createElement(Text, { style: [styles.cell, styles.cellLabel] }, 'Location on site'),
            createElement(Text, { style: styles.cell }, input.crane.locationOnSite ?? '—'),
          ),
          createElement(
            View,
            { style: styles.row },
            createElement(Text, { style: [styles.cell, styles.cellLabel] }, 'Site address'),
            createElement(Text, { style: styles.cell }, input.customer.siteAddress.join(', ') || '—'),
            createElement(Text, { style: [styles.cell, styles.cellLabel] }, 'Template version'),
            createElement(Text, { style: styles.cell }, String(input.templateVersion)),
          ),
        ),

        ...input.template.sections.map((section) =>
          createElement(
            View,
            { key: section.key, style: styles.section },
            createElement(Text, { style: styles.sectionTitle }, section.label),
            section.layout === 'table'
              ? createElement(TableSection, { section, data })
              : createElement(FieldRows, { section, data }),
          ),
        ),

        ...(graded.length > 0
          ? [
              createElement(GradeTable, {
                key: 'grades',
                grades: graded,
              }),
            ]
          : []),

        input.findings.length > 0
          ? createElement(
              View,
              { style: styles.section },
              createElement(Text, { style: styles.sectionTitle }, 'Findings'),
              ...input.findings.map((finding, index) =>
                createElement(
                  View,
                  { key: index, style: styles.row },
                  createElement(Text, { style: [styles.cell, styles.cellLabel] }, finding.component),
                  createElement(Text, { style: styles.cell }, finding.description),
                  createElement(Text, { style: styles.cell }, finding.severity),
                  createElement(
                    Text,
                    { style: styles.cell },
                    finding.recommendation ?? '—',
                  ),
                ),
              ),
            )
          : null,

        createElement(
          Text,
          { style: styles.section },
          `Safe to operate: ${input.safeToOperate ?? 'not recorded'}`,
        ),

        photoElements.length > 0
          ? createElement(
              View,
              { style: styles.section },
              createElement(Text, { style: styles.sectionTitle }, 'Photographs'),
              createElement(View, { style: { flexDirection: 'row', flexWrap: 'wrap' } }, ...photoElements),
            )
          : null,

        createElement(
          View,
          { style: [styles.section, { flexDirection: 'row', marginTop: 18 }] },
          createElement(
            View,
            { style: styles.signatureBox },
            createElement(Text, { style: styles.signatureLabel }, 'Technician'),
            input.signatures.technician
              ? createElement(Image, {
                  style: styles.signatureImage,
                  src: Buffer.from(input.signatures.technician),
                })
              : null,
            createElement(Text, { style: { marginTop: 2 } }, input.signers.technicianName),
            createElement(
              Text,
              { style: styles.signatureLabel },
              formatDateTime(input.signers.technicianSignedAt, input.timeZone),
            ),
          ),
          createElement(
            View,
            { style: styles.signatureBox },
            createElement(Text, { style: styles.signatureLabel }, 'Customer'),
            input.signatures.customer
              ? createElement(Image, {
                  style: styles.signatureImage,
                  src: Buffer.from(input.signatures.customer),
                })
              : createElement(
                  Text,
                  { style: { marginTop: 4, fontStyle: 'italic' } },
                  input.signers.customerDeclinedReason ?? 'Not signed.',
                ),
            createElement(Text, { style: { marginTop: 2 } }, input.signers.customerName ?? '—'),
            createElement(
              Text,
              { style: styles.signatureLabel },
              [
                input.signers.customerDesignation,
                input.signers.customerSignedAt
                  ? formatDateTime(input.signers.customerSignedAt, input.timeZone)
                  : null,
              ]
                .filter(Boolean)
                .join(' · '),
            ),
          ),
        ),

        createElement(
          Text,
          { style: styles.notice },
          'Company inspection report. This is not a statutory certificate of test and examination; ' +
            'statutory documents are issued by an Authorised Examiner.',
        ),

        createElement(
          View,
          { style: styles.footer, fixed: true },
          createElement(Text, null, `${input.documentNumber} · ${input.job.number}`),
          createElement(Text, { render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}` }),
          createElement(
            Text,
            null,
            `Issued ${formatDate(input.issuedAt, input.timeZone)}`,
          ),
        ),
      ),
    ) as never,
  ) as Promise<Buffer>
}
