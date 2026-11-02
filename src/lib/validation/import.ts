import { z } from 'zod'
import { mapColumns, normaliseHeader, type ColumnMapping } from './csv-columns'
import { createCustomerSchema } from './customers'

export { normaliseHeader }

/**
 * The customer import column contract. Deliberately narrow: name, trading name, UEN, status, payment
 * terms and notes. Addresses and contacts are not imported in this slice — a spreadsheet with five
 * address columns and three contacts per customer needs a mapping screen, not a fixed format, and
 * guessing which column is "the" contact is how imports go wrong.
 *
 * Column names are case- and space-insensitive so `Legal Name` and `legalname` both work; the
 * importer normalises them before this schema sees them.
 */

export const CUSTOMER_IMPORT_COLUMNS = [
  'legalName',
  'tradingName',
  'uen',
  'status',
  'paymentTerms',
  'notes',
] as const

export type CustomerImportColumn = (typeof CUSTOMER_IMPORT_COLUMNS)[number]

/** What the template download offers, and what a header must at least contain. */
export const REQUIRED_IMPORT_COLUMNS: readonly CustomerImportColumn[] = ['legalName']

/** Maps a file's headers to canonical names. Unknown columns are reported, not silently dropped. */
export function mapHeaders(headers: string[]): ColumnMapping<CustomerImportColumn> {
  return mapColumns(CUSTOMER_IMPORT_COLUMNS, headers, REQUIRED_IMPORT_COLUMNS)
}

/**
 * One import row, validated. Reuses `createCustomerSchema` so an imported customer is subject to
 * exactly the rules a typed-in one is — there is no second, looser definition of a valid customer.
 * `status` is upper-cased here because a spreadsheet says `active`.
 *
 * `superRefine` rather than `.transform(parse)`: a `.parse()` inside a transform throws a `ZodError`
 * out of `safeParse`, which turns "your row 3 says `NOT_A_STATUS`" into a 500. Refining instead lets
 * the inner schema's own messages come back as an ordinary validation failure.
 */
const rowShape = z.object({
  legalName: z.string(),
  tradingName: z.string().optional(),
  uen: z.string().optional(),
  status: z.string().optional(),
  paymentTerms: z.string().optional(),
  notes: z.string().optional(),
})

const normaliseRow = (row: z.infer<typeof rowShape>) => ({
  legalName: row.legalName,
  tradingName: row.tradingName,
  uen: row.uen,
  status: row.status?.trim() ? row.status.trim().toUpperCase() : undefined,
  paymentTerms: row.paymentTerms?.trim() || undefined,
  notes: row.notes,
})

export const importRowSchema = rowShape.superRefine((row, ctx) => {
  const parsed = createCustomerSchema.safeParse(normaliseRow(row))
  if (parsed.success) return

  for (const issue of parsed.error.issues) {
    ctx.addIssue(issue)
  }
})

/** The values an accepted row will be written with. Call only after `importRowSchema` has passed. */
export function importRowValues(row: z.infer<typeof rowShape>) {
  return createCustomerSchema.parse(normaliseRow(row))
}

export type ImportedCustomer = ReturnType<typeof importRowValues>
