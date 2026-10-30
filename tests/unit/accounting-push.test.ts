import { afterEach, describe, expect, it, vi } from 'vitest'
import { xeroInvoiceBody, accountingPushEnabled, accountingPushDriver } from '@/server/accounting/push'
import type { InvoiceExportRow } from '@/server/accounting/accounting'

/**
 * The Xero push seam (slice 37).
 *
 * No live Xero call is made anywhere in this suite. What is pinned is the payload shape — the number
 * the customer has, the lines at their unit prices, `Exclusive` so the org's GST is added rather than
 * baked in — and the fallback: an unconfigured app resolves the `none` driver, which reports rather
 * than pretending a bill went anywhere.
 */

process.env.DATABASE_URL ??= 'postgresql://unit-test@localhost:5432/unused'

const row: InvoiceExportRow = {
  number: 'INV-2026-0042',
  // UTC-midnight days, as the invoice stores them.
  issueDate: new Date('2026-10-28T00:00:00Z'),
  dueDate: new Date('2026-11-27T00:00:00Z'),
  customer: 'Acme Cranes',
  status: 'ISSUED',
  gstRate: 0.09,
  subtotal: 300,
  gstAmount: 27,
  total: 327,
  amountPaid: 0,
  balance: 327,
  jobNumber: 'JOB-2026-0007',
  description: 'Brake pads; Labour',
  lines: [
    { description: 'Brake pads', quantity: 2, unitAmount: 100 },
    { description: 'Labour', quantity: 1, unitAmount: 100 },
  ],
}

describe('the Xero invoice body', () => {
  it('carries our number, the lines at unit price and the org tax rate', () => {
    const body = xeroInvoiceBody(row, 'SGD', 'SR')

    expect(body.Type).toBe('ACCREC')
    expect(body.InvoiceNumber).toBe('INV-2026-0042')
    expect(body.Reference).toBe('JOB-2026-0007')
    expect(body.Contact.Name).toBe('Acme Cranes')
    expect(body.Date).toBe('2026-10-28')
    expect(body.DueDate).toBe('2026-11-27')
    expect(body.CurrencyCode).toBe('SGD')
    expect(body.Status).toBe('AUTHORISED')
    // Exclusive: Xero adds the GST, so the bill's stored split is what the org is asked to charge.
    expect(body.LineAmountTypes).toBe('Exclusive')
    expect(body.LineItems).toEqual([
      { Description: 'Brake pads', Quantity: 2, UnitAmount: 100, TaxType: 'SR' },
      { Description: 'Labour', Quantity: 1, UnitAmount: 100, TaxType: 'SR' },
    ])
  })

  it('puts the account code on every line when one is configured', () => {
    const body = xeroInvoiceBody(row, 'SGD', 'SR', '200')
    expect(body.LineItems.every((line) => line.AccountCode === '200')).toBe(true)
  })

  it('sends a line rounded to the cent, never a float', () => {
    const body = xeroInvoiceBody(
      { ...row, lines: [{ description: 'Wire rope', quantity: 1, unitAmount: 123.4551 }] },
      'SGD',
      'SR',
    )
    expect(body.LineItems[0]?.UnitAmount).toBe(123.46)
  })
})

describe('the configured driver', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is `none` by default and refuses to pretend a bill went anywhere', async () => {
    vi.resetModules()
    vi.stubEnv('ACCOUNTING_DRIVER', 'none')
    const { accountingPushDriver: resolve, accountingPushEnabled: enabled } = await import(
      '@/server/accounting/push'
    )

    expect(enabled()).toBe(false)
    const driver = resolve()
    expect(driver.name).toBe('none')
    const result = await driver.pushInvoice(row, { currency: 'SGD', sourceRef: 'x' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('ACCOUNTING_DRIVER=xero')
  })

  it('resolves the Xero driver when configured', async () => {
    vi.resetModules()
    vi.stubEnv('ACCOUNTING_DRIVER', 'xero')
    const { accountingPushDriver: resolve, accountingPushEnabled: enabled } = await import(
      '@/server/accounting/push'
    )

    expect(enabled()).toBe(true)
    expect(resolve().name).toBe('xero')
  })

  it('the module-level helper reads the same setting', () => {
    vi.stubEnv('ACCOUNTING_DRIVER', 'xero')
    expect(accountingPushEnabled()).toBe(true)
    expect(accountingPushDriver().name).toBe('xero')
  })
})
