import { describe, expect, it } from 'vitest'
import { APP_NAV, FIELD_BAR, fieldNavFor, navFor } from '@/server/auth/nav'

/**
 * The one nav list every shell renders. No database, no React — just the shape the rail relies on.
 *
 * What these pin: a technician sees their own list plus only what their role opens, and no list hands
 * the same destination to one person twice.
 */

describe('navFor', () => {
  it('gives an administrator the whole office list', () => {
    const hrefs = navFor('ADMIN').map((item) => item.href)
    expect(hrefs).toHaveLength(APP_NAV.length)
  })

  it('filters by capability, not by role name', () => {
    // A technician holds neither `job.read.all` nor `invoice.read`.
    const hrefs = navFor('TECHNICIAN').map((item) => item.href)
    expect(hrefs).not.toContain('/jobs')
    expect(hrefs).not.toContain('/invoices')
    expect(hrefs).toContain('/inbox')
  })

  it('declares no destination twice in one list', () => {
    for (const role of ['ADMIN', 'DISPATCHER', 'TECHNICIAN', 'STOREKEEPER', 'FINANCE'] as const) {
      const hrefs = navFor(role).map((item) => item.href)
      expect(new Set(hrefs).size, `${role} nav has a duplicate`).toBe(hrefs.length)
    }
  })

  it('gives every destination a label, a group and a mark', () => {
    for (const item of APP_NAV) {
      expect(item.label).toBeTruthy()
      expect(item.group).toBeTruthy()
      expect(item.icon).toBeTruthy()
    }
  })
})

describe('fieldNavFor', () => {
  it('puts My jobs first, before anything else the role may open', () => {
    const items = fieldNavFor('TECHNICIAN')
    expect(items[0]).toMatchObject({ href: '/m/jobs', group: 'Field' })
  })

  it('does not hand the field list a duplicate of the office list', () => {
    const hrefs = fieldNavFor('TECHNICIAN').map((item) => item.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})

describe('FIELD_BAR', () => {
  it('offers only destinations a technician actually has', () => {
    const hrefs = new Set(fieldNavFor('TECHNICIAN').map((item) => item.href))
    for (const href of FIELD_BAR) expect(hrefs.has(href), `${href} is not in the field nav`).toBe(true)
  })
})
