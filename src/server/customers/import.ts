import type { Prisma } from '@prisma/client'
import { CsvError, decodeCsv, parseCsv } from '@/lib/csv'
import { db, type Tx } from '@/lib/db'
import {
  CUSTOMER_IMPORT_COLUMNS,
  importRowSchema,
  importRowValues,
  mapHeaders,
  type CustomerImportColumn,
} from '@/lib/validation/import'
import { withAudit } from '@/server/audit/audit'
import { assertCan } from '@/server/auth/permissions'
import type { AuthContext } from '@/server/auth/types'

/**
 * Customer CSV import (brief §12.3).
 *
 * Two steps, deliberately separate: `previewCustomerImport` reports what would happen and writes
 * nothing; `applyCustomerImport` does it. Nobody should discover a mis-mapped column after the
 * import. The preview is also what makes a repeat import harmless — a row whose legal name already
 * exists is reported as a skip rather than creating a duplicate, so running the same file twice
 * changes nothing.
 *
 * Every created customer is written through `withAudit`, in one transaction for the whole file: a
 * file that fails part-way leaves nothing behind for someone to reconcile by hand.
 */

export interface ImportRowResult {
  line: number
  legalName: string
  outcome: 'create' | 'skip'
  /** Why a row will be skipped, or what is wrong with it. Present on `skip`. */
  reason?: string
}

export interface ImportPreview {
  /** Columns in the file that the importer does not recognise, listed so they can be fixed. */
  unknownColumns: string[]
  /** Recognised columns, in the order the file has them. */
  recognisedColumns: CustomerImportColumn[]
  rows: ImportRowResult[]
  toCreate: number
  toSkip: number
  /** Row-level validation problems. Non-empty means the import will be refused. */
  errors: string[]
  /** True when previewing found a reason to stop before writing anything. */
  blocked: boolean
}

/** The largest file we accept. A customer list for this business is a few hundred rows. */
export const MAX_IMPORT_ROWS = 2000

const decodeOrThrow = decodeCsv

/**
 * Reads and checks a file without writing anything. Returns what the import would do, field by
 * field, so the office can confirm before it happens.
 */
export async function previewCustomerImport(
  context: AuthContext,
  file: ArrayBuffer | Buffer,
  client: Tx = db,
): Promise<ImportPreview> {
  assertCan(context, 'customer.import')

  let text: string
  try {
    text = decodeOrThrow(file)
  } catch (error) {
    if (error instanceof CsvError) {
      return {
        unknownColumns: [],
        recognisedColumns: [],
        rows: [],
        toCreate: 0,
        toSkip: 0,
        errors: [error.message],
        blocked: true,
      }
    }
    throw error
  }

  let table: ReturnType<typeof parseCsv>
  try {
    table = parseCsv(text)
  } catch (error) {
    if (error instanceof CsvError) {
      return {
        unknownColumns: [],
        recognisedColumns: [],
        rows: [],
        toCreate: 0,
        toSkip: 0,
        errors: [error.message],
        blocked: true,
      }
    }
    throw error
  }

  const { mapping, unknown, missing } = mapHeaders(table.headers)
  const recognisedColumns = CUSTOMER_IMPORT_COLUMNS.filter((column) =>
    [...mapping.values()].includes(column),
  )

  const errors: string[] = []
  if (missing.length > 0) {
    errors.push(
      `The file needs a “${missing.join('” and “')}” column. Recognised columns are: ${CUSTOMER_IMPORT_COLUMNS.join(', ')}.`,
    )
  }
  if (table.rows.length > MAX_IMPORT_ROWS) {
    errors.push(
      `The file has ${table.rows.length} rows; the limit is ${MAX_IMPORT_ROWS}. Split it into smaller files.`,
    )
  }
  if (errors.length > 0) {
    return {
      unknownColumns: unknown,
      recognisedColumns,
      rows: [],
      toCreate: 0,
      toSkip: 0,
      errors,
      blocked: true,
    }
  }

  // Existing names, lower-cased, so the duplicate check is one query rather than one per row. Names
  // repeated within the file itself are caught in the loop below.
  const existing = await client.customer.findMany({
    where: { deletedAt: null },
    select: { legalName: true },
  })
  const seen = new Set(existing.map((row) => row.legalName.trim().toLowerCase()))

  const rows: ImportRowResult[] = []
  const rowErrors: string[] = []

  for (const row of table.rows) {
    const raw: Record<string, string> = {}
    for (const [header, column] of mapping) {
      raw[column] = row.values[header] ?? ''
    }

    const parsed = importRowSchema.safeParse(raw)
    if (!parsed.success) {
      const flat = parsed.error.flatten()
      const messages = [
        ...flat.formErrors,
        ...Object.entries(flat.fieldErrors).flatMap(([field, list]) =>
          (list ?? []).map((message) => `${field}: ${message}`),
        ),
      ]
      rowErrors.push(`Line ${row.line}: ${messages.join('; ')}`)
      continue
    }

    const legalName = importRowValues(parsed.data).legalName
    const key = legalName.toLowerCase()

    if (seen.has(key)) {
      rows.push({
        line: row.line,
        legalName,
        outcome: 'skip',
        reason: 'A customer with this name already exists, or appears earlier in this file.',
      })
      continue
    }

    seen.add(key)
    rows.push({ line: row.line, legalName, outcome: 'create' })
  }

  // One bad row blocks the whole file. Importing the good half of a spreadsheet and leaving someone
  // to work out which half is worse than fixing the file.
  const blocked = rowErrors.length > 0
  if (blocked) {
    errors.push(...rowErrors.slice(0, 25))
    if (rowErrors.length > 25) {
      errors.push(`…and ${rowErrors.length - 25} more problems. Fix the file and preview again.`)
    }
  }

  return {
    unknownColumns: unknown,
    recognisedColumns,
    rows,
    toCreate: rows.filter((row) => row.outcome === 'create').length,
    toSkip: rows.filter((row) => row.outcome === 'skip').length,
    errors,
    blocked,
  }
}

