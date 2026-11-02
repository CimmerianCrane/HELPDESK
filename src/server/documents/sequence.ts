import type { Tx } from '@/lib/db'
import { env } from '@/lib/env'
import { zonedParts } from '@/lib/time'

export const DOCUMENT_PREFIXES = {
  TICKET: 'TKT',
  JOB: 'JOB',
  REPORT: 'RPT',
  DELIVERY_ORDER: 'DO',
  INVOICE: 'INV',
  QUOTE: 'QTE',
  PURCHASE_ORDER: 'PO',
  STOCK_TAKE: 'ST',
} as const

export type DocumentKind = keyof typeof DOCUMENT_PREFIXES

export function formatDocumentNumber(prefix: string, year: number, value: number): string {
  return `${prefix}-${year}-${String(value).padStart(4, '0')}`
}

/** The year a document belongs to, in the operating timezone — not UTC. */
export function documentYear(at: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(at))
}

/**
 * Issues the next number for a document kind. Safe under concurrent callers: the increment and the
 * read happen in a single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, so two requests can never
 * receive the same number.
 */
export async function nextDocumentNumber(
  tx: Tx,
  kind: DocumentKind,
  options: { at?: Date; timeZone?: string } = {},
): Promise<string> {
  const at = options.at ?? new Date()
  const timeZone = options.timeZone ?? env().DEFAULT_TIMEZONE

  const prefix = DOCUMENT_PREFIXES[kind]
  const year = documentYear(at, timeZone)
  const key = `${prefix}:${year}`

  const rows = await tx.$queryRaw<Array<{ issued: number }>>`
    INSERT INTO "DocumentSequence" ("key", "prefix", "nextValue", "updatedAt")
    VALUES (${key}, ${prefix}, 2, now())
    ON CONFLICT ("key") DO UPDATE
      SET "nextValue" = "DocumentSequence"."nextValue" + 1,
          "updatedAt" = now()
    RETURNING "nextValue" - 1 AS issued
  `

  return formatDocumentNumber(prefix, year, Number(rows[0].issued))
}

/** `SR2606001` — two-digit year, two-digit month, then the month's running number. */
export function formatServiceReportNumber(year: number, month: number, value: number): string {
  return `SR${String(year).slice(-2)}${String(month).padStart(2, '0')}${String(value).padStart(3, '0')}`
}

/**
 * The next Service Report number, restarting every month, in the operating timezone.
 *
 * Same atomic `INSERT … ON CONFLICT` as `nextDocumentNumber`, keyed by year *and* month so the count
 * restarts as the office's clock does. Stored in the same `DocumentSequence` table — the `SR` prefix
 * keeps it distinct from every RPT/INV row, so no new table and no new migration for the counter.
 */
export async function nextServiceReportNumber(
  tx: Tx,
  options: { at?: Date; timeZone?: string } = {},
): Promise<string> {
  const at = options.at ?? new Date()
  const timeZone = options.timeZone ?? env().DEFAULT_TIMEZONE
  const { year, month } = zonedParts(at, timeZone)
  const key = `SR:${year}${String(month).padStart(2, '0')}`

  const rows = await tx.$queryRaw<Array<{ issued: number }>>`
    INSERT INTO "DocumentSequence" ("key", "prefix", "nextValue", "updatedAt")
    VALUES (${key}, 'SR', 2, now())
    ON CONFLICT ("key") DO UPDATE
      SET "nextValue" = "DocumentSequence"."nextValue" + 1,
          "updatedAt" = now()
    RETURNING "nextValue" - 1 AS issued
  `

  return formatServiceReportNumber(year, month, Number(rows[0].issued))
}
