import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import type { InvoiceExportRow } from './accounting'

/**
 * Pushing billed invoices into an accounting system (slice 37, brief §5: "accounting-export adapter
 * (CSV first; Xero/QuickBooks later)").
 *
 * The same seam rule as `MessageAdapter` and `EmailAdapter`: a push returns a result and never throws.
 * One rejected invoice must not roll back the others, and a dead gateway must not stop the office
 * recording what it billed — the failure is reported per invoice and cleared by pushing again.
 *
 * **A successful push returns the accounting system's own reference**, and only then is the invoice
 * marked pushed. An invoice marked pushed with nothing to point at would never be re-sent.
 *
 * **Xero is allowed to compute the GST, and the result is checked against the stored bill.** The
 * revenue lines carry the org's standard tax rate, so GST lands in the right box for filing; the
 * invoice the customer was sent states a rate snapshotted on its issue date, so if Xero's total
 * disagrees by a cent the push is reported rather than accepted. Xero's `Idempotency-Key` makes the
 * retry after a mismatch return the same invoice instead of creating a second one.
 */

export interface PushResult {
  ok: boolean
  /** The accounting system's id for the document, present when `ok`. */
  externalRef?: string
  error?: string
}

export interface AccountingPushContext {
  currency: string
  /** Stable per invoice: sent as the idempotency key, so a retry is the same request. */
  sourceRef: string
}

export interface AccountingPushDriver {
  readonly name: string
  /** Sends one issued invoice. Never throws. */
  pushInvoice(row: InvoiceExportRow, context: AccountingPushContext): Promise<PushResult>
}

/** What the office sees when no accounting system is configured. */
export const nonePushDriver: AccountingPushDriver = {
  name: 'none',
  async pushInvoice() {
    return {
      ok: false,
      error: 'No accounting system is configured. Use the CSV export, or set ACCOUNTING_DRIVER=xero.',
    }
  },
}

const TOKEN_URL = 'https://identity.xero.com/connect/token'
/** Tokens last 30 minutes; fetched once per push run rather than once per invoice. */
const TOKEN_TTL_MS = 25 * 60 * 1000

let cached: { token: string; expiresAt: number } | undefined
let cachedTenant: string | undefined

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token

  const id = env().XERO_CLIENT_ID
  const secret = env().XERO_CLIENT_SECRET
  if (!id || !secret) throw new Error('XERO_CLIENT_ID and XERO_CLIENT_SECRET are not set.')

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  })
  if (!response.ok) {
    throw new Error(`Xero token request failed (${response.status}): ${await response.text()}`)
  }
  const body = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) throw new Error('Xero returned no access token.')

  cached = {
    token: body.access_token,
    expiresAt: Date.now() + Math.min((body.expires_in ?? 1800) * 1000, TOKEN_TTL_MS),
  }
  return cached.token
}

/** The single organisation a custom connection is authorised against. */
async function tenant(): Promise<string> {
  if (cachedTenant) return cachedTenant
  const response = await fetch(`${env().XERO_API_BASE}/connections`, {
    headers: { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Xero connections failed (${response.status}): ${await response.text()}`)
  }
  const connections = (await response.json()) as Array<{ tenantId?: string }>
  const first = connections.find((connection) => connection.tenantId)?.tenantId
  if (!first) {
    throw new Error('The Xero custom connection is not authorised against an organisation.')
  }
  cachedTenant = first
  return first
}

/** YYYY-MM-DD in UTC; the invoice's own dates are UTC-midnight days already for the due date. */
function day(value: Date | null): string | undefined {
  return value ? value.toISOString().slice(0, 10) : undefined
}

/**
 * The ACCREC body. `InvoiceNumber` is ours, so the Xero invoice carries the number the customer has.
 * Lines are the invoice's own lines at their unit prices; `Exclusive` means Xero adds the tax on top,
 * which is how the invoice was priced.
 */
export function xeroInvoiceBody(
  row: InvoiceExportRow,
  currency: string,
  taxType: string,
  accountCode?: string,
) {
  return {
    Type: 'ACCREC',
    InvoiceNumber: row.number,
    Reference: row.jobNumber ?? undefined,
    Contact: { Name: row.customer },
    Date: day(row.issueDate),
    DueDate: day(row.dueDate),
    LineAmountTypes: 'Exclusive',
    CurrencyCode: currency,
    Status: 'AUTHORISED',
    LineItems: row.lines.map((line) => ({
      Description: line.description,
      Quantity: line.quantity,
      UnitAmount: Math.round(line.unitAmount * 100) / 100,
      TaxType: taxType,
      ...(accountCode ? { AccountCode: accountCode } : {}),
    })),
  }
}

export function createXeroDriver(): AccountingPushDriver {
  return {
    name: 'xero',

    async pushInvoice(row, context) {
      try {
        const response = await fetch(`${env().XERO_API_BASE}/api.xro/2.0/Invoices`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await accessToken()}`,
            'xero-tenant-id': await tenant(),
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Idempotency-Key': context.sourceRef,
          },
          body: JSON.stringify(
            xeroInvoiceBody(row, context.currency, env().XERO_TAX_TYPE, env().XERO_SALES_ACCOUNT_CODE),
          ),
        })

        const text = await response.text()
        if (!response.ok) {
          return { ok: false, error: `Xero refused ${row.number} (${response.status}): ${text.slice(0, 400)}` }
        }
        const parsed = JSON.parse(text) as {
          Invoices?: Array<{ InvoiceID?: string; Total?: number }>
        }
        const pushed = parsed.Invoices?.[0]
        if (!pushed?.InvoiceID) {
          return { ok: false, error: 'Xero accepted the request but returned no invoice id.' }
        }
        // Xero computes GST from the org's rate; the customer was charged the rate on the bill.
        const difference = Math.round((pushed.Total ?? 0) * 100) - Math.round(row.total * 100)
        if (difference !== 0) {
          return {
            ok: false,
            error: `${row.number} was created in Xero as ${pushed.InvoiceID}, but Xero's total is ${(difference / 100).toFixed(2)} away from the bill's. Check the org's GST rate, then push again — the retry returns the same invoice.`,
          }
        }
        return { ok: true, externalRef: pushed.InvoiceID }
      } catch (error) {
        logger.warn('accounting.push.failed', { invoice: row.number, error: String(error) })
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

/** `none` is not an error at resolve time — the screen offers the CSV and the service says why. */
export function accountingPushDriver(): AccountingPushDriver {
  return env().ACCOUNTING_DRIVER === 'xero' ? createXeroDriver() : nonePushDriver
}

export function accountingPushEnabled(): boolean {
  return env().ACCOUNTING_DRIVER !== 'none'
}
