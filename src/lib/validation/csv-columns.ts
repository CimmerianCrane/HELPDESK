/**
 * The header-mapping half of CSV import, shared by every importer.
 *
 * A spreadsheet is written by a person, so `Legal Name`, `legal_name` and `LEGALNAME` all have to mean
 * the same column. Normalising the header is what makes that work; reporting the headers that do not
 * match is what stops a typo becoming a silently empty column.
 */

/** Lower-cases and strips spaces, underscores and hyphens: `Legal Name` → `legalname`. */
export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[\s_-]/g, '')
}

export interface ColumnMapping<T extends string> {
  /** File header → canonical column. Keyed by the header as written, so lookups use the same string. */
  mapping: Map<string, T>
  /** Headers the importer does not recognise, in file order. */
  unknown: string[]
  /** Required columns the file does not have. */
  missing: T[]
}

/**
 * Maps a file's headers onto a fixed set of columns.
 *
 * A header that normalises to a column already mapped (a file with both `Legal Name` and `legalName`)
 * is treated as unknown rather than silently overwriting the first: two columns claiming the same
 * field is a mistake in the file, and the person needs to see it.
 */
export function mapColumns<T extends string>(
  columns: readonly T[],
  headers: string[],
  required: readonly T[],
): ColumnMapping<T> {
  const canonical = new Map(columns.map((column) => [normaliseHeader(column), column] as const))
  const mapping = new Map<string, T>()
  const unknown: string[] = []
  const taken = new Set<T>()

  for (const header of headers) {
    const column = canonical.get(normaliseHeader(header))
    if (!column || taken.has(column)) {
      unknown.push(header)
      continue
    }
    mapping.set(header, column)
    taken.add(column)
  }

  return { mapping, unknown, missing: required.filter((column) => !taken.has(column)) }
}

/** Turns one CSV row into a plain object keyed by canonical column name. */
export function rowToColumns<T extends string>(
  row: { values: Record<string, string> },
  mapping: Map<string, T>,
): Partial<Record<T, string>> {
  const out: Partial<Record<T, string>> = {}
  for (const [header, column] of mapping) {
    out[column] = row.values[header] ?? ''
  }
  return out
}
