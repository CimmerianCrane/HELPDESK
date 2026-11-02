import { describe, expect, it } from 'vitest'
import {
  buildServiceReportContent,
  serviceReportContentSchema,
  serviceReportSentence,
} from '@/lib/validation/service-report'

/**
 * The Service Report is built from the graded checklists and then edited by the office (slice 39).
 * These pin the three things an editor relies on: one sentence per graded part, worst first, and a
 * crane with nothing graded staying out of the document.
 */

describe('serviceReportSentence', () => {
  it('says the grade in words and keeps the technician’s note', () => {
    expect(serviceReportSentence('Hoist brake', 2, 'Lining at 1.8 mm, replace next visit.')).toBe(
      'Hoist brake: Grade 2 of 5 — Repair soon. Lining at 1.8 mm, replace next visit.',
    )
  })

  it('is still a sentence when there is nothing to add', () => {
    expect(serviceReportSentence('Wire rope', 5, null)).toBe(
      'Wire rope: Grade 5 of 5 — As new.',
    )
    expect(serviceReportSentence('Wire rope', 5, '   ')).toBe(
      'Wire rope: Grade 5 of 5 — As new.',
    )
  })
})

describe('buildServiceReportContent', () => {
  const crane = (craneId: string, assetTag: string, grades: Record<string, unknown>) => ({
    craneId,
    assetTag,
    type: 'Tower crane',
    data: { grades },
  })

  it('lists the worst grade first, one paragraph per graded part', () => {
    const built = buildServiceReportContent([
      crane('c2', 'SC-0042', {
        ROPE: { grade: 4, comment: null, label: 'Wire rope' },
        BRAKE: { grade: 1, comment: 'Replaced on site.', label: 'Hoist brake' },
        LIMIT: { grade: 5, comment: null, label: 'Limit switch' },
      }),
    ])

    expect(built.cranes).toHaveLength(1)
    expect(built.cranes[0]!.paragraphs.map((entry) => entry.component)).toEqual([
      'Hoist brake',
      'Wire rope',
      'Limit switch',
    ])
    expect(built.cranes[0]!.paragraphs[0]!.text).toBe(
      'Hoist brake: Grade 1 of 5 — Failed. Replaced on site.',
    )
  })

  it('leaves out an ungraded line and a crane with nothing graded', () => {
    const built = buildServiceReportContent([
      crane('c1', 'SC-0041', { BRAKE: { grade: null, comment: 'not looked at', label: 'Hoist brake' } }),
      crane('c2', 'SC-0042', { BRAKE: { grade: 3, comment: null, label: 'Hoist brake' } }),
    ])

    expect(built.cranes.map((entry) => entry.assetTag)).toEqual(['SC-0042'])
  })

  it('falls back to the code when a grade carries no label', () => {
    const built = buildServiceReportContent([crane('c1', 'SC-0041', { HOIST_BRAKE: { grade: 3 } })])
    expect(built.cranes[0]!.paragraphs[0]!.component).toBe('HOIST_BRAKE')
  })

  it('refuses a document with no cranes, so an empty report cannot be stored', () => {
    expect(serviceReportContentSchema.safeParse({ cranes: [] }).success).toBe(false)
  })

  it('builds an empty document rather than throwing when nothing is graded yet', () => {
    // A PM job with no submitted checklist renders its empty state; throwing took the job page down.
    expect(buildServiceReportContent([])).toEqual({ cranes: [] })
    expect(buildServiceReportContent([crane('c1', 'SC-0041', { BRAKE: { grade: null } })])).toEqual({
      cranes: [],
    })
  })

  it('refuses a paragraph with no sentence — the office may not blank one out', () => {
    const parsed = serviceReportContentSchema.safeParse({
      cranes: [
        {
          craneId: 'c1',
          assetTag: 'SC-0041',
          type: null,
          paragraphs: [{ component: 'Hoist brake', grade: 3, comment: null, text: '  ' }],
        },
      ],
    })
    expect(parsed.success).toBe(false)
  })
})
