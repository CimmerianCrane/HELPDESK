import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_IMPORT_COLUMNS,
  importRowSchema,
  importRowValues,
  mapHeaders,
  normaliseHeader,
} from '@/lib/validation/import'

/**
 * The column contract. Its job is to be forgiving about how a human writes a header and strict about
 * what a row contains — those are different problems and are tested separately.
 */

describe('normaliseHeader', () => {
  it('ignores case, spaces, underscores and hyphens', () => {
    expect(normaliseHeader('Legal Name')).toBe('legalname')
    expect(normaliseHeader('legal_name')).toBe('legalname')
    expect(normaliseHeader('LEGAL-NAME')).toBe('legalname')
    expect(normaliseHeader('legalName')).toBe('legalname')
  })
})

describe('mapHeaders', () => {
  it('maps the headers it knows and lists the ones it does not', () => {
    const { mapping, unknown, missing } = mapHeaders(['Legal Name', 'Favourite Colour', 'uen'])

    expect([...mapping.values()]).toEqual(['legalName', 'uen'])
    expect(unknown).toEqual(['Favourite Colour'])
    expect(missing).toEqual([])
  })

  it('reports a missing required column', () => {
    const { missing } = mapHeaders(['name', 'uen'])
    expect(missing).toEqual(['legalName'])
  })

  it('accepts a file with only the required column', () => {
    const { mapping, missing } = mapHeaders(['legalName'])
    expect([...mapping.values()]).toEqual(['legalName'])
    expect(missing).toEqual([])
  })

  it('reports a second header claiming the same column instead of letting the last one win', () => {
    // Two columns for one field is a mistake in the file. Quietly taking one of them would import
    // whichever happened to come later; saying so lets the person fix the header row.
    const { mapping, unknown } = mapHeaders(['legalName', 'Legal Name'])

    expect(mapping.get('legalName')).toBe('legalName')
    expect(mapping.get('Legal Name')).toBeUndefined()
    expect(unknown).toEqual(['Legal Name'])
  })
})

describe('importRowSchema', () => {
  it('accepts a name-only row and applies the same defaults as a typed-in customer', () => {
    const parsed = importRowSchema.parse({ legalName: 'Acme Cranes' })
    const values = importRowValues(parsed)

    expect(values.legalName).toBe('Acme Cranes')
    expect(values.status).toBe('PROSPECT')
    expect(values.paymentTerms).toBe(30)
  })

  it('upper-cases a spreadsheet status', () => {
    const values = importRowValues(importRowSchema.parse({ legalName: 'Acme', status: 'active' }))
    expect(values.status).toBe('ACTIVE')
  })

  it('reports an unknown status as a validation failure, not a thrown error', () => {
    const parsed = importRowSchema.safeParse({ legalName: 'Acme', status: 'RETIRED' })

    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues[0]?.path).toEqual(['status'])
  })

  it('rejects a blank name with the same message the form gives', () => {
    const parsed = importRowSchema.safeParse({ legalName: '   ' })

    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues[0]?.message).toBe('Enter the customer’s legal name.')
  })

  it('treats an empty paymentTerms cell as "use the default"', () => {
    const values = importRowValues(importRowSchema.parse({ legalName: 'Acme', paymentTerms: '' }))
    expect(values.paymentTerms).toBe(30)
  })

  it('rejects payment terms outside the allowed range', () => {
    expect(importRowSchema.safeParse({ legalName: 'Acme', paymentTerms: '400' }).success).toBe(false)
  })
})

describe('the template contract', () => {
  it('lists legalName first, so a downloaded template reads naturally', () => {
    expect(CUSTOMER_IMPORT_COLUMNS[0]).toBe('legalName')
  })
})
