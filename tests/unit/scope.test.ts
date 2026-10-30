import { describe, expect, it } from 'vitest'
import {
  craneReadWhere,
  customerReadWhere,
  jobReadWhere,
  reportReadWhere,
} from '@/server/auth/scope'
import type { AuthContext, Role } from '@/server/auth/types'

function ctx(role: Role, overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-1',
    name: `Test ${role}`,
    email: `${role.toLowerCase()}@example.test`,
    role,
    technicianId: role === 'TECHNICIAN' ? 'tech-1' : null,
    customerId: null,
    ip: null,
    userAgent: null,
    ...overrides,
  }
}

const DENY = { id: '__denied__' }

describe('job scope', () => {
  it('restricts a technician to the jobs they are assigned to', () => {
    expect(jobReadWhere(ctx('TECHNICIAN'))).toEqual({
      deletedAt: null,
      technicians: { some: { technicianId: 'tech-1' } },
    })
  })

  it('restricts one technician to their own jobs and not another technician’s', () => {
    const a = jobReadWhere(ctx('TECHNICIAN', { technicianId: 'tech-a' }))
    const b = jobReadWhere(ctx('TECHNICIAN', { technicianId: 'tech-b' }))
    expect(a).not.toEqual(b)
    expect(JSON.stringify(a)).toContain('tech-a')
    expect(JSON.stringify(a)).not.toContain('tech-b')
  })

  /** Fail closed: a technician row without a Technician record must see nothing, not everything. */
  it('denies a technician whose technician record is missing', () => {
    expect(jobReadWhere(ctx('TECHNICIAN', { technicianId: null }))).toEqual(DENY)
  })

  it('denies a role that holds neither read capability and is not a customer', () => {
    expect(jobReadWhere(ctx('CUSTOMER'))).toEqual(DENY)
  })

  it('scopes a customer user to their own jobs', () => {
    expect(jobReadWhere(ctx('CUSTOMER', { customerId: 'cust-9' }))).toEqual({
      deletedAt: null,
      customerId: 'cust-9',
    })
  })

  it('does not restrict office roles that hold job.read.all', () => {
    for (const role of ['ADMIN', 'DISPATCHER', 'STOREKEEPER', 'FINANCE'] as Role[]) {
      expect(jobReadWhere(ctx(role))).toEqual({ deletedAt: null })
    }
  })
})

describe('report scope', () => {
  it('restricts a technician to reports on their own jobs', () => {
    expect(reportReadWhere(ctx('TECHNICIAN', { technicianId: 'tech-a' }))).toEqual({
      job: { technicians: { some: { technicianId: 'tech-a' } } },
    })
  })

  it('denies a technician with no technician record', () => {
    expect(reportReadWhere(ctx('TECHNICIAN', { technicianId: null }))).toEqual(DENY)
  })

  it('scopes a customer user to reports on their own cranes', () => {
    expect(reportReadWhere(ctx('CUSTOMER', { customerId: 'cust-9' }))).toEqual({
      crane: { customerId: 'cust-9' },
    })
  })

  it('does not filter reports by deletion, because reports are never deleted', () => {
    expect(reportReadWhere(ctx('ADMIN'))).toEqual({})
  })
})

describe('crane scope', () => {
  it('gives a technician only the cranes on their jobs and at those sites', () => {
    const filter = craneReadWhere(ctx('TECHNICIAN', { technicianId: 'tech-a' })) as {
      OR: unknown[]
    }
    expect(filter.OR).toHaveLength(2)
    expect(JSON.stringify(filter)).toContain('tech-a')
  })

  it('gives the whole register to office roles', () => {
    for (const role of ['ADMIN', 'DISPATCHER', 'STOREKEEPER', 'FINANCE'] as Role[]) {
      expect(craneReadWhere(ctx(role))).toEqual({ deletedAt: null })
    }
  })

  /** Slice 31: a portal login holds `crane.read`, and the filter narrows it to that customer's cranes. */
  it('scopes a customer user to their own cranes', () => {
    expect(craneReadWhere(ctx('CUSTOMER', { customerId: 'cust-9' }))).toEqual({
      deletedAt: null,
      customerId: 'cust-9',
    })
  })

  it('denies a customer user with no customer, rather than opening the register', () => {
    expect(craneReadWhere(ctx('CUSTOMER'))).toEqual(DENY)
  })
})

describe('customer scope', () => {
  it('gives technicians nothing, since they hold no customer.read', () => {
    expect(customerReadWhere(ctx('TECHNICIAN'))).toEqual(DENY)
  })

  it('gives office roles the book', () => {
    for (const role of ['ADMIN', 'DISPATCHER', 'FINANCE'] as Role[]) {
      expect(customerReadWhere(ctx(role))).toEqual({ deletedAt: null })
    }
  })

  it('gives a storekeeper nothing, since they hold no customer.read', () => {
    expect(customerReadWhere(ctx('STOREKEEPER'))).toEqual(DENY)
  })
})

describe('every scope filter', () => {
  it('hides soft-deleted rows wherever the entity supports soft deletion', () => {
    const filters = [
      jobReadWhere(ctx('ADMIN')),
      craneReadWhere(ctx('ADMIN')),
      customerReadWhere(ctx('ADMIN')),
    ]
    for (const filter of filters) {
      expect(filter).toMatchObject({ deletedAt: null })
    }
  })
})
