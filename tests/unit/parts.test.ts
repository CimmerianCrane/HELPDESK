import { describe, expect, it } from 'vitest'
import { createLocationSchema } from '@/lib/validation/locations'
import {
  createPartSchema,
  locationBalances,
  movementSigns,
  needsReorder,
  partFilterSchema,
  stockEntrySchema,
  transferSchema,
} from '@/lib/validation/parts'

/**
 * The parts book's rules, kept pure so they can be pinned without a database (slice 22).
 *
 * Two of them decide whether stock is right: what direction a movement pushes, and whether a part
 * counts as below its reorder level. Getting the first wrong moves stock the wrong way in every
 * report ever filed.
 */

describe('movement direction', () => {
  it('takes an issue out of its source and puts nothing anywhere', () => {
    expect(movementSigns('ISSUE', true)).toEqual({ from: -1, to: 0 })
  })

  it('puts a receipt and a return into the target', () => {
    expect(movementSigns('RECEIVE', false)).toEqual({ from: 0, to: 1 })
    expect(movementSigns('RETURN', false)).toEqual({ from: 0, to: 1 })
  })

  it('moves a writeoff out of its source', () => {
    expect(movementSigns('WRITEOFF', true)).toEqual({ from: -1, to: 0 })
  })

  it('moves a transfer from one location to the other', () => {
    expect(movementSigns('TRANSFER', true)).toEqual({ from: -1, to: 1 })
  })

  /** A stock take records a find: an adjustment with no source adds, one with a source moves. */
  it('lets an adjustment be either side depending on whether a source was named', () => {
    expect(movementSigns('ADJUST', false)).toEqual({ from: 0, to: 1 })
    expect(movementSigns('ADJUST', true)).toEqual({ from: -1, to: 1 })
  })
})

describe('reorder level', () => {
  it('flags a part under its level, and not one at it', () => {
    expect(needsReorder(9.999, 10)).toBe(true)
    expect(needsReorder(10, 10)).toBe(false)
    expect(needsReorder(11, 10)).toBe(false)
  })

  it('flags a part with nothing left in stock', () => {
    expect(needsReorder(0, 1)).toBe(true)
  })

  /** A part that has gone negative was issued without being received; that is worth a flag too. */
  it('flags negative stock', () => {
    expect(needsReorder(-2, null)).toBe(false)
    expect(needsReorder(-2, 5)).toBe(true)
  })

  it('never flags a part nobody set a level for', () => {
    expect(needsReorder(0, null)).toBe(false)
  })
})

describe('a part as the office types it', () => {
  const valid = {
    partNumber: ' wr-13-6x36 ',
    description: 'Wire rope 13 mm',
    brand: '',
    compatibleModels: ' Konecranes , Demag ,, ',
    uom: 'm',
    cost: '5.40',
    sellPrice: '9.80',
    reorderLevel: '50',
    reorderQty: '',
    trackSerialOrBatch: 'on',
  }

  it('upper-cases the part number, trims the models and shapes the numbers', () => {
    const parsed = createPartSchema.parse(valid)
    expect(parsed.partNumber).toBe('WR-13-6X36')
    expect(parsed.compatibleModels).toEqual(['Konecranes', 'Demag'])
    expect(parsed.cost).toBe(5.4)
    expect(parsed.reorderLevel).toBe(50)
    expect(parsed.reorderQty).toBeNull()
    expect(parsed.brand).toBeNull()
    expect(parsed.trackSerialOrBatch).toBe(true)
  })

  it('rounds money to the cent and quantities to the ledger’s three decimals', () => {
    const parsed = createPartSchema.parse({
      ...valid,
      cost: '5.409',
      reorderLevel: '12.3456',
    })
    expect(parsed.cost).toBe(5.41)
    expect(parsed.reorderLevel).toBe(12.346)
  })

  it('refuses a part with no number, no description or a negative price', () => {
    expect(createPartSchema.safeParse({ ...valid, partNumber: ' ' }).success).toBe(false)
    expect(createPartSchema.safeParse({ ...valid, description: '' }).success).toBe(false)
    expect(createPartSchema.safeParse({ ...valid, cost: '-1' }).success).toBe(false)
  })
})

describe('a stock entry', () => {
  it('refuses a negative quantity and a movement type the store cannot post', () => {
    expect(stockEntrySchema.safeParse({ type: 'RECEIVE', quantity: '-1' }).success).toBe(false)
    expect(stockEntrySchema.safeParse({ type: 'ISSUE', quantity: '1' }).success).toBe(false)
  })

  it('reads blank optional fields as absent rather than empty strings', () => {
    const parsed = stockEntrySchema.parse({
      type: 'ADJUST',
      quantity: '0',
      locationId: '',
      serialOrBatch: '',
      reasonCode: '',
      unitCost: '',
    })
    expect(parsed).toMatchObject({
      type: 'ADJUST',
      quantity: 0,
      locationId: null,
      reasonCode: null,
      unitCost: null,
    })
  })
})

