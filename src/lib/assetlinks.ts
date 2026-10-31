import { z } from 'zod'

/**
 * Digital Asset Links (slice 45) — the statement list that tells Android the Play Store wrapper's
 * package may open this origin without Chrome's URL bar.
 *
 * Both fingerprints are needed: the upload key (present from the first build) and the Play App
 * Signing key Google re-signs with (which only exists after the first upload, so it is added later).
 */
const fingerprint = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  // Google compares these literally, colon-separated SHA-256 hex.
  .refine((value) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value), 'expected AA:BB:… SHA-256')

const statements = z.object({
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'expected a.b.c package'),
  fingerprints: z.array(fingerprint).min(1),
})

/** The statement list and the status to answer with. Unset env is a 404, not an empty list. */
export function assetLinks(values: { packageName?: string; fingerprints?: string }) {
  if (!values.packageName || !values.fingerprints) return { status: 404 } as const

  const parsed = statements.safeParse({
    packageName: values.packageName,
    fingerprints: values.fingerprints.split(',').filter(Boolean),
  })
  // A malformed value is a deployment mistake, not a 200 with a statement Play will reject anyway.
  if (!parsed.success) return { status: 500, body: parsed.error.flatten().fieldErrors } as const

  return {
    status: 200,
    body: [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: parsed.data.packageName,
          sha256_cert_fingerprints: parsed.data.fingerprints,
        },
      },
    ],
  } as const
}