export interface ImportOutcome {
  created: number
  skipped: number
}

/**
 * Applies an import. Re-checks everything rather than trusting the preview: a preview is a report to
 * a human, never an authorization to write. If the database changed between the two steps, the
 * second check is the one that holds.
 *
 * The whole file is one transaction, so a failure creates nothing.
 */
export async function applyCustomerImport(
  context: AuthContext,
  file: ArrayBuffer | Buffer,
  client: Tx = db,
): Promise<ImportOutcome> {
  assertCan(context, 'customer.import')

  const preview = await previewCustomerImport(context, file, client)
  if (preview.blocked) {
    throw new CsvError(preview.errors.join('\n'))
  }

  const toCreate = preview.rows.filter((row) => row.outcome === 'create')
  if (toCreate.length === 0) return { created: 0, skipped: preview.toSkip }

  // Re-parse here rather than passing the previewed payloads across the boundary: the preview type is
  // a report, and the values it would write are not part of it.
  const text = decodeOrThrow(file)
  const table = parseCsv(text)
  const { mapping } = mapHeaders(table.headers)
  const wanted = new Set(toCreate.map((row) => row.legalName.toLowerCase()))

  await withAudit(
    context,
    async (tx, log) => {
      for (const row of table.rows) {
        const raw: Record<string, string> = {}
        for (const [header, column] of mapping) {
          raw[column] = row.values[header] ?? ''
        }

        const parsed = importRowSchema.safeParse(raw)
        if (!parsed.success) continue
        if (!wanted.has(parsed.data.legalName.trim().toLowerCase())) continue

        const input = importRowValues(parsed.data)
        const customer = await tx.customer.create({
          data: {
            legalName: input.legalName,
            tradingName: input.tradingName,
            uen: input.uen,
            paymentTerms: input.paymentTerms,
            status: input.status,
            notes: input.notes,
            billingAddress: input.address as Prisma.InputJsonValue,
            createdById: context.userId,
          },
          select: { id: true, legalName: true },
        })

        await log({
          entity: 'Customer',
          entityId: customer.id,
          action: 'CREATE',
          after: { ...input, importedFrom: 'csv' },
        })
      }
    },
    client,
  )

  return { created: toCreate.length, skipped: preview.toSkip }
}

/** The template the office downloads. Header row only, so it cannot be mistaken for data. */
export function customerImportTemplate(): string {
  return `${CUSTOMER_IMPORT_COLUMNS.join(',')}\n`
}
