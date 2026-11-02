import { describe, expect, it } from 'vitest'
import { JOB_TYPES, TEMPLATES } from '@/server/templates/definitions'
import {
  calibrationWarnings,
  templateFieldKeys,
  templateSchema,
  type TemplateSchema,
} from '@/lib/templates/schema'

/**
 * The seeded catalogue. Fourteen job types and four templates is not arbitrary: they are the work
 * this business actually does, and the Phase 1 slices assume they exist. A seed that quietly loses
 * one is a slice that quietly stops working, so the counts and the shape are pinned here.
 */

describe('the seeded job types', () => {
  it('covers the fourteen kinds of work in the brief', () => {
    expect(JOB_TYPES).toHaveLength(14)
  })

  it('has a unique code for every job type', () => {
    const codes = JOB_TYPES.map((type) => type.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('gives every job type a name and a priority', () => {
    for (const type of JOB_TYPES) {
      expect(type.name.length, `${type.code} has no name`).toBeGreaterThan(0)
      expect(['P1', 'P2', 'P3', 'P4']).toContain(type.defaultPriority)
    }
  })

  it('only links to templates that exist', () => {
    const keys = new Set(TEMPLATES.map((template) => template.key))
    for (const type of JOB_TYPES) {
      if (type.template) {
        expect(keys.has(type.template), `${type.code} links to ${type.template}`).toBe(true)
      }
    }
  })
})

describe('the seeded report templates', () => {
  it('ships the four Phase 1 templates', () => {
    expect(TEMPLATES.map((template) => template.key).sort()).toEqual([
      'BREAKDOWN',
      'LOAD_TEST',
      'SERVICING',
      'VISUAL_INSPECTION',
    ])
  })

  it('validates every report schema against the shared contract', () => {
    for (const template of TEMPLATES) {
      expect(() => templateSchema.parse(template.report), template.key).not.toThrow()
    }
  })

  it('has no duplicate field key between its flat sections', () => {
    // Table columns are scoped to their row array (`data[section.key][].field`), so a table column and
    // a flat field may share a name. Two flat fields may not: they share one answer map.
    for (const template of TEMPLATES) {
      const flatKeys = template.report.sections
        .filter((section) => section.layout === 'fields')
        .flatMap((section) => section.fields.map((field) => field.key))
      expect(new Set(flatKeys).size, `${template.key} has a duplicate flat field key`).toBe(
        flatKeys.length,
      )
    }
  })

  it('gives every template a checklist with unique item codes', () => {
    for (const template of TEMPLATES) {
      expect(template.checklist.items.length, template.key).toBeGreaterThan(0)
      const codes = template.checklist.items.map((item) => item.code)
      expect(new Set(codes).size, `${template.key} has a duplicate checklist code`).toBe(codes.length)
    }
  })

  it('asks every report for a short account of the work', () => {
    // Signatures are captured by the report form itself (slice 8), not by the template schema, so the
    // one thing every template must ask for here is the narrative a reader starts with.
    for (const template of TEMPLATES) {
      expect(templateFieldKeys(template.report), template.key).toContain('workSummary')
    }
  })

  it('keeps the load test template’s numerical sections as tables', () => {
    const loadTest = TEMPLATES.find((template) => template.key === 'LOAD_TEST')
    expect(loadTest).toBeDefined()
    const layouts = loadTest!.report.sections.map((section) => section.layout)
    expect(layouts).toContain('table')
  })
})

describe('slice 17: the built-out templates', () => {
  const loadTest = TEMPLATES.find((template) => template.key === 'LOAD_TEST')!
  const visual = TEMPLATES.find((template) => template.key === 'VISUAL_INSPECTION')!

  it('publishes the load test and visual inspection at version 2', () => {
    expect(loadTest.version).toBe(2)
    expect(visual.version).toBe(2)
    expect(loadTest.code).toBe('LOAD_TEST')
  })

  it('checks the load test’s instruments against the register at the test date', () => {
    const instruments = loadTest.report.sections.find((section) => section.key === 'instruments')!
    expect(instruments.calibration).toEqual({
      testDateKey: 'testDate',
      labelKey: 'instrument',
      serialKey: 'serialNumber',
      dueKey: 'calibrationDue',
    })
    expect(instruments.fields.map((field) => field.key)).toContain('instrumentType')
    expect(templateFieldKeys(loadTest.report)).toContain('deflectionMm')
  })

  it('covers the visual inspection categories the brief names (§6.3)', () => {
    const labels = visual.report.sections.map((section) => section.label)
    expect(labels).toEqual(
      expect.arrayContaining([
        'Structure',
        'Safety devices',
        'Markings and load charts',
        'Wire rope and hook',
        'Operator controls',
        'Overall condition',
      ]),
    )
    const overall = visual.report.sections.find((section) => section.key === 'condition')!
    expect(overall.fields.find((field) => field.key === 'overallCondition')?.options).toEqual([
      'Good',
      'Fair',
      'Poor',
    ])
  })
})

describe('calibrationWarnings', () => {
  const template: TemplateSchema = {
    sections: [
      {
        key: 'setup',
        label: 'Setup',
        layout: 'fields',
        fields: [{ key: 'testDate', label: 'Date of test', type: 'DATE', required: true }],
      },
      {
        key: 'instruments',
        label: 'Instruments',
        layout: 'table',
        fields: [
          { key: 'instrument', label: 'ID', type: 'TEXT' },
          { key: 'serialNumber', label: 'Serial', type: 'TEXT' },
          { key: 'calibrationDue', label: 'Calibration due', type: 'DATE' },
        ],
        calibration: {
          testDateKey: 'testDate',
          labelKey: 'instrument',
          serialKey: 'serialNumber',
          dueKey: 'calibrationDue',
        },
      },
    ],
  }

  function rows(...instruments: Array<[string, string, string]>): Record<string, unknown>[] {
    return instruments.map(([instrument, serialNumber, calibrationDue]) => ({
      instrument,
      serialNumber,
      calibrationDue,
    }))
  }

  it('warns when the recorded due date was already past on the test date', () => {
    const warnings = calibrationWarnings(template, {
      testDate: '2026-03-10',
      instruments: rows(['LC-1', 'A1', '2026-03-01']),
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toBe('LC-1 was out of calibration on 10/03/2026: its due date was 01/03/2026.')
  })

  it('says nothing when the instrument was in date on the day', () => {
    expect(
      calibrationWarnings(template, {
        testDate: '2026-03-10',
        instruments: rows(['LC-1', 'A1', '2026-03-10']),
      }),
    ).toEqual([])
  })

  it('warns when the register disagrees and its date has passed', () => {
    const warnings = calibrationWarnings(
      template,
      { testDate: '2026-03-10', instruments: rows(['LC-1', 'a1', '']) },
      new Map([['A1', '2026-02-01']]),
    )
    expect(warnings.map((warning) => warning.message)).toEqual([
      'The register says LC-1 (a1) was due for calibration on 01/02/2026, before this test.',
    ])
  })

  it('warns when the register has no date and the form did not record one', () => {
    const warnings = calibrationWarnings(
      template,
      { testDate: '2026-03-10', instruments: rows(['LC-1', 'A1', '']) },
      new Map([['A1', null]]),
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('has no calibration date in the register')
  })

  it('stays quiet about a serial the register has never heard of', () => {
    // Hired test weights are normal: the register cannot speak for them, so the form's date is it.
    expect(
      calibrationWarnings(
        template,
        { testDate: '2026-03-10', instruments: rows(['Hired weight', 'H-9', '']) },
        new Map([['A1', '2020-01-01']]),
      ),
    ).toEqual([])
  })

  it('does nothing until a test date has been given', () => {
    expect(
      calibrationWarnings(template, { instruments: rows(['LC-1', 'A1', '2020-01-01']) }),
    ).toEqual([])
  })
})