/**
 * A serial's whereabouts, from the movements carrying it (slice 24).
 *
 * The trace reads one serial's rows and applies the same direction table the ledger uses, so a rope
 * cannot read as being in the van while the part's own on-hand says otherwise.
 */
describe('where one serial is', () => {
  const row = (
    type: 'RECEIVE' | 'ISSUE' | 'TRANSFER' | 'RETURN' | 'WRITEOFF',
    quantity: number,
    fromLocationId: string | null,
    toLocationId: string | null,
  ) => ({ type, quantity, fromLocationId, toLocationId })

  it('receives into a location and issues out of it', () => {
    const balances = locationBalances([
      row('RECEIVE', 10, null, 'store'),
      row('ISSUE', 3, 'store', null),
    ])
    expect(balances.get('store')).toBe(7)
  })

  it('follows a transfer rather than counting it twice', () => {
    const balances = locationBalances([
      row('RECEIVE', 5, null, 'store'),
      row('TRANSFER', 5, 'store', 'van'),
    ])
    // The store's position is zero and is dropped by the caller, not left as a phantom row.
    expect(balances.get('store')).toBe(0)
    expect(balances.get('van')).toBe(5)
  })

  it('lets an issue go negative, exactly as the part level does', () => {
    const balances = locationBalances([row('ISSUE', 2, 'store', null)])
    expect(balances.get('store')).toBe(-2)
  })

  it('rounds to the ledger’s three decimals so no float trails a serial', () => {
    const balances = locationBalances([
      row('RECEIVE', 0.1, null, 'store'),
      row('RECEIVE', 0.2, null, 'store'),
    ])
    expect(balances.get('store')).toBe(0.3)
  })
})

describe('part filters', () => {
  it('treats any level other than "below" as no filter', () => {
    expect(partFilterSchema.parse({ level: 'below' }).level).toBe('below')
    expect(partFilterSchema.parse({ level: '' }).level).toBeNull()
    expect(partFilterSchema.parse({}).level).toBeNull()
  })
})

describe('a transfer', () => {
  it('needs both ends named and two different places', () => {
    expect(transferSchema.safeParse({ fromLocationId: 'a', toLocationId: 'a', quantity: '1' }).success).toBe(false)
    expect(transferSchema.safeParse({ fromLocationId: '', toLocationId: 'b', quantity: '1' }).success).toBe(false)
    expect(transferSchema.safeParse({ fromLocationId: 'a', toLocationId: '', quantity: '1' }).success).toBe(false)
    expect(transferSchema.safeParse({ fromLocationId: 'a', toLocationId: 'b', quantity: '1' }).success).toBe(true)
  })

  it('refuses a zero or negative quantity', () => {
    expect(transferSchema.safeParse({ fromLocationId: 'a', toLocationId: 'b', quantity: '0' }).success).toBe(false)
    expect(transferSchema.safeParse({ fromLocationId: 'a', toLocationId: 'b', quantity: '-3' }).success).toBe(false)
  })

  it('reads a blank serial or reason as absent', () => {
    const parsed = transferSchema.parse({
      fromLocationId: 'a',
      toLocationId: 'b',
      quantity: '2',
      serialOrBatch: '',
      reasonCode: '',
    })
    expect(parsed.serialOrBatch).toBeNull()
    expect(parsed.reasonCode).toBeNull()
  })
})

describe('a location as the store types it', () => {
  const valid = { name: ' Bridge store ', type: 'WAREHOUSE', parentId: '', isActive: 'on' }

  it('trims the name, reads the kind and defaults to active', () => {
    expect(createLocationSchema.parse(valid)).toEqual({
      name: 'Bridge store',
      type: 'WAREHOUSE',
      parentId: null,
      isActive: true,
    })
  })

  /** An unticked checkbox sends nothing, and a location nobody ticked should not be active. */
  it('reads a missing checkbox as retired', () => {
    expect(createLocationSchema.parse({ ...valid, isActive: undefined }).isActive).toBe(false)
  })

  it('refuses a blank name and a kind that is not a location type', () => {
    expect(createLocationSchema.safeParse({ ...valid, name: ' ' }).success).toBe(false)
    expect(createLocationSchema.safeParse({ ...valid, type: 'GARAGE' }).success).toBe(false)
  })
})
