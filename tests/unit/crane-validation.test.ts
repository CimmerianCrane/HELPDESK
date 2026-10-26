import { describe, expect, it } from 'vitest'
import { createCraneSchema, craneFilterSchema, restrictCraneSchema } from '@/lib/validation/cranes'
import { createSiteSchema } from '@/lib/validation/sites'
import {
  generateQrValue,
  isCraneQrValue,
  craneQrPayload,
  suggestAssetTag,
} from '@/server/cranes/qr'

/**
 * The crane and site input contracts, and the QR token. These are the rules a register entry has to
 * satisfy before anything reaches the database.
 */

function craneInput(overrides: Record<string, unknown> = {}) {
  return {
    customerId: 'customer-1',
    siteId: 'site-1',
    type: 'OVERHEAD',
    swlKg: '5000',
    ...overrides,
  }
}

describe('createCraneSchema', () => {
  it('accepts the minimum a crane needs and coerces the SWL to a number', () => {
    const parsed = createCraneSchema.parse(craneInput())

    expect(parsed.swlKg).toBe(5000)
    expect(parsed.type).toBe('OVERHEAD')
    expect(parsed.assetTag).toBeNull()
  })

  it('rejects a missing or zero safe working load', () => {
    expect(createCraneSchema.safeParse(craneInput({ swlKg: '' })).success).toBe(false)
    expect(createCraneSchema.safeParse(craneInput({ swlKg: '0' })).success).toBe(false)
    expect(createCraneSchema.safeParse(craneInput({ swlKg: '-100' })).success).toBe(false)
  })

  it('rejects an unknown crane type', () => {
    expect(createCraneSchema.safeParse(craneInput({ type: 'SPACESHIP' })).success).toBe(false)
  })

  it('reads a blank year as "not recorded" rather than zero', () => {
    expect(createCraneSchema.parse(craneInput({ yearOfManufacture: '' })).yearOfManufacture).toBeNull()
  })

  it('rejects a year that cannot be a manufacture year', () => {
    expect(createCraneSchema.safeParse(craneInput({ yearOfManufacture: '12' })).success).toBe(false)
  })

  it('stores a registration date as UTC midnight on that calendar day', () => {
    const parsed = createCraneSchema.parse(craneInput({ registrationDate: '2024-03-01' }))
    expect(parsed.registrationDate?.toISOString()).toBe('2024-03-01T00:00:00.000Z')
  })

  it('rejects a date that is not YYYY-MM-DD', () => {
    expect(createCraneSchema.safeParse(craneInput({ registrationDate: '01/03/2024' })).success).toBe(
      false,
    )
    // Valid shape, impossible day.
    expect(createCraneSchema.safeParse(craneInput({ registrationDate: '2024-02-31' })).success).toBe(
      false,
    )
  })
})

describe('restrictCraneSchema', () => {
  it('requires a reason', () => {
    expect(restrictCraneSchema.safeParse({ reason: '' }).success).toBe(false)
    expect(restrictCraneSchema.safeParse({ reason: '   ' }).success).toBe(false)
    expect(restrictCraneSchema.parse({ reason: 'Broken wire rope' }).reason).toBe('Broken wire rope')
  })
})

describe('craneFilterSchema', () => {
  it('treats an empty or unknown filter as "no filter" where that is safe', () => {
    const parsed = craneFilterSchema.parse({ q: '', status: '', type: '' })
    expect(parsed.status).toBeNull()
    expect(parsed.type).toBeNull()
    expect(parsed.q).toBe('')
  })

  it('rejects a nonsense status rather than silently ignoring it', () => {
    expect(craneFilterSchema.safeParse({ status: 'BANANA' }).success).toBe(false)
  })
})

describe('createSiteSchema', () => {
  it('accepts a name and nothing else', () => {
    const parsed = createSiteSchema.parse({ customerId: 'c1', name: 'Tuas Workshop' })
    expect(parsed.name).toBe('Tuas Workshop')
    expect(parsed.latitude).toBeNull()
  })

  it('reads blank coordinates as "not recorded"', () => {
    const parsed = createSiteSchema.parse({ customerId: 'c1', name: 'X', latitude: '', longitude: '' })
    expect(parsed.latitude).toBeNull()
    expect(parsed.longitude).toBeNull()
  })

  it('rejects coordinates outside the real range', () => {
    // A transposed latitude/longitude pair is caught here rather than becoming a site in the ocean.
    expect(
      createSiteSchema.safeParse({ customerId: 'c1', name: 'X', latitude: '120' }).success,
    ).toBe(false)
    expect(
      createSiteSchema.safeParse({ customerId: 'c1', name: 'X', longitude: '200' }).success,
    ).toBe(false)
  })
})

describe('crane QR identities', () => {
  it('generates a token in the documented shape', () => {
    const value = generateQrValue()
    expect(isCraneQrValue(value)).toBe(true)
    expect(value).toHaveLength(15)
  })

  it('does not use characters that are ambiguous when read off a damaged label', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(generateQrValue()).not.toMatch(/[ILOU]/)
    }
  })

  it('is not the same twice', () => {
    const values = new Set(Array.from({ length: 200 }, () => generateQrValue()))
    expect(values.size).toBe(200)
  })

  it('rejects a token that is not one of ours', () => {
    expect(isCraneQrValue('CRN123')).toBe(false)
    expect(isCraneQrValue('crn0123456789ab')).toBe(false)
    expect(isCraneQrValue('../../etc/passwd')).toBe(false)
  })

  it('puts a resolvable URL in the QR code, without doubling a trailing slash', () => {
    expect(craneQrPayload(generateQrValue(), 'https://cranes.example.com')).toMatch(
      /^https:\/\/cranes\.example\.com\/c\/CRN[0-9A-HJKMNP-TV-Z]{12}$/,
    )
    expect(craneQrPayload('CRNABCDEFGHJKM', 'https://cranes.example.com/')).toBe(
      'https://cranes.example.com/c/CRNABCDEFGHJKM',
    )
  })

  it('suggests an asset tag when the office leaves the field blank', () => {
    expect(suggestAssetTag()).toMatch(/^CC-[0-9A-HJKMNP-TV-Z]{6}$/)
  })
})
