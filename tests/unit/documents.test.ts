import { describe, expect, it } from 'vitest'
import { DOCUMENT_PREFIXES, documentYear, formatDocumentNumber } from '@/server/documents/sequence'

describe('formatDocumentNumber', () => {
  it('pads the counter to four digits', () => {
    expect(formatDocumentNumber('JOB', 2026, 1)).toBe('JOB-2026-0001')
    expect(formatDocumentNumber('RPT', 2026, 42)).toBe('RPT-2026-0042')
    expect(formatDocumentNumber('INV', 2026, 999)).toBe('INV-2026-0999')
  })

  it('does not truncate once the counter overflows four digits', () => {
    expect(formatDocumentNumber('JOB', 2026, 12345)).toBe('JOB-2026-12345')
  })

  it('has a distinct prefix for every document kind', () => {
    const prefixes = Object.values(DOCUMENT_PREFIXES)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })
})

describe('documentYear', () => {
  // Singapore is UTC+8, so a document raised at 01:00 on 1 January is still 31 December in UTC.
  // The number must carry the local year, not the UTC one.
  const newYearInSingapore = new Date('2025-12-31T17:00:00.000Z')

  it('uses the operating timezone, not UTC', () => {
    expect(documentYear(newYearInSingapore, 'Asia/Singapore')).toBe(2026)
    expect(documentYear(newYearInSingapore, 'UTC')).toBe(2025)
  })

  it('handles a mid-year date', () => {
    expect(documentYear(new Date('2026-07-04T03:00:00.000Z'), 'Asia/Singapore')).toBe(2026)
  })
})
