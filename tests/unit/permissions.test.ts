import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import {
  CAPABILITIES,
  ROLE_CAPABILITIES,
  can,
  capabilitiesFor,
  type Capability,
} from '@/server/auth/permissions'

const ROLES = Object.keys(ROLE_CAPABILITIES) as Role[]

describe('the permission map', () => {
  it('grants Admin every declared capability, without listing them', () => {
    for (const capability of CAPABILITIES) {
      expect(can('ADMIN', capability), `Admin should hold ${capability}`).toBe(true)
    }
  })

  it('has an entry for every role', () => {
    const expected: Role[] = [
      'ADMIN',
      'DISPATCHER',
      'TECHNICIAN',
      'STOREKEEPER',
      'FINANCE',
      'CUSTOMER',
    ]
    expect(ROLES.sort()).toEqual(expected.sort())
  })

  it('never lists a capability twice for a role', () => {
    for (const role of ROLES) {
      const granted = ROLE_CAPABILITIES[role]
      expect(new Set(granted).size, `${role} has a duplicate grant`).toBe(granted.length)
    }
  })

  it('grants nothing that is not a declared capability', () => {
    const declared = new Set<string>(CAPABILITIES)
    for (const role of ROLES) {
      for (const grant of ROLE_CAPABILITIES[role]) {
        if (grant === '*') continue
        expect(declared.has(grant), `${role} grants unknown capability ${grant}`).toBe(true)
      }
    }
  })

  /**
   * The brief's §12.9 rule, at the capability layer. Row-level scoping is proven separately in
   * tests/integration/isolation.test.ts; this proves the capability half.
   */
  it('does not give a technician the ability to read jobs or reports in bulk', () => {
    expect(can('TECHNICIAN', 'job.read.all')).toBe(false)
    expect(can('TECHNICIAN', 'report.read.all')).toBe(false)
    expect(can('TECHNICIAN', 'job.read.own')).toBe(true)
    expect(can('TECHNICIAN', 'report.read.own')).toBe(true)
  })

  it('does not let a technician browse the crane register', () => {
    expect(can('TECHNICIAN', 'crane.read')).toBe(true)
    expect(can('TECHNICIAN', 'crane.register.read')).toBe(false)
  })

  it('does not let a technician approve their own work', () => {
    expect(can('TECHNICIAN', 'report.approve')).toBe(false)
    expect(can('TECHNICIAN', 'report.amend')).toBe(false)
    expect(can('TECHNICIAN', 'job.approve')).toBe(false)
    expect(can('TECHNICIAN', 'job.bump')).toBe(false)
  })

  it('lets a technician raise a ticket and see their own, but never triage the queue', () => {
    // The row-level half of this — that "their own" really means only their own — is proven against
    // the database in tests/integration/tickets.test.ts.
    expect(can('TECHNICIAN', 'ticket.create')).toBe(true)
    expect(can('TECHNICIAN', 'ticket.read')).toBe(true)
    expect(can('TECHNICIAN', 'ticket.triage')).toBe(false)
    expect(can('TECHNICIAN', 'ticket.assign')).toBe(false)
  })

  it('is the dispatcher who owns the intake board', () => {
    expect(can('DISPATCHER', 'ticket.read')).toBe(true)
    expect(can('DISPATCHER', 'ticket.create')).toBe(true)
    expect(can('DISPATCHER', 'ticket.triage')).toBe(true)
    expect(can('FINANCE', 'ticket.read')).toBe(false)
  })

  it('does not let a technician see another customer or change the register', () => {
    expect(can('TECHNICIAN', 'customer.read')).toBe(false)
    expect(can('TECHNICIAN', 'customer.write')).toBe(false)
    expect(can('TECHNICIAN', 'crane.write')).toBe(false)
    expect(can('TECHNICIAN', 'crane.restrict')).toBe(false)
  })

  it('keeps administration away from every non-admin role', () => {
    for (const capability of ['user.manage', 'settings.manage', 'audit.read'] as Capability[]) {
      for (const role of ROLES.filter((r) => r !== 'ADMIN')) {
        expect(can(role, capability), `${role} should not hold ${capability}`).toBe(false)
      }
    }
  })

  it('keeps dispatchers out of administration and finance', () => {
    expect(can('DISPATCHER', 'job.read.all')).toBe(true)
    expect(can('DISPATCHER', 'job.schedule')).toBe(true)
    expect(can('DISPATCHER', 'user.manage')).toBe(false)
    expect(can('DISPATCHER', 'settings.manage')).toBe(false)
    expect(can('DISPATCHER', 'audit.read')).toBe(false)
    expect(can('DISPATCHER', 'invoice.write')).toBe(false)
    expect(can('DISPATCHER', 'pricing.approve')).toBe(false)
    expect(can('DISPATCHER', 'stocktake.approve')).toBe(false)
  })

  it('keeps the storekeeper out of job scheduling and approval', () => {
    expect(can('STOREKEEPER', 'stock.move')).toBe(true)
    expect(can('STOREKEEPER', 'part.write')).toBe(true)
    expect(can('STOREKEEPER', 'job.read.all')).toBe(true)
    expect(can('STOREKEEPER', 'job.schedule')).toBe(false)
    expect(can('STOREKEEPER', 'job.assign')).toBe(false)
    expect(can('STOREKEEPER', 'report.approve')).toBe(false)
  })

  /**
   * A delivery order is paperwork for parts the store already issued, so the people who hand parts
   * over (storekeeper) and who run the job (dispatcher) raise one. The technician issues the parts
   * from a phone but does not sign for them.
   */
  it('lets the storekeeper and dispatcher raise a delivery order, but not the technician', () => {
    expect(can('STOREKEEPER', 'deliveryorder.write')).toBe(true)
    expect(can('DISPATCHER', 'deliveryorder.write')).toBe(true)
    expect(can('TECHNICIAN', 'deliveryorder.write')).toBe(false)
    expect(can('FINANCE', 'deliveryorder.write')).toBe(false)
    expect(can('CUSTOMER', 'deliveryorder.write')).toBe(false)
  })

  it('keeps finance read-mostly', () => {
    expect(can('FINANCE', 'invoice.write')).toBe(true)
    expect(can('FINANCE', 'pricing.approve')).toBe(true)
    expect(can('FINANCE', 'report.financial')).toBe(true)
    expect(can('FINANCE', 'job.create')).toBe(false)
    expect(can('FINANCE', 'job.schedule')).toBe(false)
    expect(can('FINANCE', 'report.approve')).toBe(false)
    expect(can('FINANCE', 'stock.move')).toBe(false)
    expect(can('FINANCE', 'crane.write')).toBe(false)
  })

  it('leaves the customer portal role with no capabilities until Phase 4', () => {
    expect(capabilitiesFor('CUSTOMER')).toEqual([])
  })

  it('gives every non-customer role something to do', () => {
    for (const role of ROLES.filter((r) => r !== 'CUSTOMER')) {
      expect(capabilitiesFor(role).length, `${role} holds nothing`).toBeGreaterThan(0)
    }
  })
})
