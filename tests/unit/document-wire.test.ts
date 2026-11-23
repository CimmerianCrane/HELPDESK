import { describe, expect, it } from 'vitest'
import { decodeFromWire, encodeForWire } from '@/lib/document-wire'

/**
 * The document-service wire format must be lossless, or an issued report re-renders differently from
 * the one that was stored. These are the three shapes that JSON alone would corrupt.
 */
describe('document wire format', () => {
  it('round-trips a Date through JSON without changing its instant', () => {
    const input = { createdAt: new Date('2026-10-27T02:15:00.000Z') }
    const decoded = decodeFromWire(JSON.parse(JSON.stringify(encodeForWire(input)))) as typeof input
    expect(decoded.createdAt).toBeInstanceOf(Date)
    expect(decoded.createdAt.getTime()).toBe(input.createdAt.getTime())
  })

  it('round-trips binary (a signature) as bytes, not as a JSON object', () => {
    const signature = new Uint8Array([0, 1, 2, 250, 255])
    const decoded = decodeFromWire(
      JSON.parse(JSON.stringify(encodeForWire({ signature }))),
    ) as { signature: Uint8Array }
    expect(decoded.signature).toBeInstanceOf(Uint8Array)
    expect(Array.from(decoded.signature)).toEqual([0, 1, 2, 250, 255])
  })

  it('leaves plain data and nulls exactly as they were', () => {
    const input = { number: 'INV-001', total: 1234.5, notes: null, lines: [{ qty: 2 }] }
    expect(decodeFromWire(encodeForWire(input))).toEqual(input)
  })
})
