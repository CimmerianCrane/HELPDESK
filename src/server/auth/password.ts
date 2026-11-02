import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * `promisify(scrypt)` resolves to the overload without options, so it cannot carry N/r/p. Wrapping it
 * by hand keeps the parameters typed and the call sites honest.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derivedKey) =>
      error ? reject(error) : resolve(derivedKey),
    )
  })
}

/**
 * Password hashing with scrypt from Node's standard library.
 *
 * Deliberately not bcrypt: scrypt is memory-hard (so it resists GPU cracking better than bcrypt at
 * comparable cost), it ships with Node, and it removes a dependency and a native build step — which
 * matters because this project has to install cleanly on Windows, macOS and Linux.
 *
 * The stored string is self-describing, so the parameters can be raised later without invalidating
 * existing hashes: existing rows keep verifying under the parameters they were created with.
 *
 *   scrypt$<N>$<r>$<p>$<salt>$<hash>
 *
 * N=2^16 is 64 MiB of memory per hash. OWASP suggests 2^17, which is 128 MiB and would risk an OOM on
 * a small serverless function; this is the step that doubles the cost without that risk.
 */
const PARAMS = { N: 65_536, r: 8, p: 1, keylen: 64 } as const

/**
 * Node's default `maxmem` is 32 MiB, which 2^16 exceeds — it would throw, not hash. The formula is the
 * one Node documents: 128 bytes per (N, r) block, doubled for headroom. Derived from the *stored*
 * parameters in `verifyPassword` so a 2^14 hash written before this change still verifies.
 */
function maxmemFor(N: number, r: number): number {
  return 128 * N * r * 2
}

/** Unicode-normalised so a password typed with a different input method still matches. */
function normalise(plain: string): string {
  return plain.normalize('NFKC')
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(normalise(plain), salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: maxmemFor(PARAMS.N, PARAMS.r),
  })

  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$')
}

/**
 * Constant-time verification. Returns false rather than throwing on a malformed stored value, so a
 * corrupt row denies access instead of crashing the login route.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6) return false

  const [algorithm, rawN, rawR, rawP, saltPart, hashPart] = parts
  if (algorithm !== 'scrypt') return false

  const N = Number(rawN)
  const r = Number(rawR)
  const p = Number(rawP)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  if (N <= 1 || r <= 0 || p <= 0) return false

  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltPart, 'base64url')
    expected = Buffer.from(hashPart, 'base64url')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false

  let actual: Buffer
  try {
    actual = await scryptAsync(normalise(plain), salt, expected.length, {
      N,
      r,
      p,
      maxmem: maxmemFor(N, r),
    })
  } catch {
    // Nonsense parameters (or a hash that would need gigabytes) — a failed login, not a crash.
    return false
  }

  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}
