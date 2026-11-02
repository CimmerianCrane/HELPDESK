import { describe, expect, it } from 'vitest'
import { assetLinks } from '@/lib/assetlinks'

/**
 * Digital Asset Links (slice 45), without a database or a server.
 *
 * What these pin: unset env is a 404 (so a half-configured deployment never tells Android "yes"),
 * the fingerprints are normalised the way Google compares them, and a malformed value fails loudly
 * instead of shipping a statement list Play will reject anyway.
 */

const FINGERPRINT = 'AB:'.repeat(31) + 'CD'

describe('assetLinks', () => {
  it('is a 404 until both values are set', () => {
    expect(assetLinks({}).status).toBe(404)
    expect(assetLinks({ packageName: 'sg.cimmeriancrane.field' }).status).toBe(404)
    expect(assetLinks({ fingerprints: FINGERPRINT }).status).toBe(404)
  })

  it('names the app and every fingerprint, with whitespace and case normalised', () => {
    const result = assetLinks({
      packageName: 'sg.cimmeriancrane.field',
      fingerprints: `${FINGERPRINT.toLowerCase()}, ${FINGERPRINT}`,
    })
    expect(result.status).toBe(200)
    expect(result.body).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'sg.cimmeriancrane.field',
          sha256_cert_fingerprints: [FINGERPRINT, FINGERPRINT],
        },
      },
    ])
  })

  it('refuses a package name or fingerprint Google would reject', () => {
    expect(
      assetLinks({ packageName: 'not a package', fingerprints: FINGERPRINT }).status,
    ).toBe(500)
    expect(
      assetLinks({ packageName: 'sg.cimmeriancrane.field', fingerprints: 'AB:CD' }).status,
    ).toBe(500)
  })
})
