import { describe, expect, it } from 'vitest'
import { companySlaSchema, companyTargetsFrom } from '@/lib/validation/sla'

/**
 * The company-wide SLA form is a trust boundary like every other (CLAUDE.md rule 9). What a browser
 * sends is strings, and the numbers have to end up as four priorities with a resolution no quicker
 * than their response — the one property that makes an SLA mean anything.
 */

const base = {
  responseP1: '30',
  resolutionP1: '240',
  responseP2: '120',
  resolutionP2: '480',
  responseP3: '480',
  resolutionP3: '2880',
  responseP4: '1440',
  resolutionP4: '7200',
}

function parse(overrides: Record<string, unknown> = {}) {
  return companySlaSchema.safeParse({ ...base, ...overrides })
}

describe('companySlaSchema', () => {
  it('coerces the strings a form sends into whole minutes', () => {
    const result = parse()
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.responseP1).toBe(30)
    expect(result.data.resolutionP4).toBe(7200)
  })

  it('refuses a resolution quicker than its response, naming that field', () => {
    const result = parse({ resolutionP1: '10' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.path).toEqual(['resolutionP1'])
  })

  it('refuses a fractional or zero target', () => {
    expect(parse({ responseP2: '1.5' }).success).toBe(false)
    expect(parse({ responseP2: '0' }).success).toBe(false)
  })

  it('refuses a missing priority rather than defaulting it', () => {
    const withoutP3 = { ...base } as Partial<typeof base>
    delete withoutP3.responseP3
    expect(companySlaSchema.safeParse(withoutP3).success).toBe(false)
  })
})

describe('companyTargetsFrom', () => {
  it('produces one target per priority, in order', () => {
    const result = parse()
    if (!result.success) throw new Error('expected valid targets')
    expect(companyTargetsFrom(result.data)).toEqual([
      { priority: 'P1', responseMinutes: 30, resolutionMinutes: 240 },
      { priority: 'P2', responseMinutes: 120, resolutionMinutes: 480 },
      { priority: 'P3', responseMinutes: 480, resolutionMinutes: 2880 },
      { priority: 'P4', responseMinutes: 1440, resolutionMinutes: 7200 },
    ])
  })
})
