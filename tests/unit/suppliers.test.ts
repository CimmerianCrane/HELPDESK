import { describe, expect, it } from 'vitest'
import { createSupplierSchema, updateSupplierSchema } from '@/lib/validation/suppliers'
import { ROLE_CAPABILITIES, can } from '@/server/auth/permissions'

/**
 * The supplier book's pure rules (slice 27). The service's refusals are the integration suite's job;
 * what is pinned here is the form's shape: a blank email is absent rather than invalid, a blank lead
 * time is absent rather than zero, and a missing "Active" box means retired.
 */

const valid = { name: 'Sin Heng Lifting Supplies' }

describe('the supplier form', () => {
  it('treats blank optional fields as absent', () => {
    const parsed = createSupplierSchema.parse({
      ...valid,
      contactName: '',
      phone: '',
      email: '',
      leadTimeDays: '',
      notes: '',
    })

    expect(parsed).toMatchObject({
      name: 'Sin Heng Lifting Supplies',
      contactName: null,
      phone: null,
      email: null,
      leadTimeDays: null,
      notes: null,
    })
  })

  it('reads an absent Active box as retired', () => {
    expect(createSupplierSchema.parse(valid).isActive).toBe(false)
    expect(createSupplierSchema.parse({ ...valid, isActive: 'on' }).isActive).toBe(true)
  })

  it('coerces a lead time typed as a string, and refuses a fraction of a day', () => {
    expect(createSupplierSchema.parse({ ...valid, leadTimeDays: '10' }).leadTimeDays).toBe(10)
    const fraction = updateSupplierSchema.safeParse({ ...valid, leadTimeDays: '1.5' })
    expect(fraction.success).toBe(false)
  })

  it('refuses an email that is not an address, and a missing name', () => {
    expect(createSupplierSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false)
    expect(createSupplierSchema.safeParse({ name: '  ' }).success).toBe(false)
  })
})

describe('who maintains the supplier book', () => {
  it('is the storekeeper, and only the storekeeper, who writes suppliers', () => {
    expect(can('STOREKEEPER', 'supplier.write')).toBe(true)
    expect(can('DISPATCHER', 'supplier.write')).toBe(false)
    expect(can('FINANCE', 'supplier.write')).toBe(false)
    expect(can('TECHNICIAN', 'supplier.write')).toBe(false)
  })

  // Reads are gated on `part.read` — the book is a view of the catalogue, not a separate register —
  // so a role that may write suppliers without reading them would be able to edit what it cannot see.
  it('never grants the write without the catalogue read that serves the book', () => {
    for (const role of Object.keys(ROLE_CAPABILITIES) as Array<keyof typeof ROLE_CAPABILITIES>) {
      if (!can(role, 'supplier.write')) continue
      expect(can(role, 'part.read'), `${role} writes suppliers but cannot read parts`).toBe(true)
    }
  })
})
