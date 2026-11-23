/**
 * The wire format between the app and the document service.
 *
 * The renderer inputs carry three things `JSON.stringify` would quietly corrupt: `Date`s (they become
 * ISO strings, and react-pdf writes `creationDate` from them, so the stored PDF's bytes would differ
 * from the ones rendered before the split), `Uint8Array`s (signatures and photos — JSON turns those
 * into `{"0":1,"1":2,…}` objects), and `undefined`-vs-absent distinctions. A report's bytes must stay
 * byte-identical for the same input (CLAUDE.md rule 5), so both ends encode and decode explicitly:
 *
 *   - `Date`     → `{ "$date": <epoch ms> }`
 *   - `Uint8Array` → `{ "$bytes": <base64> }`
 *
 * Plain data passes through untouched, so the renderers receive exactly the shape their types declare.
 */

const DATE = '$date'
const BYTES = '$bytes'

export function encodeForWire(value: unknown): unknown {
  if (value instanceof Date) return { [DATE]: value.getTime() }
  if (value instanceof Uint8Array) return { [BYTES]: Buffer.from(value).toString('base64') }
  if (Array.isArray(value)) return value.map(encodeForWire)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) out[key] = encodeForWire(inner)
    return out
  }
  return value
}

export function decodeFromWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeFromWire)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record[DATE] === 'number' && Object.keys(record).length === 1) {
      return new Date(record[DATE] as number)
    }
    if (typeof record[BYTES] === 'string' && Object.keys(record).length === 1) {
      return new Uint8Array(Buffer.from(record[BYTES] as string, 'base64'))
    }
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(record)) out[key] = decodeFromWire(inner)
    return out
  }
  return value
}

/** The document kinds the service renders. One per renderer. */
export const DOCUMENT_KINDS = ['invoice', 'quote', 'delivery-order', 'report', 'service-report'] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]
