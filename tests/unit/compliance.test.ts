import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import {
  createComplianceRuleSchema,
  isRuleInForce,
} from '@/lib/validation/compliance'

/**
 * The compliance rule schema and the "is it in force" comparison (slice 14), without a database.
 *
 * Both halves are load-bearing: the schema is what stops a rule being recorded without the paperwork
 * it came from, and `isRuleInForce` is the single answer the admin list and the adoption check share.
 */

const day = (iso: string) => new Date(`${iso}T00:00:00Z`)

function rule(overrides: Record<string, unknown> = {}) {
  return {
    craneType: 'OVERHEAD',
    scheduleType: 'ANNUAL_EXAMINATION',
    intervalMonths: '12',
    requiresAE: 'on',
    isActive: 'on',
    sourceReference: 'MOM circular 2026/03, reviewed with the AE',
    reviewedAt: '2026-10-01',
    ...overrides,
  }
}

describe('createComplianceRuleSchema', () => {
  it('accepts a complete rule and reads the dates as UTC days', () => {
    const result = createComplianceRuleSchema.parse(rule())

    expect(result.intervalMonths).toBe(12)
    expect(result.requiresAE).toBe(true)
    expect(result.sourceReference).toBe('MOM circular 2026/03, reviewed with the AE')
    expect(result.reviewedAt.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(result.effectiveFrom).toBeNull()
  })

  it('refuses a rule with no source reference', () => {
    const error = createComplianceRuleSchema.safeParse(rule({ sourceReference: '  ' })).error
    expect(error).toBeInstanceOf(ZodError)
    expect((error as ZodError).issues[0]?.path).toEqual(['sourceReference'])
  })

  it('refuses a rule that was never reviewed, because nobody signed it off', () => {
    const error = createComplianceRuleSchema.safeParse(rule({ reviewedAt: '' })).error
    expect(error).toBeInstanceOf(ZodError)
    expect((error as ZodError).issues[0]?.path).toEqual(['reviewedAt'])
  })

  it('refuses a rule that stops applying before it starts', () => {
    const error = createComplianceRuleSchema.safeParse(
      rule({ effectiveFrom: '2026-10-01', effectiveTo: '2026-09-01' }),
    ).error
    expect(error).toBeInstanceOf(ZodError)
    expect((error as ZodError).issues[0]?.path).toEqual(['effectiveTo'])
  })

  it('treats an unticked checkbox as false rather than as absent', () => {
    const result = createComplianceRuleSchema.parse(rule({ requiresAE: '', isActive: '' }))
    expect(result.requiresAE).toBe(false)
    expect(result.isActive).toBe(false)
  })
})

describe('isRuleInForce', () => {
  const now = new Date('2026-10-28T09:30:00Z')

  it('is in force when active and undated', () => {
    expect(isRuleInForce({ isActive: true, effectiveFrom: null, effectiveTo: null }, now)).toBe(true)
  })

  it('is not in force when someone has stopped it', () => {
    expect(
      isRuleInForce({ isActive: false, effectiveFrom: null, effectiveTo: null }, now),
    ).toBe(false)
  })

  it('starts on its from date, inclusive', () => {
    const from = day('2026-10-28')
    // The comparison is by calendar day, so the time of day `now` carries does not matter.
    expect(isRuleInForce({ isActive: true, effectiveFrom: from, effectiveTo: null }, now)).toBe(true)
    expect(
      isRuleInForce({ isActive: true, effectiveFrom: day('2026-10-29'), effectiveTo: null }, now),
    ).toBe(false)
  })

  it('still applies on its end date, inclusive', () => {
    expect(
      isRuleInForce({ isActive: true, effectiveFrom: null, effectiveTo: day('2026-10-28') }, now),
    ).toBe(true)
    expect(
      isRuleInForce({ isActive: true, effectiveFrom: null, effectiveTo: day('2026-10-27') }, now),
    ).toBe(false)
  })
})
