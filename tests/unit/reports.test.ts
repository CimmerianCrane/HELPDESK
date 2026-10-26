import { describe, expect, it } from 'vitest'
import type { TemplateSchema } from '@/lib/templates/schema'
import {
  checklistAnswersSchema,
  reportSubmitSchema,
  templateDataSchema,
} from '@/lib/validation/reports'

/**
 * The rules a report must satisfy before it is stored (slice 8).
 *
 * These are the checks the phone runs before queueing and the server runs again before writing, so
 * the wording of a failure is what a technician standing under a crane will read. The template here
 * mirrors the real seeded shapes: a required number, a form-wide answer map and a table with rows.
 */

const template: TemplateSchema = {
  sections: [
    {
      key: 'visit',
      label: 'Visit',
      layout: 'fields',
      fields: [
        { key: 'workDone', label: 'Work done', type: 'TEXT', required: true },
        { key: 'hourMeter', label: 'Hour meter', type: 'NUMBER', unit: 'h', required: true },
        {
          key: 'safeToOperate',
          label: 'Safe to operate?',
          type: 'RADIO',
          options: ['Yes', 'No'],
          required: true,
        },
      ],
    },
    {
      key: 'findings',
      label: 'Findings',
      layout: 'table',
      minRows: 1,
      fields: [
        { key: 'component', label: 'Component', type: 'TEXT', required: true },
        {
          key: 'severity',
          label: 'Severity',
          type: 'RADIO',
          options: ['Critical', 'Major'],
          required: true,
        },
      ],
    },
  ],
}

const complete = {
  workDone: 'Adjusted brake and greased rope',
  hourMeter: '120.5',
  safeToOperate: 'Yes',
  findings: [{ component: 'Hoist brake', severity: 'Major' }],
}

describe('template answers', () => {
  it('accepts a complete report and coerces the number', () => {
    const parsed = templateDataSchema(template).safeParse(complete)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.hourMeter).toBe(120.5)
  })

  it('requires a required number to actually be answered', () => {
    const parsed = templateDataSchema(template).safeParse({ ...complete, hourMeter: '' })
    expect(parsed.success).toBe(false)
  })

  it('rejects a missing required answer', () => {
    const parsed = templateDataSchema(template).safeParse({ ...complete, workDone: ' ' })
    expect(parsed.success).toBe(false)
  })

  it('drops rows that were added but never filled in, then checks minRows', () => {
    const parsed = templateDataSchema(template).safeParse({
      ...complete,
      findings: [complete.findings[0], {}],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.findings).toHaveLength(1)

    const empty = templateDataSchema(template).safeParse({ ...complete, findings: [{}] })
    expect(empty.success).toBe(false)
  })

  it('treats an untouched table as empty, but not as satisfying minRows', () => {
    const optionalTable = templateDataSchema({
      sections: [{ ...template.sections[1]!, minRows: undefined }],
    })
    const parsed = optionalTable.safeParse({})
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.findings).toEqual([])

    expect(templateDataSchema({ sections: [template.sections[1]!] }).safeParse({}).success).toBe(
      false,
    )
  })

  it('strips answers the template does not declare', () => {
    const parsed = templateDataSchema(template).safeParse({ ...complete, smuggled: 'x' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect('smuggled' in parsed.data).toBe(false)
  })
})

const checklist = [
  { code: 'H-01', label: 'Brake', resultType: 'PASS_FAIL_NA', requiresMeasurement: false },
  { code: 'H-02', label: 'Lining', resultType: 'NUMBER', requiresMeasurement: true },
]

describe('checklist answers', () => {
  it('requires a result for a pass/fail item', () => {
    const parsed = checklistAnswersSchema(checklist).safeParse({
      'H-01': { result: null },
      'H-02': {},
    })
    expect(parsed.success).toBe(false)
  })

  it('requires a measurement when the item says so', () => {
    const parsed = checklistAnswersSchema(checklist).safeParse({
      'H-01': { result: 'Pass' },
      'H-02': { measurement: null },
    })
    expect(parsed.success).toBe(false)

    const answered = checklistAnswersSchema(checklist).safeParse({
      'H-01': { result: 'Pass' },
      'H-02': { measurement: 6.4 },
    })
    expect(answered.success).toBe(true)
  })
})

const fileId = '11111111-1111-4111-8111-111111111111'

function submitInput(overrides: Record<string, unknown> = {}) {
  return {
    reportId: crypto.randomUUID(),
    jobId: 'job-1',
    craneId: 'crane-1',
    templateId: 'template-1',
    templateVersion: 1,
    data: complete,
    checklist: { 'H-01': { result: 'Pass' }, 'H-02': { measurement: 6.4 } },
    parts: [],
    photoFileIds: [],
    technicianSignerName: 'Ahmad',
    technicianSignatureFileId: fileId,
    customerSignerName: 'Mei Ling',
    customerSignerDesignation: 'Supervisor',
    customerSignatureFileId: fileId,
    customerDeclinedReason: null,
    ...overrides,
  }
}

describe('submitting a report', () => {
  const schema = reportSubmitSchema(template, checklist)

  it('accepts a signed report', () => {
    expect(schema.safeParse(submitInput()).success).toBe(true)
  })

  it('accepts a customer who did not sign, provided there is a reason', () => {
    const parsed = schema.safeParse(
      submitInput({
        customerSignatureFileId: null,
        customerSignerName: null,
        customerDeclinedReason: 'Site closed, keys left at the guardhouse.',
      }),
    )
    expect(parsed.success).toBe(true)
  })

  it('refuses a report with neither a signature nor a reason', () => {
    expect(
      schema.safeParse(
        submitInput({
          customerSignatureFileId: null,
          customerSignerName: null,
          customerDeclinedReason: '',
        }),
      ).success,
    ).toBe(false)
  })

  it('refuses both a signature and a decline reason', () => {
    expect(
      schema.safeParse(submitInput({ customerDeclinedReason: 'Not available' })).success,
    ).toBe(false)
  })

  it('refuses a customer signature with no name against it', () => {
    expect(
      schema.safeParse(submitInput({ customerSignerName: '' })).success,
    ).toBe(false)
  })

  it('refuses a report with no technician signature', () => {
    expect(schema.safeParse(submitInput({ technicianSignatureFileId: '' })).success).toBe(false)
  })
})
