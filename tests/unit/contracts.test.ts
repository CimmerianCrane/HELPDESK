import { describe, expect, it } from 'vitest'
import {
  contractCoversCranes,
  createContractSchema,
  renewalState,
  slaOverridesFrom,
} from '@/lib/validation/contracts'

/**
 * The contract schema is the trust boundary for the contract form (CLAUDE.md rule 9). The cases that
 * matter are the ones a browser actually sends: blank optional boxes, one half of an SLA pair, and a
 * repeated checkbox name that collapses to a bare string when only one crane is ticked.
 */

const base = {
  type: 'AMC',
  reference: '',
  startDate: '',
  endDate: '',
  renewalDate: '',
  includedVisits: '',
  scopeNotes: '',
  slaP1Response: '',
  slaP1Resolution: '',
  slaP2Response: '',
  slaP2Resolution: '',
  slaP3Response: '',
  slaP3Resolution: '',
  slaP4Response: '',
  slaP4Resolution: '',
}

function parse(overrides: Record<string, unknown> = {}) {
  return createContractSchema.safeParse({ ...base, ...overrides })
}

describe('createContractSchema', () => {
  it('turns every blank optional box into null', () => {
    const result = parse()
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toMatchObject({
      type: 'AMC',
      reference: null,
      startDate: null,
      endDate: null,
      renewalDate: null,
      includedVisits: null,
      scopeNotes: null,
      coveredCraneIds: [],
    })
    expect(result.data.startDate).toBeNull()
  })

  it('reads a date box as UTC midnight', () => {
    const result = parse({ startDate: '2026-01-15' })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.startDate?.toISOString()).toBe('2026-01-15T00:00:00.000Z')
  })

  it('refuses an end date before the start', () => {
    const result = parse({ startDate: '2026-02-01', endDate: '2026-01-01' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.path).toEqual(['endDate'])
  })

  it('refuses half an SLA pair', () => {
    const result = parse({ slaP1Response: '30' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.path).toEqual(['slaP1Response'])
  })

  it('refuses a resolution quicker than the response', () => {
    const result = parse({ slaP1Response: '240', slaP1Resolution: '30' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.path).toEqual(['slaP1Resolution'])
  })

  it('dedupes repeated checkbox values', () => {
    const result = parse({ coveredCraneIds: ['crane-a', 'crane-a', ' crane-b '] })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.coveredCraneIds).toEqual(['crane-a', 'crane-b'])
  })

  it('treats a single ticked checkbox as a one-item list', () => {
    const result = parse({ coveredCraneIds: 'crane-a' })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.coveredCraneIds).toEqual(['crane-a'])
  })
})

describe('slaOverridesFrom', () => {
  it('keeps only the priorities filled in on both sides', () => {
    const result = parse({
      slaP1Response: '30',
      slaP1Resolution: '240',
      slaP3Response: '480',
      slaP3Resolution: '2880',
    })
    if (!result.success) throw new Error('expected a valid contract')
    expect(slaOverridesFrom(result.data)).toEqual({
      P1: { responseMinutes: 30, resolutionMinutes: 240 },
      P3: { responseMinutes: 480, resolutionMinutes: 2880 },
    })
  })
})

describe('renewalState', () => {
  const now = new Date('2026-10-29T09:30:00.000Z')

  it('is none without a renewal date', () => {
    expect(renewalState(null, now)).toBe('none')
  })

  it('is due inside 90 days and overdue once the day has passed', () => {
    expect(renewalState(new Date('2026-12-01T00:00:00.000Z'), now)).toBe('due')
    expect(renewalState(new Date('2027-06-01T00:00:00.000Z'), now)).toBe('none')
    expect(renewalState(new Date('2026-10-01T00:00:00.000Z'), now)).toBe('overdue')
  })

  it('treats today as due, not overdue', () => {
    expect(renewalState(new Date('2026-10-29T00:00:00.000Z'), now)).toBe('due')
  })
})

describe('contractCoversCranes', () => {
  it('covers the whole account when it names no cranes', () => {
    expect(contractCoversCranes([], ['crane-a'])).toBe(true)
  })

  it('covers only the cranes it names', () => {
    expect(contractCoversCranes(['crane-a'], ['crane-a'])).toBe(true)
    expect(contractCoversCranes(['crane-a'], ['crane-b'])).toBe(false)
  })
})
