import { describe, expect, it } from 'vitest'
import { JOB_TYPES, TEMPLATES } from '@/server/templates/definitions'
import { templateFieldKeys, templateSchema } from '@/lib/templates/schema'

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
