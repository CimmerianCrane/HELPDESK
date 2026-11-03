import { describe, expect, it } from 'vitest'
import type { JobStatus, Role } from '@prisma/client'
import { ForbiddenError, RuleError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  createQuote,
  getQuote,
  listQuotes,
  quotesForJob,
  renderQuote,
  transitionQuote,
  updateQuote,
} from '@/server/quotes/quotes'
import { craneFixtures, inRolledBackTx, jobFixture, testSuffix, type Tx } from './helpers'

/**
 * Quotes against the real database, inside a transaction that always rolls back (slice 19).
 *
 * The cases a screen cannot prove: the number is allocated once, totals are computed from the lines
 * rather than posted, sending and accepting move the job through its own status machine with history,
 * an expired quote cannot be accepted, a sent quote cannot be edited, and finance may read but not
 * write.
 */

function contextFor(
  user: { id: string; name: string; email: string; role: Role },
  overrides: Partial<AuthContext> = {},
): AuthContext {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    technicianId: null,
    ip: '203.0.113.9',
    userAgent: 'vitest',
    ...overrides,
  }
}

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${role.toLowerCase()}-quote-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

const line = (overrides: Partial<{ description: string; quantity: number; unitPrice: number; isVariation: boolean }> = {}) => ({
  description: 'Replace hoist brake pads',
  quantity: 1,
  unitPrice: 100,
  ...overrides,
})

/** A crane, a job on it, and the GST rate pinned inside the transaction so the totals are exact. */
async function quoteFixture(tx: Tx, options: { jobStatus?: JobStatus } = {}) {
  await tx.setting.upsert({
    where: { key: 'gstRate' },
    create: { key: 'gstRate', value: 0.09 },
    update: { value: 0.09 },
  })
  const base = await craneFixtures(tx)
  const job = await jobFixture(
    tx,
    { customerId: base.customer.id, siteId: base.site.id, jobTypeId: base.jobType.id },
    { suffix: base.suffix },
  )
  if (options.jobStatus) {
    await tx.job.update({ where: { id: job.id }, data: { status: options.jobStatus } })
  }
  return { ...base, job }
}

