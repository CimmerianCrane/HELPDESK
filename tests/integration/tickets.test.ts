import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, NotFoundError, RuleError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { resolveSlaTargets } from '@/server/sla/sla'
import {
  closeTicket,
  createTicket,
  getTicket,
  listTicketIntakeOptions,
  listTickets,
  openTicketStats,
  reopenTicket,
  triageTicket,
  updateTicket,
} from '@/server/tickets/tickets'
import {
  craneFixtures,
  inRolledBackTx,
  technicianFixture,
  testSuffix,
  type Tx,
} from './helpers'

/**
 * Tickets against the real database, inside a transaction that always rolls back.
 *
 * What is being proven here is not the SQL — Prisma handles that — but the rules around it: the
 * numbering, the audit trail, the one-way stamps (`respondedAt`, `closedAt`), the customer/crane
 * consistency checks, and that a technician can see the ticket they raised and no other.
 */

function contextFor(
  user: { id: string; name: string; email: string; role: Role },
  overrides: Partial<AuthContext> = {},
): AuthContext {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    technicianId: null,
    customerId: null,
    ip: '203.0.113.7',
    userAgent: 'vitest',
    ...overrides,
  }
}

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${role.toLowerCase()}-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

/** Accepts either a raw customer id or one of the fixture bundles the helpers return. */
function ticketInput(
  base: { customerId: string } | { customer: { id: string } },
  overrides: Record<string, unknown> = {},
) {
  return {
    source: 'PHONE',
    customerId: 'customerId' in base ? base.customerId : base.customer.id,
    description: 'Hoist will not raise above the second limit.',
    ...overrides,
  }
}

describe('recording a ticket', () => {
  it('allocates a ticket number, starts in NEW, and writes an audit entry', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      const ticket = await createTicket(
        contextFor(dispatcher),
        ticketInput(base, { craneId: base.crane.id, priority: 'P2' }),
        tx,
      )

      expect(ticket.number).toMatch(/^TKT-\d{4}-\d{4,}$/)
      expect(ticket.status).toBe('NEW')
      expect(ticket.priority).toBe('P2')
      expect(ticket.site?.id).toBe(base.site.id)
      expect(ticket.crane?.id).toBe(base.crane.id)
      // Default P2 target: two hours.
      expect(ticket.sla.targets.responseMinutes).toBe(120)
      expect(ticket.sla.response.dueAt).not.toBeNull()

      const logs = await tx.auditLog.findMany({
        where: { entity: 'Ticket', entityId: ticket.id },
      })
      expect(logs).toHaveLength(1)
      expect(logs[0]?.action).toBe('CREATE')
      expect(logs[0]?.after).toMatchObject({ number: ticket.number, status: 'NEW' })
    })
  })

  it('derives the site from the crane, so a dispatch sheet cannot send someone to the wrong plant', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const otherSite = await tx.site.create({
        data: { customerId: base.customer.id, name: `Other ${testSuffix()}` },
      })

      await expect(
        createTicket(
          contextFor(dispatcher),
          ticketInput(base, { siteId: otherSite.id, craneId: base.crane.id }),
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)

      const ticket = await createTicket(
        contextFor(dispatcher),
        ticketInput(base, { craneId: base.crane.id }),
        tx,
      )
      expect(ticket.site?.id).toBe(base.site.id)
    })
  })

  it('refuses a crane belonging to another customer', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const mine = await craneFixtures(tx)
      const theirs = await craneFixtures(tx)

      await expect(
        createTicket(
          contextFor(dispatcher),
          ticketInput(mine, { craneId: theirs.crane.id }),
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('refuses an unknown customer', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      await expect(
        createTicket(contextFor(dispatcher), ticketInput({ customerId: 'no-such-customer' }), tx),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})

describe('P1 alerting', () => {
  it('writes an in-app and an email notification for every dispatcher and administrator', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const admin = await makeUser(tx, 'ADMIN')
      const base = await craneFixtures(tx)

      const ticket = await createTicket(
        contextFor(dispatcher),
        ticketInput(base, { priority: 'P1' }),
        tx,
      )

      const notifications = await tx.notification.findMany({
        where: { userId: { in: [dispatcher.id, admin.id] } },
        orderBy: [{ userId: 'asc' }, { channel: 'asc' }],
      })
      expect(notifications).toHaveLength(4)
      expect(notifications.filter((row) => row.channel === 'IN_APP')).toHaveLength(2)
      expect(notifications.filter((row) => row.channel === 'EMAIL')).toHaveLength(2)
      for (const row of notifications) {
        expect(row.title).toContain(ticket.number)
        expect(row.link).toBe(`/tickets/${ticket.id}`)
      }
    })
  })

  it('does not alert anyone for a P3', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      const ticket = await createTicket(
        contextFor(dispatcher),
        ticketInput(base, { priority: 'P3' }),
        tx,
      )

      const notifications = await tx.notification.findMany({ where: { link: `/tickets/${ticket.id}` } })
      expect(notifications).toHaveLength(0)
    })
  })
})

