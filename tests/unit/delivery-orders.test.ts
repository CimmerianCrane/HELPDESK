import { describe, expect, it } from 'vitest'
import {
  createDeliveryOrderSchema,
  deliveryStatusFor,
  isOutstandingLoan,
  receiveDeliveryOrderSchema,
  returnDeliveryOrderSchema,
} from '@/lib/validation/delivery-orders'

/**
 * The delivery order rules that are pure, so they need no database (slice 18).
 *
 * Status and "outstanding" are derived from the lines rather than posted by the form, which is why
 * they are worth a test: a form that posted a status could disagree with the quantities it posted.
 */

describe('deliveryStatusFor', () => {
  it('is PARTIAL while anything is short', () => {
    expect(
      deliveryStatusFor([
        { quantity: 2, received: 2 },
        { quantity: 3, received: 1 },
      ]),
    ).toBe('PARTIAL')
  })

  it('is DELIVERED once every line is whole', () => {
    expect(
      deliveryStatusFor([
        { quantity: 2, received: 2 },
        { quantity: 3, received: 3 },
      ]),
    ).toBe('DELIVERED')
  })

  it('treats an over-receipt as delivered, never as partial', () => {
    // The service refuses an over-receipt, so this only guards against a backwards comparison.
    expect(deliveryStatusFor([{ quantity: 2, received: 5 }])).toBe('DELIVERED')
  })
})

describe('isOutstandingLoan', () => {
  it('is only true for loan equipment that has not all come back', () => {
    expect(isOutstandingLoan({ chargeType: 'LOAN', quantity: 2, returned: 1 })).toBe(true)
    expect(isOutstandingLoan({ chargeType: 'LOAN', quantity: 2, returned: 2 })).toBe(false)
  })

  it('never chases a chargeable or warranty line', () => {
    expect(isOutstandingLoan({ chargeType: 'CHARGEABLE', quantity: 2, returned: 0 })).toBe(false)
    expect(isOutstandingLoan({ chargeType: 'WARRANTY', quantity: 2, returned: 0 })).toBe(false)
  })
})

describe('createDeliveryOrderSchema', () => {
  it('accepts one line with the defaults filled in', () => {
    const parsed = createDeliveryOrderSchema.parse({
      jobId: 'job_1',
      lines: [{ movementId: 'm_1', condition: '', expectedReturnDate: '' }],
    })

    expect(parsed.lines).toHaveLength(1)
    expect(parsed.lines[0]).toMatchObject({
      chargeType: 'CHARGEABLE',
      condition: null,
      expectedReturnDate: null,
    })
  })

  it('refuses an empty delivery — a DO with no parts is not paperwork for anything', () => {
    expect(() => createDeliveryOrderSchema.parse({ jobId: 'job_1', lines: [] })).toThrow()
  })

  it('reads an expected return date as UTC midnight, the way schedules do', () => {
    const parsed = createDeliveryOrderSchema.parse({
      jobId: 'job_1',
      lines: [{ movementId: 'm_1', chargeType: 'LOAN', expectedReturnDate: '2026-11-04' }],
    })

    expect(parsed.lines[0]!.expectedReturnDate?.toISOString()).toBe('2026-11-04T00:00:00.000Z')
  })

  it('refuses a date that is not a real calendar day', () => {
    expect(() =>
      createDeliveryOrderSchema.parse({
        jobId: 'job_1',
        lines: [{ movementId: 'm_1', expectedReturnDate: '2026-02-30' }],
      }),
    ).toThrow()
  })

  it('refuses a terms value the enum does not have', () => {
    expect(() =>
      createDeliveryOrderSchema.parse({
        jobId: 'job_1',
        lines: [{ movementId: 'm_1', chargeType: 'FREEBIE' }],
      }),
    ).toThrow()
  })
})

describe('receiveDeliveryOrderSchema', () => {
  const valid = {
    receiverName: 'Site foreman',
    signatureFileId: '11111111-1111-4111-8111-111111111111',
    lines: [{ lineId: 'l_1', received: '2' }],
  }

  it('coerces the posted quantity string', () => {
    expect(receiveDeliveryOrderSchema.parse(valid).lines[0]!.received).toBe(2)
  })

  it('requires a signature — a receipt without one is a claim, not evidence', () => {
    expect(() => receiveDeliveryOrderSchema.parse({ ...valid, signatureFileId: '' })).toThrow()
    expect(() =>
      receiveDeliveryOrderSchema.parse({ ...valid, signatureFileId: 'not-a-uuid' }),
    ).toThrow()
  })

  it('requires a name for whoever took the parts', () => {
    expect(() => receiveDeliveryOrderSchema.parse({ ...valid, receiverName: '   ' })).toThrow()
  })

  it('refuses a negative quantity', () => {
    expect(() =>
      receiveDeliveryOrderSchema.parse({ ...valid, lines: [{ lineId: 'l_1', received: '-1' }] }),
    ).toThrow()
  })
})

describe('returnDeliveryOrderSchema', () => {
  it('accepts a return with no note', () => {
    const parsed = returnDeliveryOrderSchema.parse({
      lines: [{ lineId: 'l_1', returned: '1' }],
      note: '',
    })
    expect(parsed.note).toBeNull()
  })

  it('refuses a return of nothing at all', () => {
    expect(() => returnDeliveryOrderSchema.parse({ lines: [] })).toThrow()
  })
})
