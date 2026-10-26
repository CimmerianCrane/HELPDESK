/**
 * A small RFC 4180 CSV reader.
 *
 * Written rather than installed: the app needs quoted fields, escaped quotes and CRLF, which is the
 * whole of RFC 4180, and a dependency for 60 lines would be the only reason a spreadsheet import
 * pulled in a package. Anything outside the RFC — delimiter sniffing, Excel's `sep=`, encoding
 * detection — is deliberately not supported, and says so rather than guessing.
 *
 * Every cell is a string. Turning a cell into a date, a number or an enum is the caller's job,
 * through Zod, so a bad cell produces a field-level message rather than a silent coercion.
 */

export interface CsvTable {
  /** Header names, trimmed and in file order. */
  headers: string[]
  /** One entry per data row, keyed by header. `line` is the 1-based line in the file, for messages. */
  rows: Array<{ line: number; values: Record<string, string> }>
}

export class CsvError extends Error {}

/**
 * Splits one CSV document into records of fields. Returns records rather than an object so the
 * caller can decide what the first record means.
 */
function parseRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false
  let fieldStarted = false

  // Strip a UTF-8 BOM: Excel adds one to "CSV UTF-8", and without this the first header would be
  // named "﻿legalName" and never match.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          // "" inside a quoted field is one literal quote.
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && !fieldStarted) {
      inQuotes = true
      fieldStarted = true
      continue
    }

    if (char === ',') {
      record.push(field)
      field = ''
      fieldStarted = false
      continue
    }

    if (char === '\r') {
      // CRLF and a bare CR both end the record; skip the LF of a CRLF.
      if (text[i + 1] === '\n') i += 1
      record.push(field)
      records.push(record)
      record = []
      field = ''
      fieldStarted = false
      continue
    }

    if (char === '\n') {
      record.push(field)
      records.push(record)
      record = []
      field = ''
      fieldStarted = false
      continue
    }

    field += char
    fieldStarted = true
  }

  if (inQuotes) throw new CsvError('The file ends inside a quoted value. Check for a missing quote.')

  // A trailing newline would otherwise become an empty record; a file not ending in one still needs
  // its last record.
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }

  return records
}

/**
 * Parses a CSV document into a header plus rows. Lines that are entirely empty are skipped, because
 * spreadsheets are full of them, but a row with the wrong number of columns is an error: it is
 * almost always a stray comma, and quietly shifting fields would import the wrong data.
 */
export function parseCsv(text: string): CsvTable {
  const records = parseRecords(text)
  if (records.length === 0) throw new CsvError('The file is empty.')

  const headerRecord = records[0]
  if (!headerRecord) throw new CsvError('The file is empty.')

  const headers = headerRecord.map((header) => header.trim())
  if (headers.every((header) => header === '')) {
    throw new CsvError('The first line must be a header row naming the columns.')
  }

  const seen = new Set<string>()
  for (const header of headers) {
    if (!header) throw new CsvError('A column header is blank.')
    if (seen.has(header)) throw new CsvError(`The column “${header}” appears twice.`)
    seen.add(header)
  }

  const rows: CsvTable['rows'] = []

  for (let index = 1; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue

    // Line number in the original file: the header is line 1.
    const line = index + 1
    const isBlank = record.every((cell) => cell.trim() === '')
    if (isBlank) continue

    if (record.length !== headers.length) {
      throw new CsvError(
        `Line ${line} has ${record.length} values but the header has ${headers.length}. Check for a stray or missing comma.`,
      )
    }

    const values: Record<string, string> = {}
    headers.forEach((header, column) => {
      values[header] = record[column] ?? ''
    })
    rows.push({ line, values })
  }

  if (rows.length === 0) throw new CsvError('The file has a header but no data rows.')

  return { headers, rows }
}

/** Quotes a value for CSV export. Used by the job-list export in a later slice. */
export function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** The largest file any importer accepts. A register for this business is a few hundred rows. */
export const MAX_CSV_BYTES = 2 * 1024 * 1024

/**
 * Turns uploaded bytes into text, refusing the two encodings that would otherwise arrive as mojibake.
 * Shared by every importer so they all explain the problem the same way.
 */
export function decodeCsv(bytes: ArrayBuffer | Buffer): string {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (buffer.byteLength > MAX_CSV_BYTES) {
    throw new CsvError('The file is larger than 2 MB. Split it, or import in two passes.')
  }

  // UTF-8 with a BOM is what Excel exports. A UTF-16 file starts with FF FE or FE FF, which this
  // reader cannot make sense of, so it says so rather than producing mojibake.
  if ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff)) {
    throw new CsvError('This looks like UTF-16 (Excel “Unicode text”). Save it as CSV UTF-8 instead.')
  }

  return buffer.toString('utf8')
}
