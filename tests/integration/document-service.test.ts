import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

/**
 * The split's one real risk is drift: the codec and the service could agree with each other and
 * disagree with the renderers, and nobody would notice until a customer's invoice looked wrong.
 *
 * This test closes that loop: it starts the real document service on a free port, renders through
 * `renderPdf` with `DOCUMENT_SERVICE_URL` set, and compares the bytes with a local render of the same
 * input. They must be identical — the service runs the same module, so any difference is a transport
 * bug (a lost Date, a mangled signature), which is exactly what would make a re-issued report differ
 * from the one on file.
 *
 * Skipped when `esbuild` cannot bundle the service in the current environment; the unit render tests
 * still cover the renderers themselves.
 */
describe('document service (remote render)', () => {
  it('returns byte-identical output to an in-process render', async () => {
    const input = {
      number: 'INV-WIRE-1',
      createdAt: new Date('2026-11-20T03:04:05.000Z'),
      issueDate: new Date('2026-11-20T03:04:05.000Z'),
      dueDate: null,
      timeZone: 'Asia/Singapore',
      currency: 'SGD',
      customer: { name: 'Harbour Logistics' },
      job: { number: 'JOB-2026-0100' },
      status: 'ISSUED' as const,
      gstRate: 0.09,
      subtotal: 1000,
      gstAmount: 90,
      total: 1090,
      amountPaid: 0,
      lines: [{ description: 'Annual load test', quantity: 1, unitPrice: 1000, lineTotal: 1000 }],
    }

    const { renderInvoicePdf } = await import('@/server/documents/invoice')
    const local = await renderInvoicePdf(input)

    // Build, then run the service as the Dockerfile does. esbuild's JS entry is invoked through
    // `node` rather than the `npx`/`esbuild` shims, which are not executable on Windows.
    const esbuildCli = require.resolve('esbuild/bin/esbuild')
    execFileSync(process.execPath, [esbuildCli, 'document-service/server.mts', '--bundle',
      '--format=esm', '--platform=node', '--target=node20', '--packages=external', '--alias:@=./src',
      '--outfile=document-service/dist/server.mjs'], { stdio: 'ignore' })

    const { spawn } = await import('node:child_process')
    const port = 18900 + Math.floor(Math.random() * 90)
    const service = spawn('node', ['document-service/dist/server.mjs'], {
      env: { ...process.env, PORT: String(port), DOCUMENT_SERVICE_SECRET: 'test-secret' },
      stdio: 'ignore',
    })

    try {
      // Wait for /health rather than sleeping a fixed time.
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          const health = await fetch(`http://127.0.0.1:${port}/health`)
          if (health.ok) break
        } catch {
          // not up yet
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      process.env.DOCUMENT_SERVICE_URL = `http://127.0.0.1:${port}`
      process.env.DOCUMENT_SERVICE_SECRET = 'test-secret'
      // `env()` caches on first read, so drop the cache before the remote render reads it.
      const { resetEnvCache } = await import('@/lib/env')
      resetEnvCache()
      const { renderPdf } = await import('@/server/documents/render-pdf')
      const remote = await renderPdf('invoice', input)

      expect(remote.subarray(0, 5).toString()).toBe('%PDF-')
      // The guarantee: the service renders the same bytes as the app did before the split.
      expect(Buffer.compare(remote, local)).toBe(0)
    } finally {
      delete process.env.DOCUMENT_SERVICE_URL
      delete process.env.DOCUMENT_SERVICE_SECRET
      service.kill()
    }
  }, 60_000)
})
