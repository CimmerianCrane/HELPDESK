import ExcelJS from 'exceljs'
import { CsvError, MAX_CSV_BYTES, decodeCsv } from './csv'

/**
 * Turns an uploaded import file into the CSV text the importers already parse.
 *
 * An `.xlsx` is read with the first worksheet's cells converted to CSV, so a spreadsheet and a CSV
 * go through one code path: `parseCsv`, the header mapping and every row rule are untouched by the
 * format. Anything that is not an Excel workbook is passed to `decodeCsv` unchanged, which is where
 * a UTF-16 file is refused with a plain message.
 *
 * exceljs rather than SheetJS (`xlsx`): the latter ships a minified bundle that builds functions
 * from strings, which the app's CSP and its "no dependency for nothing" rule both dislike.
 *
 * shortcut: only the first worksheet is read, and the 2 MB cap is on the file rather than the
 * expanded sheet; `MAX_IMPORT_ROWS` is what bounds a padded workbook.
 */

/** Excel's ZIP container signature: `PK\x03\x04`. */
function looksLikeXlsx(bytes: Buffer): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

export async function readCsvText(file: ArrayBuffer | Buffer): Promise<string> {
  const bytes = Buffer.isBuffer(file) ? file : Buffer.from(file)
  if (looksLikeXlsx(bytes)) return xlsxToCsv(bytes)
  // The 2003-era OLE container (`.xls`), which exceljs cannot read. Named because "the file needs a
  // legalName column" would be a baffling thing to say about a spreadsheet.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new CsvError('That is an old .xls workbook. In Excel, Save As → Excel Workbook (.xlsx).')
  }
  return decodeCsv(bytes)
}

async function xlsxToCsv(bytes: Buffer): Promise<string> {
  if (bytes.byteLength > MAX_CSV_BYTES) {
    throw new CsvError('The file is larger than 2 MB. Split it, or import in two passes.')
  }

  const workbook = new ExcelJS.Workbook()
  try {
    // exceljs declares its own `Buffer extends ArrayBuffer`, which no real Buffer satisfies.
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
  } catch {
    throw new CsvError('That file could not be read as an Excel workbook. Save it again as .xlsx or CSV.')
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) throw new CsvError('The workbook has no sheets.')

  const rows: string[][] = []
  let width = 0
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = []
    for (let column = 1; column <= row.cellCount; column += 1) {
      cells.push(cellText(row.getCell(column).value))
    }
    width = Math.max(width, cells.length)
    rows.push(cells)
  })

  // Pad short rows. A spreadsheet leaves trailing cells empty, and `parseCsv` is right to refuse a
  // row whose length differs from the header — so the padding happens here, before it sees one.
  return rows
    .map((cells) => [...cells, ...Array<string>(width - cells.length).fill('')].map(csvCell).join(','))
    .join('\n')
}

/**
 * One cell as CSV. The quoting is the reader's own, so a comma or a newline inside a note survives.
 */
function csvCell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** The value a cell contributes: a formula its result, rich text its runs, a link its label. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  // A date cell becomes `YYYY-MM-DD` so a date column is read by the same rule as a typed one.
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    const cell = value as Record<string, unknown>
    if (cell.result !== undefined && cell.result !== null) return cellText(cell.result)
    if (Array.isArray(cell.richText)) {
      return cell.richText.map((part) => cellText((part as { text?: unknown }).text)).join('')
    }
    if (typeof cell.text === 'string') return cell.text
    return ''
  }
  return String(value)
}
