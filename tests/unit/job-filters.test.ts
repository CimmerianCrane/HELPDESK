import { describe, expect, it } from 'vitest'
import { jobFilterSchema, pageNumber } from '@/lib/validation/jobs'

/**
 * The job-list filters (slice 10). These are the rules the screen, the export and any future caller
 * share, so the interesting cases are the ones a browser sends: empty strings, repeated keys, and a
 * hand-edited address bar.
 */

describe('the job filter schema', () => {
  it('turns the empty strings a form posts into "no filter"', () => {
    const parsed = jobFilterSchema.parse({
      q: '',
      status: '',
      priority: '',
      customerId: '',
      jobTypeId: '',
      ticketId: '',
      technicianId: '',
      from: '',
      to: '',
      sla: '',
      sort: '',
    })

    expect(parsed.status).toBeNull()
    expect(parsed.priority).toBeNull()
    expect(parsed.sla).toBeNull()
    expect(parsed.sort).toBeNull()
    expect(parsed.q).toBe('')
  })

  it('accepts every value the controls can send', () => {
    const parsed = jobFilterSchema.parse({
      status: 'ON_HOLD',
      priority: 'P1',
      technicianId: 'tech-1',
      from: '2026-03-01',
      to: '2026-03-31',
      sla: 'breached',
      sort: 'scheduled',
    })

    expect(parsed.status).toBe('ON_HOLD')
    expect(parsed.sla).toBe('breached')
    expect(parsed.sort).toBe('scheduled')
  })

  it('refuses a value that is not on the menu rather than silently ignoring it', () => {
    expect(() => jobFilterSchema.parse({ sla: 'maybe' })).toThrow()
    expect(() => jobFilterSchema.parse({ sort: 'alphabetical' })).toThrow()
    expect(() => jobFilterSchema.parse({ status: 'DONE' })).toThrow()
  })

  it('defaults every field when the page is opened with no query at all', () => {
    const parsed = jobFilterSchema.parse({})
    expect(parsed).toMatchObject({
      q: '',
      status: null,
      priority: null,
      customerId: '',
      jobTypeId: '',
      ticketId: '',
      technicianId: '',
      from: '',
      to: '',
      sla: null,
      sort: null,
    })
  })
})

describe('the page number', () => {
  it('falls back rather than throwing on anything that is not a page', () => {
    expect(pageNumber('3', 1)).toBe(3)
    expect(pageNumber(undefined, 1)).toBe(1)
    expect(pageNumber('abc', 1)).toBe(1)
    expect(pageNumber('0', 1)).toBe(1)
    expect(pageNumber('-2', 1)).toBe(1)
    expect(pageNumber('2.5', 1)).toBe(1)
  })
})