describe('triage', () => {
  it('sets the priority and stamps the response once, never moving it on a second triage', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const ticket = await createTicket(contextFor(dispatcher), ticketInput(base), tx)

      const triaged = await triageTicket(
        contextFor(dispatcher),
        ticket.id,
        { priority: 'P1', triageNotes: 'Sending Ahmad now.' },
        tx,
      )
      expect(triaged.status).toBe('TRIAGED')
      expect(triaged.priority).toBe('P1')
      expect(triaged.respondedAt).not.toBeNull()
      const firstResponse = triaged.respondedAt

      const retriaged = await triageTicket(
        contextFor(dispatcher),
        ticket.id,
        { priority: 'P2', triageNotes: 'Parts have to be ordered.' },
        tx,
      )
      expect(retriaged.respondedAt?.getTime()).toBe(firstResponse?.getTime())
      expect(retriaged.triageNotes).toContain('Parts have to be ordered.')
    })
  })

  it('refuses to triage a finished ticket until it is reopened', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const ticket = await createTicket(contextFor(dispatcher), ticketInput(base), tx)
      await closeTicket(contextFor(dispatcher), ticket.id, { outcome: 'CANCELLED', note: 'Duplicate' }, tx)

      await expect(
        triageTicket(contextFor(dispatcher), ticket.id, { priority: 'P1' }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('refuses to triage tickets at all for a technician', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const { user, technician } = await technicianFixture(tx)
      const base = await craneFixtures(tx)
      const ticket = await createTicket(contextFor(dispatcher), ticketInput(base), tx)

      await expect(
        triageTicket(contextFor(user, { technicianId: technician.id }), ticket.id, { priority: 'P1' }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})

describe('closing and reopening', () => {
  it('stamps closedAt, keeps the triage notes and appends the closing note', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const ticket = await createTicket(contextFor(dispatcher), ticketInput(base), tx)
      await triageTicket(contextFor(dispatcher), ticket.id, { priority: 'P3', triageNotes: 'Remote fix.' }, tx)

      const closed = await closeTicket(
        contextFor(dispatcher),
        ticket.id,
        { outcome: 'CLOSED', note: 'Guided the operator through the reset.' },
        tx,
      )
      expect(closed.status).toBe('CLOSED')
      expect(closed.closedAt).not.toBeNull()
      expect(closed.triageNotes).toContain('Remote fix.')
      expect(closed.triageNotes).toContain('[Closed] Guided the operator through the reset.')
    })
  })

  it('reopens to NEW and clears closedAt, so the resolution clock starts again', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const ticket = await createTicket(contextFor(dispatcher), ticketInput(base), tx)
      await closeTicket(contextFor(dispatcher), ticket.id, { outcome: 'CANCELLED' }, tx)

      const reopened = await reopenTicket(contextFor(dispatcher), ticket.id, tx)
      expect(reopened.status).toBe('NEW')
      expect(reopened.closedAt).toBeNull()
    })
  })

  it('cannot close an already closed ticket', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const ticket = await createTicket(contextFor(dispatcher), ticketInput(base), tx)
      await closeTicket(contextFor(dispatcher), ticket.id, { outcome: 'CLOSED' }, tx)

      await expect(
        closeTicket(contextFor(dispatcher), ticket.id, { outcome: 'CLOSED' }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })
})

describe('editing the record', () => {
  it('corrects the description and keeps the crane when the form carries it through', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const ticket = await createTicket(
        contextFor(dispatcher),
        ticketInput(base, { craneId: base.crane.id }),
        tx,
      )

      const updated = await updateTicket(
        contextFor(dispatcher),
        ticket.id,
        {
          description: 'Hoist brake slipping under load — not just the limit switch.',
          siteId: base.site.id,
          craneId: base.crane.id,
          triageNotes: '',
        },
        tx,
      )
      expect(updated.description).toContain('brake slipping')
      expect(updated.crane?.id).toBe(base.crane.id)

      const logs = await tx.auditLog.findMany({
        where: { entity: 'Ticket', entityId: ticket.id, action: 'UPDATE' },
      })
      expect(logs.length).toBeGreaterThan(0)
    })
  })
})

