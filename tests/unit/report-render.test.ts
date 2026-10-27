import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { renderReportPdf, type ReportPdfInput } from '@/server/documents/render'

/**
 * The renderer's contract (slice 9).
 *
 * The claim PLAN §9 asks a test to defend is that an issued report re-renders as issued: the output is
 * a function of the stored template version and the stored answers, not of the template as it stands
 * today. That is tested against the database in `tests/integration/report-approval.test.ts`. What this
 * file pins is the property that makes that test possible at all — the same input produces the same
 * bytes — plus a smoke test that a real template writes a real PDF.
 */

const TEMPLATE = {
  sections: [
    {
      key: 'visit',
      label: 'Visit',
      layout: 'fields' as const,
      fields: [
        { key: 'workDone', label: 'Work done', type: 'TEXT' as const, required: true },
        { key: 'wireRope', label: 'Wire rope diameter', type: 'NUMBER' as const, unit: 'mm' },
      ],
    },
    {
      key: 'findings',
      label: 'Findings',
      layout: 'table' as const,
      fields: [
        { key: 'component', label: 'Component', type: 'TEXT' as const },
        { key: 'severity', label: 'Severity', type: 'TEXT' as const },
      ],
    },
  ],
}

function input(overrides: Partial<ReportPdfInput> = {}): ReportPdfInput {
  return {
    documentNumber: 'RPT-2026-0007',
    template: TEMPLATE,
    templateVersion: 1,
    data: {
      workDone: 'Replaced the hoist brake lining',
      wireRope: 12.5,
      findings: [{ component: 'Hook latch', severity: 'Minor' }],
    },
    issuedAt: new Date('2026-10-27T02:15:00.000Z'),
    timeZone: 'Asia/Singapore',
    job: { number: 'JOB-2026-0042', typeName: 'Preventive maintenance' },
    customer: {
      name: 'Harbour Logistics',
      siteName: 'Jurong Yard',
      siteAddress: ['12 Jurong Port Road', 'Singapore', '619093'],
    },
    crane: {
      assetTag: 'CR-014',
      type: 'Overhead crane',
      brand: 'Konecranes',
      model: 'CXT',
      serialNumber: 'SN-77812',
      swlKg: 10_000,
      yearOfManufacture: 2018,
      statutoryRegistrationNo: 'MOM-12345',
      locationOnSite: 'Bay 3',
    },
    signatures: { technician: null, customer: null },
    photos: [],
    signers: {
      technicianName: 'Ahmad Ismail',
      technicianSignedAt: new Date('2026-10-27T01:40:00.000Z'),
      customerName: 'Mei Ling',
      customerDesignation: 'Supervisor',
      customerSignedAt: new Date('2026-10-27T01:41:00.000Z'),
      customerDeclinedReason: null,
    },
    findings: [{ component: 'Hook latch', description: 'Spring weak', severity: 'MINOR', recommendation: null }],
    safeToOperate: 'YES',
    amendmentLabel: '',
    ...overrides,
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('rendering a report PDF', () => {
  it('produces the same bytes twice for the same input', async () => {
    const first = await renderReportPdf(input())
    const second = await renderReportPdf(input())

    expect(first.subarray(0, 5).toString()).toBe('%PDF-')
    expect(first.byteLength).toBeGreaterThan(1000)
    // This is the whole reason `creationDate` is pinned to `issuedAt`: react-pdf otherwise writes the
    // current time into the info dictionary and two renders of one report never match.
    expect(sha256(second)).toBe(sha256(first))
  })

  it('renders a different document when the answers differ', async () => {
    const a = await renderReportPdf(input())
    const b = await renderReportPdf(
      input({ data: { ...input().data, workDone: 'Adjusted the travel limit' } }),
    )
    expect(sha256(b)).not.toBe(sha256(a))
  })

  it('renders an older template version differently from a newer one over the same answers', async () => {
    const v1 = await renderReportPdf(input())
    const v2 = await renderReportPdf(
      input({
        templateVersion: 2,
        template: {
          sections: [
            ...TEMPLATE.sections,
            {
              key: 'recommendations',
              label: 'Recommendations',
              layout: 'fields',
              fields: [{ key: 'followUp', label: 'Follow-up', type: 'TEXT' }],
            },
          ],
        },
      }),
    )
    expect(sha256(v2)).not.toBe(sha256(v1))
  })
})
