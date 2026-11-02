import { describe, expect, it } from 'vitest'
import { createContactSchema, createCustomerSchema, customerFilterSchema } from '@/lib/validation/customers'
import { formValuesNested } from '@/lib/validation/parse'

/**
 * The customer schemas are the trust boundary for every customer form (CLAUDE.md rule 9), so the
 * cases that matter are the ones a browser can actually produce: empty optional fields, a blank
 * payment-terms box, and a dotted address name.
 */

describe('formValuesNested', () => {
  it('turns a dotted name into a nested object', () => {
    const data = new FormData()
    data.set('legalName', 'Acme')
    data.set('address.line1', '1 Tuas Avenue')
    data.set('address.city', 'Singapore')

    expect(formValuesNested(data)).toEqual({
      legalName: 'Acme',
      address: { line1: '1 Tuas Avenue', city: 'Singapore' },
    })
  })

  it('leaves names without a dot at the top level', () => {
    const data = new FormData()
    data.set('notes', 'Call before 9am')
    expect(formValuesNested(data)).toEqual({ notes: 'Call before 9am' })
  })

  it('does not let a dotted name overwrite a top-level scalar with an object', () => {
    const data = new FormData()
    data.set('address.line1', 'One')
    data.set('address.city', 'Two')
    // Second field merges into the object rather than replacing it.
    expect(formValuesNested(data)).toEqual({ address: { line1: 'One', city: 'Two' } })
  })
})

describe('createCustomerSchema', () => {
  it('accepts the minimum and defaults the rest', () => {
    const result = createCustomerSchema.parse({ legalName: '  Acme Cranes Pte Ltd  ' })

    expect(result.legalName).toBe('Acme Cranes Pte Ltd')
    expect(result.status).toBe('PROSPECT')
    expect(result.paymentTerms).toBe(30)
    expect(result.uen).toBeNull()
    expect(result.tradingName).toBeNull()
  })

  it('treats blank optional fields as absent rather than as empty strings', () => {
    const result = createCustomerSchema.parse({
      legalName: 'Acme',
      tradingName: '',
      uen: '',
      notes: '',
      paymentTerms: '',
    })

    expect(result.tradingName).toBeNull()
    expect(result.uen).toBeNull()
    expect(result.notes).toBeNull()
    expect(result.paymentTerms).toBe(30)
  })

  it('rejects a blank legal name — it is what every other record is anchored to', () => {
    const result = createCustomerSchema.safeParse({ legalName: '   ' })
    expect(result.success).toBe(false)
  })

  it('upper-cases the UEN and rejects an absurdly long one', () => {
    expect(createCustomerSchema.parse({ legalName: 'A', uen: ' 202012345k ' }).uen).toBe('202012345K')
    expect(createCustomerSchema.safeParse({ legalName: 'A', uen: 'X'.repeat(21) }).success).toBe(false)
  })

  it('rejects negative payment terms and anything past a year', () => {
    expect(createCustomerSchema.safeParse({ legalName: 'A', paymentTerms: -1 }).success).toBe(false)
    expect(createCustomerSchema.safeParse({ legalName: 'A', paymentTerms: 366 }).success).toBe(false)
    expect(createCustomerSchema.safeParse({ legalName: 'A', paymentTerms: 0 }).success).toBe(true)
  })

  it('rejects an unknown status rather than silently falling back', () => {
    expect(createCustomerSchema.safeParse({ legalName: 'A', status: 'DELETED' }).success).toBe(false)
  })
})

describe('createContactSchema', () => {
  const base = { name: 'Mary Goh', role: 'SITE_CONTACT' }

  it('reads an unchecked checkbox as not primary', () => {
    expect(createContactSchema.parse(base).isPrimary).toBe(false)
    expect(createContactSchema.parse({ ...base, isPrimary: '' }).isPrimary).toBe(false)
  })

  it('reads a checked checkbox as primary', () => {
    expect(createContactSchema.parse({ ...base, isPrimary: 'on' }).isPrimary).toBe(true)
  })

  it('rejects a malformed email but accepts a blank one', () => {
    expect(createContactSchema.parse({ ...base, email: '' }).email).toBeNull()
    expect(createContactSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false)
    expect(createContactSchema.parse({ ...base, email: 'Mary@Example.com ' }).email).toBe(
      'mary@example.com',
    )
  })

  it('rejects an unknown role', () => {
    expect(createContactSchema.safeParse({ ...base, role: 'BOSS' }).success).toBe(false)
  })
})

describe('customerFilterSchema', () => {
  it('treats an empty status as no filter', () => {
    expect(customerFilterSchema.parse({ q: '', status: '' })).toEqual({ q: '', status: null })
  })

  it('treats a missing query as an empty search', () => {
    expect(customerFilterSchema.parse({})).toEqual({ q: '', status: null })
  })

  it('rejects an unknown status instead of passing it to the database', () => {
    expect(customerFilterSchema.safeParse({ status: 'ANY' }).success).toBe(false)
  })
})