describe('who can see which tickets', () => {
  it('shows a technician only the ticket they raised, and nobody else’s', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const fromDispatcher = await createTicket(contextFor(dispatcher), ticketInput(base), tx)

      const { user, technician } = await technicianFixture(tx)
      const techContext = contextFor(user, { technicianId: technician.id })
      const fromTechnician = await createTicket(
        techContext,
        ticketInput(base, { description: 'Customer stopped me in the yard about this one.' }),
        tx,
      )

      const visible = await listTickets(techContext, {}, tx)
      expect(visible.map((ticket) => ticket.id)).toEqual([fromTechnician.id])

      await expect(getTicket(techContext, fromDispatcher.id, tx)).rejects.toBeInstanceOf(NotFoundError)
      expect((await getTicket(techContext, fromTechnician.id, tx)).id).toBe(fromTechnician.id)
    })
  })

  it('keeps finance out of the intake board entirely', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = await makeUser(tx, 'FINANCE')
      await expect(listTickets(contextFor(finance), {}, tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('gives a technician no intake options, because they cannot read the customer list', async () => {
    await inRolledBackTx(async (tx) => {
      const { user, technician } = await technicianFixture(tx)
      const options = await listTicketIntakeOptions(contextFor(user, { technicianId: technician.id }), tx)
      expect(options).toEqual([])
    })
  })

  it('filters the board by status, priority and search text', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const p2 = await createTicket(
        contextFor(dispatcher),
        ticketInput(base, { priority: 'P2', description: 'Slewing motor noisy.' }),
        tx,
      )
      await createTicket(contextFor(dispatcher), ticketInput(base, { priority: 'P1' }), tx)

      const p2Only = await listTickets(contextFor(dispatcher), { priority: 'P2' }, tx)
      expect(p2Only.map((ticket) => ticket.id)).toEqual([p2.id])

      const bySearch = await listTickets(contextFor(dispatcher), { q: 'slewing' }, tx)
      expect(bySearch.map((ticket) => ticket.id)).toEqual([p2.id])

      const noneClosed = await listTickets(contextFor(dispatcher), { status: 'CLOSED' }, tx)
      expect(noneClosed).toHaveLength(0)
    })
  })
})

describe('dashboard counters', () => {
  it('counts open tickets, breached responses and open P1s', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      await createTicket(contextFor(dispatcher), ticketInput(base, { priority: 'P1' }), tx)
      await createTicket(contextFor(dispatcher), ticketInput(base, { priority: 'P3' }), tx)
      const closed = await createTicket(contextFor(dispatcher), ticketInput(base), tx)
      await closeTicket(contextFor(dispatcher), closed.id, { outcome: 'CLOSED' }, tx)

      // Nine hours on: past the P1's 30-minute target and the P3's eight-hour one, but the closed
      // ticket is out of the count.
      const stats = await openTicketStats(contextFor(dispatcher), tx, new Date(Date.now() + 9 * 3600_000))
      expect(stats.open).toBe(2)
      expect(stats.breached).toBe(2)
      expect(stats.p1Open).toBe(1)
    })
  })
})

describe('SLA targets', () => {
  it('prefers a contract override and falls back to the company-wide row', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.slaPolicy.create({
        data: { priority: 'P2', contractId: null, responseMinutes: 120, resolutionMinutes: 480 },
      })
      await tx.slaPolicy.create({
        data: { priority: 'P2', contractId: 'contract-x', responseMinutes: 15, resolutionMinutes: 60 },
      })

      const company = await resolveSlaTargets('P2', null, tx)
      expect(company).toEqual({ responseMinutes: 120, resolutionMinutes: 480 })

      const override = await resolveSlaTargets('P2', 'contract-x', tx)
      expect(override).toEqual({ responseMinutes: 15, resolutionMinutes: 60 })

      const unknownContract = await resolveSlaTargets('P2', 'contract-y', tx)
      expect(unknownContract).toEqual({ responseMinutes: 120, resolutionMinutes: 480 })
    })
  })
})
