/**
 * A client-generated id.
 *
 * `crypto.randomUUID` only exists in a secure context. A phone opening the dev machine at
 * `http://192.168.x.x:3000` is not one, so the call is `undefined()` there and the whole screen dies
 * with it — which is exactly what the report form did. `crypto.getRandomValues` is not gated, so the
 * same v4 id is built by hand. These ids are the server's de-duplication key (CLAUDE.md rule 11), so
 * they must stay unique per device, not merely present.
 */
export function newId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // RFC 4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
