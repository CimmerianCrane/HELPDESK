import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { CsvError, parseCsv } from '@/lib/csv'
import { readCsvText } from '@/lib/import-file'

/**
 * The Excel side of an import. What matters is that a workbook reaches `parseCsv` in the same shape
 * a CSV does — a header row and one record per row — because every rule after that point is the CSV
 * parser's, not a second set of rules for spreadsheets.
 */

async function workbookOf(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Register')
  rows.forEach((row) => sheet.addRow(row))
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

describe('readCsvText', () => {
  it('reads the first worksheet as CSV text', async () => {
    const text = await readCsvText(
      await workbookOf([
        ['legalName', 'notes', 'paymentTerms'],
        ['Acme Cranes', '1 Tuas Ave, #02-01', 30],
        ['Beta Lifting', 'Says "urgent"', 14],
      ]),
    )

    expect(parseCsv(text).rows.map((row) => row.values)).toEqual([
      { legalName: 'Acme Cranes', notes: '1 Tuas Ave, #02-01', paymentTerms: '30' },
      { legalName: 'Beta Lifting', notes: 'Says "urgent"', paymentTerms: '14' },
    ])
  })

  it('pads a row that stops early, the way a spreadsheet leaves trailing cells empty', async () => {
    const text = await readCsvText(
      await workbookOf([
        ['legalName', 'uen', 'notes'],
        ['Acme Cranes', '202012345K'],
      ]),
    )

    expect(parseCsv(text).rows[0]?.values).toEqual({
      legalName: 'Acme Cranes',
      uen: '202012345K',
      notes: '',
    })
  })

  it('writes a date cell as YYYY-MM-DD, which is what the crane importer validates', async () => {
    const text = await readCsvText(
      await workbookOf([
        ['assetTag', 'registrationDate'],
        ['CR-001', new Date(Date.UTC(2026, 9, 26))],
      ]),
    )

    expect(parseCsv(text).rows[0]?.values.registrationDate).toBe('2026-10-26')
  })

  it('takes a formula cell’s result, not the expression', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Register')
    sheet.addRow(['assetTag', 'swlKg'])
    sheet.addRow(['CR-002', { formula: '1000*5', result: 5000 }])
    const text = await readCsvText(Buffer.from(await workbook.xlsx.writeBuffer()))

    expect(parseCsv(text).rows[0]?.values.swlKg).toBe('5000')
  })

  it('passes a CSV file through unchanged', async () => {
    const text = await readCsvText(Buffer.from('legalName,uen\r\nAcme Cranes,202012345K\r\n', 'utf8'))
    expect(parseCsv(text).rows[0]?.values.legalName).toBe('Acme Cranes')
  })

  it('refuses bytes that claim to be a workbook but are not one', async () => {
    // The ZIP signature, then rubbish: what a truncated or renamed file looks like.
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00])
    await expect(readCsvText(bytes)).rejects.toBeInstanceOf(CsvError)
  })

  it('names an old .xls workbook rather than importing mojibake', async () => {
    const bytes = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x00])
    await expect(readCsvText(bytes)).rejects.toThrow('.xlsx')
  })
})
