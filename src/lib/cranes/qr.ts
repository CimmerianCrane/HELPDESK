/**
 * What a printed crane label means.
 *
 * The generator next door (`server/cranes/qr.ts`) draws its token from `node:crypto` and is
 * server-only. Reading a label back is the opposite: the scanner and the report form both run on
 * the tablet, so the token's shape and the payload's URL shape live here where both builds can
 * import them.
 */

const CRANE_QR_PATTERN = /^CRN[0-9A-HJKMNP-TV-Z]{12}$/

/** True when a string looks like a token the generator produced. */
export function isCraneQrValue(value: string): boolean {
  return CRANE_QR_PATTERN.test(value)
}

/** What the QR code actually contains: a URL, so any phone camera opens the crane record. */
export function craneQrPayload(qrValue: string, appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/c/${qrValue}`
}

/**
 * The crane token in whatever the camera read, or null when this is not one of our labels.
 *
 * A bare token is accepted too, because that is what a technician types off a damaged label. The
 * host is not checked: labels printed under an old domain keep working, and a token only resolves
 * against the cranes this technician already has cached, so a hostile URL gains nothing.
 */
export function craneQrValueFromPayload(raw: string): string | null {
  const value = raw.trim()
  if (isCraneQrValue(value)) return value
  // A typed-in token, not a scanned one: accept whatever case the keyboard produced.
  const typed = value.toUpperCase()
  if (isCraneQrValue(typed)) return typed

  let path: string
  try {
    path = new URL(value).pathname
  } catch {
    return null
  }
  const match = /^\/c\/([^/]+)\/?$/.exec(path)
  return match && isCraneQrValue(match[1]) ? match[1] : null
}