describe('quotes', () => {
  it('raises a numbered draft with GST computed from its lines, and audits it', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { job } = await quoteFixture(tx)

      const quote = await createQuote(
        dispatcher,
        {
          jobId: job.id,
          validUntil: '2026-11-30',
          lines: [
            { description: 'Replace brake pads', quantity: 2, unitPrice: 150 },
            { description: 'Extra counterweight', quantity: 1, unitPrice: 80, isVariation: true },
          ],
        },
        tx,
      )

      expect(quote.number).toMatch(/^QTE-\d{4}-\d{4}$/)
      expect(quote.status).toBe('DRAFT')
      expect(quote.gstRate).toBe(0.09)
      expect(quote.subtotal).toBe(380)
      expect(quote.gstAmount).toBeCloseTo(34.2)
      expect(quote.total).toBeCloseTo(414.2)
      expect(quote.lines.map((row) => row.isVariation)).toEqual([false, true])
      expect(quote.validUntil?.toISOString().slice(0, 10)).toBe('2026-11-30')
      expect(quote.job?.id).toBe(job.id)

      const audit = await tx.auditLog.findFirst({
        where: { entity: 'Quote', entityId: quote.id, action: 'CREATE' },
      })
      expect(audit?.after).toMatchObject({ number: quote.number, status: 'DRAFT' })

      // A draft is not an offer yet, so the job stays where it was.
      const stored = await tx.job.findUniqueOrThrow({ where: { id: job.id } })
      expect(stored.status).toBe('NEW')
    })
  })

  it('gives each quote its own number', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { job } = await quoteFixture(tx)

      const first = await createQuote(dispatcher, { jobId: job.id, lines: [line()] }, tx)
      const second = await createQuote(dispatcher, { jobId: job.id, lines: [line()] }, tx)

      expect(second.number).not.toBe(first.number)
      expect(Number(second.number.slice(-4))).toBe(Number(first.number.slice(-4)) + 1)
    })
  })

  it('sends a quote and moves a triaged job to QUOTED through the status machine', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { job } = await quoteFixture(tx, { jobStatus: 'TRIAGED' })
      const quote = await createQuote(dispatcher, { jobId: job.id, lines: [line()] }, tx)

      const sent = await transitionQuote(dispatcher, quote.id, { status: 'SENT' }, tx)
      expect(sent.status).toBe('SENT')

      const stored = await tx.job.findUniqueOrThrow({ where: { id: job.id } })
      expect(stored.status).toBe('QUOTED')

      const history = await tx.jobStatusHistory.findFirst({
        where: { jobId: job.id, toStatus: 'QUOTED' },
      })
      expect(history?.reason).toContain(quote.number)
    })
  })

  it('accepting a quote approves its job and leaves a history row', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { job } = await quoteFixture(tx, { jobStatus: 'TRIAGED' })
      const quote = await createQuote(dispatcher, { jobId: job.id, lines: [line()] }, tx)
      await transitionQuote(dispatcher, quote.id, { status: 'SENT' }, tx)

      const accepted = await transitionQuote(
        dispatcher,
        quote.id,
        { status: 'ACCEPTED', note: 'Accepted by the site manager' },
        tx,
      )
      expect(accepted.status).toBe('ACCEPTED')

      const stored = await tx.job.findUniqueOrThrow({ where: { id: job.id } })
      expect(stored.status).toBe('APPROVED')

      const history = await tx.jobStatusHistory.findFirst({
        where: { jobId: job.id, toStatus: 'APPROVED' },
      })
      expect(history?.reason).toContain(quote.number)

      const audit = await tx.auditLog.findFirst({
        where: { entity: 'Quote', entityId: quote.id, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      })
      expect(audit?.after).toMatchObject({
        status: 'ACCEPTED',
        note: 'Accepted by the site manager',
      })
    })
  })

  it('declining a quote leaves the job at QUOTED', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { job } = await quoteFixture(tx, { jobStatus: 'TRIAGED' })
      const quote = await createQuote(dispatcher, { jobId: job.id, lines: [line()] }, tx)
      await transitionQuote(dispatcher, quote.id, { status: 'SENT' }, tx)

      const declined = await transitionQuote(dispatcher, quote.id, { status: 'DECLINED' }, tx)
      expect(declined.status).toBe('DECLINED')

      const stored = await tx.job.findUniqueOrThrow({ where: { id: job.id } })
      expect(stored.status).toBe('QUOTED')
    })
  })

  it('reads a sent quote past its validity date as expired and refuses to accept it', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { job } = await quoteFixture(tx, { jobStatus: 'TRIAGED' })
      const quote = await createQuote(
        dispatcher,
        { jobId: job.id, validUntil: '2099-12-31', lines: [line()] },
        tx,
      )
      await transitionQuote(dispatcher, quote.id, { status: 'SENT' }, tx)

      // Move the validity date into the past, which is how a quote ages without a clock in the test.
      await tx.quote.update({
        where: { id: quote.id },
        data: { validUntil: new Date('2020-01-01T00:00:00.000Z') },
      })

      const lapsed = await getQuote(dispatcher, quote.id, tx)
      expect(lapsed.status).toBe('EXPIRED')

      const list = await listQuotes(dispatcher, { status: 'EXPIRED' }, tx)
      expect(list.quotes.map((row) => row.id)).toEqual([quote.id])

      await expect(
        transitionQuote(dispatcher, quote.id, { status: 'ACCEPTED' }, tx),
      ).rejects.toBeInstanceOf(RuleError)

      const stored = await tx.job.findUniqueOrThrow({ where: { id: job.id } })
      expect(stored.status).toBe('QUOTED')
    })
  })

  it('refuses to send a quote whose validity date has already passed', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { job } = await quoteFixture(tx, { jobStatus: 'TRIAGED' })
      const quote = await createQuote(
        dispatcher,
        { jobId: job.id, validUntil: '2020-01-01', lines: [line()] },
        tx,
      )

      await expect(
        transitionQuote(dispatcher, quote.id, { status: 'SENT' }, tx),
      ).rejects.toBeInstanceOf(RuleError)

      const stored = await tx.quote.findUniqueOrThrow({ where: { id: quote.id } })
      expect(stored.status).toBe('DRAFT')
    })
  })

  it('replaces the lines of a draft but refuses to edit a sent quote', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { job } = await quoteFixture(tx, { jobStatus: 'TRIAGED' })
      const quote = await createQuote(dispatcher, { jobId: job.id, lines: [line()] }, tx)

      const updated = await updateQuote(
        dispatcher,
        quote.id,
        {
          validUntil: '2026-12-01',
          notes: 'Agreed by phone',
          lines: [{ description: 'Full brake service', quantity: 1, unitPrice: 250, isVariation: false }],
        },
        tx,
      )
      expect(updated.lines).toHaveLength(1)
      expect(updated.lines[0]?.description).toBe('Full brake service')
      expect(updated.subtotal).toBe(250)
      expect(updated.total).toBeCloseTo(272.5)
      expect(updated.notes).toBe('Agreed by phone')

      await transitionQuote(dispatcher, quote.id, { status: 'SENT' }, tx)
      await expect(
        updateQuote(dispatcher, quote.id, { lines: [line()] }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('lets finance read a quote but not raise one, and keeps it from the store', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { job } = await quoteFixture(tx)
      const quote = await createQuote(dispatcher, { jobId: job.id, lines: [line()] }, tx)

      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      expect((await getQuote(finance, quote.id, tx)).id).toBe(quote.id)
      expect((await quotesForJob(finance, job.id, tx)).map((row) => row.id)).toEqual([quote.id])
      await expect(
        createQuote(finance, { jobId: job.id, lines: [line()] }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)

      const storekeeper = contextFor(await makeUser(tx, 'STOREKEEPER'))
      await expect(getQuote(storekeeper, quote.id, tx)).rejects.toBeInstanceOf(ForbiddenError)
      await expect(quotesForJob(storekeeper, job.id, tx)).rejects.toBeInstanceOf(ForbiddenError)
      await expect(listQuotes(storekeeper, {}, tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('renders the quote as a PDF', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { job } = await quoteFixture(tx)
      const quote = await createQuote(dispatcher, { jobId: job.id, lines: [line()] }, tx)

      const { filename, bytes } = await renderQuote(dispatcher, quote.id, tx)
      expect(filename).toBe(`${quote.number}.pdf`)
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    })
  })
})
