import { describe, expect, it, vi } from 'vitest'

/**
 * The email seam (slice 47 follow-up).
 *
 * Nothing here sends: the console driver is the default and SMTP has no host in the test
 * environment. What is worth pinning is that naming `smtp` without a host does not crash the
 * business operation that asked for the mail — it returns a failed result the notification row can
 * record, which the daily cron then retries.
 */

process.env.DATABASE_URL ??= 'postgresql://unit-test@localhost:5432/unused'

/** `env()` caches on first call, so each case reloads the modules to read the variables it set. */
async function adapterWith(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.resetModules()
  const { emailAdapter } = await import('@/server/email/email')
  return emailAdapter()
}

describe('email adapter', () => {
  it('defaults to console', async () => {
    expect((await adapterWith({ EMAIL_DRIVER: undefined })).name).toBe('console')
  })

  it('resolves the smtp adapter when named', async () => {
    expect((await adapterWith({ EMAIL_DRIVER: 'smtp' })).name).toBe('smtp')
  })

  it('reports a failure instead of throwing when SMTP has no host', async () => {
    const adapter = await adapterWith({ EMAIL_DRIVER: 'smtp', SMTP_HOST: undefined })
    const result = await adapter.send({ to: 'a@b.test', subject: 'x', text: 'y' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/SMTP_HOST/)
  })

  it('reports a failure in production rather than pretending the console sent it', async () => {
    const adapter = await adapterWith({ EMAIL_DRIVER: 'console' })
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const result = await adapter.send({ to: 'a@b.test', subject: 'x', text: 'y' })
      expect(result.ok).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
