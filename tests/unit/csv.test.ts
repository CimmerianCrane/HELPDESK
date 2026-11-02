import { describe, expect, it } from 'vitest'
import { CsvError, csvEscape, parseCsv } from '@/lib/csv'

/**
 * The importer's parser. The cases are the ones real spreadsheets actually contain: quoted commas,
 * escaped quotes, Windows line endings, a BOM from Excel, and blank lines at the end.
 */

describe('parseCsv', () => {
  it('reads a simple file into headers and rows', () => {
    const table = parseCsv('legalName,uen\nAcme Cranes,202012345K\nBeta Lifting,\n')

    expect(table.headers).toEqual(['legalName', 'uen'])
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0]?.values).toEqual({ legalName: 'Acme Cranes', uen: '202012345K' })
    expect(table.rows[1]?.values).toEqual({ legalName: 'Beta Lifting', uen: '' })
  })

  it('handles a quoted value containing a comma', () => {
    const table = parseCsv('legalName,notes\n"Acme, Pte Ltd","1 Tuas Ave, #02-01"')
    expect(table.rows[0]?.values).toEqual({
      legalName: 'Acme, Pte Ltd',
      notes: '1 Tuas Ave, #02-01',
    })
  })

  it('handles escaped quotes inside a quoted value', () => {
    const table = parseCsv('legalName\n"The ""Big"" Crane Co"')
    expect(table.rows[0]?.values.legalName).toBe('The "Big" Crane Co')
  })

  it('handles CRLF line endings', () => {
    const table = parseCsv('legalName,status\r\nAcme,ACTIVE\r\nBeta,DORMANT\r\n')
    expect(table.rows.map((row) => row.values.legalName)).toEqual(['Acme', 'Beta'])
  })

  it('strips the BOM Excel writes to UTF-8 CSV files', () => {
    const table = parseCsv('﻿legalName,status\nAcme,ACTIVE')
    expect(table.headers[0]).toBe('legalName')
  })

  it('skips blank lines rather than importing empty customers', () => {
    const table = parseCsv('legalName\nAcme\n\n\nBeta\n')
    expect(table.rows).toHaveLength(2)
  })

  it('keeps a last row that has no trailing newline', () => {
    const table = parseCsv('legalName\nAcme\nBeta')
    expect(table.rows).toHaveLength(2)
  })

  it('reports the original line number of each row', () => {
    const table = parseCsv('legalName\nAcme\n\nBeta')
    // Beta is on line 4 of the file, not row 2 of the data.
    expect(table.rows[1]?.line).toBe(4)
  })

  it('refuses a row with the wrong number of columns instead of shifting values', () => {
    expect(() => parseCsv('legalName,uen\nAcme,123,extra')).toThrow(CsvError)
  })

  it('refuses a duplicate column name', () => {
    expect(() => parseCsv('legalName,legalName\nA,B')).toThrow(CsvError)
  })

  it('refuses an empty file and a header with no rows', () => {
    expect(() => parseCsv('')).toThrow(CsvError)
    expect(() => parseCsv('legalName,uen\n')).toThrow(CsvError)
  })

  it('refuses a file that ends inside a quoted value', () => {
    expect(() => parseCsv('legalName\n"Acme')).toThrow(CsvError)
  })

  it('allows a quoted field with a newline inside it', () => {
    const table = parseCsv('legalName,notes\nAcme,"Line one\nLine two"')
    expect(table.rows[0]?.values.notes).toBe('Line one\nLine two')
  })
})

describe('csvEscape', () => {
  it('quotes only when it has to', () => {
    expect(csvEscape('plain')).toBe('plain')
    expect(csvEscape('has,comma')).toBe('"has,comma"')
    expect(csvEscape('has"quote')).toBe('"has""quote"')
    expect(csvEscape(null)).toBe('')
  })

  /**
   * A customer name or a job note is a value somebody else chose, and the export is a file the office
   * double-clicks. Excel and Sheets both evaluate a cell that starts with `=` — so the export must not
   * hand them one.
   */
  it('defuses a cell a spreadsheet would run as a formula', () => {
    expect(csvEscape('=HYPERLINK("http://evil","click")')).toBe(
      `"'=HYPERLINK(""http://evil"",""click"")"`,
    )
    expect(csvEscape('+1')).toBe("'+1")
    expect(csvEscape('-1')).toBe("'-1")
    expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)")
    // A hyphen inside the text is not a formula, and is left alone.
    expect(csvEscape('Tower crane - 5t')).toBe('Tower crane - 5t')
  })
})
