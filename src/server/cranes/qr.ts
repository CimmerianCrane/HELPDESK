import { randomInt } from 'node:crypto'

/**
 * Crane QR identities — the token and the URL it encodes.
 *
 * Two identifiers, deliberately separate:
 *
 * - `assetTag` is what the customer calls the crane ("OVH-01"), printed large on the label and
 *   readable by a person standing in front of it.
 * - `qrValue` is a random, unchanging token. The QR code encodes a URL containing it, so the code
 *   keeps resolving even if the asset tag is corrected or the crane moves to another site.
 *
 * The token alphabet excludes I, L, O and U: a technician reading one off a damaged label and typing
 * it in should not have to guess whether that is a one or an ell.
 *
 * This module uses `node:crypto`, so it is server-only. The words that appear on screen are in
 * `lib/cranes/labels.ts`, which a client component can import.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const TOKEN_LENGTH = 12

/** A fresh QR token. 12 characters of a 32-symbol alphabet is ~60 bits — no collision in practice. */
export function generateQrValue(): string {
  let token = ''
  for (let index = 0; index < TOKEN_LENGTH; index += 1) {
    token += ALPHABET[randomInt(ALPHABET.length)]
  }
  return `CRN${token}`
}

/** True when a string looks like a token this module produced — used before accepting an imported one. */
export function isCraneQrValue(value: string): boolean {
  return /^CRN[0-9A-HJKMNP-TV-Z]{12}$/.test(value)
}

/**
 * What the QR code actually contains. A URL rather than a bare token, so any phone camera opens the
 * crane record instead of showing the user a meaningless string.
 *
 * `APP_BASE_URL` is the deployment's own origin, so a move to a custom domain means re-printing the
 * labels printed under the old one. That is cheap and rare; guessing it later is neither.
 */
export function craneQrPayload(qrValue: string, appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/c/${qrValue}`
}

/** A suggested asset tag when the office leaves the field blank. They can always overwrite it. */
export function suggestAssetTag(): string {
  let suffix = ''
  for (let index = 0; index < 6; index += 1) {
    suffix += ALPHABET[randomInt(ALPHABET.length)]
  }
  return `CC-${suffix}`
}
