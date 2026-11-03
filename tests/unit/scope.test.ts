import { describe, expect, it } from 'vitest'
import {
  craneReadWhere,
  customerReadWhere,
  jobReadWhere,
  notificationReadWhere,
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

/**
 * Slice 38. A notification is addressed to one person, and the inbox is read through that id. This is
 * the rule that stops a P1 appearing twice on somebody else's screen, and the reason there is no
 * "all notifications" capability to widen it.
 */
describe('notification scope', () => {
  it('narrows to the caller’s own rows for every role that holds notification.read', () => {
    for (const role of ['ADMIN', 'DISPATCHER', 'TECHNICIAN', 'STOREKEEPER', 'FINANCE'] as Role[]) {
      expect(notificationReadWhere(ctx(role))).toEqual({ userId: 'user-1' })
    }
  })

  it('never returns an unfiltered query, whatever the role', () => {
    const admin = notificationReadWhere(ctx('ADMIN'))
    expect(admin).not.toEqual({})
    expect(admin).toEqual({ userId: 'user-1' })
  })

  it('points two users at their own rows, never each other’s', () => {
    const a = notificationReadWhere(ctx('ADMIN', { userId: 'user-a' }))
    const b = notificationReadWhere(ctx('TECHNICIAN', { userId: 'user-b' }))
    expect(JSON.stringify(a)).toContain('user-a')
    expect(JSON.stringify(a)).not.toContain('user-b')
    expect(JSON.stringify(b)).not.toContain('user-a')
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
