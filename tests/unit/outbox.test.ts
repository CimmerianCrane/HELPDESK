import { describe, expect, it, vi } from 'vitest'

/**
 * The outbox's answer to an ended session (slice 41).
 *
 * A 401 is not a bad report. Counting it as a failed attempt makes a finished report look broken
 * once the technician signs back in, and the queue is the one thing this app must never quietly
 * damage. So the run aborts, nothing is counted, and the caller is told the session is the problem.
 *
 * The database is a stub here: Dexie is the phone's own store, and what is being tested is which
 * error becomes which outcome, not how a row is written.
 */

const rows = vi.hoisted(() => ({
  outbox: [
    {
      id: 'item-1',
      kind: 'report.submit',
      jobId: 'job-1',
      reportId: 'report-1',
      createdAt: '2026-10-31T08:00:00.000Z',
      attempts: 0,
      lastError: null,
      payload: {
        id: 'report-1',
        jobId: 'job-1',
        craneId: 'crane-1',
        templateId: 'tpl-1',
        templateVersion: 1,
        data: {},
        checklist: {},
        grades: {
          CM_HOIST_BRAKE_LINING: { grade: 2, comment: 'Worn', label: 'Brake lining' },
        },
        parts: [],
        photoIds: [],
        technicianSignatureId: null,
        customerSignatureId: null,
        technicianSignerName: 'Ahmad',
        customerSignerName: '',
        customerSignerDesignation: '',
        customerDeclinedReason: '',
      },
    },
  ],
  updated: [] as unknown[],
}))

vi.mock('@/offline/db', () => ({
  techDb: {
    outbox: {
      orderBy: () => ({ toArray: async () => rows.outbox }),
      update: async (_id: string, change: unknown) => {
        rows.updated.push(change)
      },
      delete: async () => undefined,
      count: async () => rows.outbox.length,
    },
    files: { get: async () => null, update: async () => undefined, bulkDelete: async () => undefined },
    drafts: { delete: async () => undefined },
    transaction: async (...args: unknown[]) => {
      const body = args[args.length - 1] as () => Promise<void>
      await body()
    },
  },
}))

const { flushOutbox, isRetryableError, SyncHttpError } = await import('@/offline/outbox')

describe('flushOutbox', () => {
  it('stops on a 401 without counting the attempt against the report', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })),
    )

    const result = await flushOutbox()

    expect(result.sessionExpired).toBe(true)
    expect(result.failed).toBe(0)
    expect(rows.updated).toHaveLength(0)
  })

  it('treats any other refusal as that report failing, with nothing lost', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Template changed' }), { status: 422 })),
    )

    const result = await flushOutbox()

    expect(result.sessionExpired).toBe(false)
    expect(result.failed).toBe(1)
    expect(result.errors).toEqual(['Template changed'])
    // A 4xx the server means is not worth the worker retrying for days.
    expect(result.retryable).toBe(false)
  })

  it('sends the grades with the report', async () => {
    const bodies: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.body) bodies.push(String(init.body))
        return new Response(JSON.stringify({ results: [{ id: 'item-1', ok: true }] }), {
          status: 200,
        })
      }),
    )

    await flushOutbox()

    const sent = JSON.parse(bodies.find((body) => body.includes('"kind"'))!) as {
      items: Array<{ payload: { grades: unknown } }>
    }
    expect(sent.items[0]?.payload.grades).toEqual({
      CM_HOIST_BRAKE_LINING: { grade: 2, comment: 'Worn', label: 'Brake lining' },
    })
  })

  it('marks a 5xx as retryable so Background Sync tries again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Down' }), { status: 503 })),
    )

    const result = await flushOutbox()

    expect(result.failed).toBe(1)
    expect(result.retryable).toBe(true)
  })
})

/**
 * Slice 42: which failures the worker should hand back to Chrome. Rejecting the `sync` event is a
 * promise to retry, so only a failure that can pass on its own may be rejected.
 */
describe('isRetryableError', () => {
  it('retries the network, 5xx and 429', () => {
    expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isRetryableError(new SyncHttpError('Down', 500))).toBe(true)
    expect(isRetryableError(new SyncHttpError('Slow down', 429))).toBe(true)
  })

  it('does not retry a refused report', () => {
    // 422: the report itself is the problem and will be refused again.
    expect(isRetryableError(new SyncHttpError('Template changed', 422))).toBe(false)
  })
})
