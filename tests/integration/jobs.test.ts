import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, NotFoundError, RuleError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  convertTicketToJobs,
  createJob,
  getJob,
  listJobs,
  openJobStats,
  transitionJob,
  updateJob,
} from '@/server/jobs/jobs'
import { createTicket, triageTicket } from '@/server/tickets/tickets'
import { craneFixtures, inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * Jobs against the real database, inside a transaction that always rolls back.
 *
 * The interesting rules are the ones that cannot be seen in the SQL: the numbering, the SLA snapshot
 * taken at creation, the history row written with every move, the stamp that is never overwritten,
 * and the refusal to file a job against somebody else's crane or two sites at once.
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
    ip: '203.0.113.9',
    userAgent: 'vitest',
    ...overrides,
  }
}

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${role.toLowerCase()}-jobs-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

function jobInput(base: { customer: { id: string }; jobType: { id: string } }, overrides = {}) {
  return {
    customerId: base.customer.id,
    jobTypeId: base.jobType.id,
    description: 'Annual thorough examination.',
    priority: 'P3',
    ...overrides,
  }
}

describe('creating a job', () => {
  it('allocates a number, starts in NEW, snapshots the SLA and writes history plus audit', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      const job = await createJob(
        contextFor(dispatcher),
        jobInput(base, { craneIds: [base.crane.id] }),
        tx,
      )

      expect(job.number).toMatch(/^JOB-\d{4}-\d{4,}$/)
      expect(job.status).toBe('NEW')
      expect(job.site?.id).toBe(base.site.id)
      expect(job.cranes.map((crane) => crane.id)).toEqual([base.crane.id])
      expect(job.sla.response.dueAt).not.toBeNull()
      expect(job.sla.resolution.dueAt).not.toBeNull()

      const history = await tx.jobStatusHistory.findMany({ where: { jobId: job.id } })
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({ fromStatus: null, toStatus: 'NEW' })
      expect(history[0]?.changedById).toBe(dispatcher.id)

      const logs = await tx.auditLog.findMany({ where: { entity: 'Job', entityId: job.id } })
      expect(logs).toHaveLength(1)
      expect(logs[0]?.action).toBe('CREATE')
      expect(logs[0]?.after).toMatchObject({ number: job.number, status: 'NEW' })
    })
  })

  it('derives the site from the crane when none is given', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      const job = await createJob(
        contextFor(dispatcher),
        jobInput(base, { craneIds: [base.crane.id] }),
        tx,
      )
      expect(job.site?.id).toBe(base.site.id)
    })
  })

  it("refuses another customer's crane", async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const mine = await craneFixtures(tx)
      const theirs = await craneFixtures(tx)

      await expect(
        createJob(contextFor(dispatcher), jobInput(mine, { craneIds: [theirs.crane.id] }), tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('refuses cranes at two sites, because a job is one visit', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const secondSite = await tx.site.create({
        data: { customerId: base.customer.id, name: `Second ${testSuffix()}` },
      })
      const farCrane = await tx.crane.create({
        data: {
          siteId: secondSite.id,
          customerId: base.customer.id,
          assetTag: `TAG-FAR-${testSuffix()}`,
          qrValue: `QR-FAR-${testSuffix()}`,
          type: 'OVERHEAD',
          swlKg: 5000,
        },
      })

      await expect(
        createJob(
          contextFor(dispatcher),
          jobInput(base, { craneIds: [base.crane.id, farCrane.id] }),
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('refuses a job with no site and no cranes to take one from', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      await expect(createJob(contextFor(dispatcher), jobInput(base), tx)).rejects.toBeInstanceOf(
        RuleError,
      )
    })
  })

  it('alerts every dispatcher when a P1 job is raised directly', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      const job = await createJob(
        contextFor(dispatcher),
        jobInput(base, { craneIds: [base.crane.id], priority: 'P1' }),
        tx,
      )

      const notifications = await tx.notification.findMany({ where: { jobId: job.id } })
      expect(notifications.length).toBeGreaterThan(0)
      // Both channels are recorded separately, so a failed email cannot hide the in-app alert.
      expect(notifications.some((row) => row.channel === 'IN_APP')).toBe(true)
      expect(notifications.some((row) => row.channel === 'EMAIL')).toBe(true)
      expect(notifications.every((row) => row.jobId === job.id)).toBe(true)
    })
  })

  it('refuses a role without job.create', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = await makeUser(tx, 'FINANCE')
      const base = await craneFixtures(tx)

      await expect(
        createJob(contextFor(finance), jobInput(base, { craneIds: [base.crane.id] }), tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})

describe('moving a job', () => {
  async function scheduledJob(tx: Tx, dispatcher: { id: string; name: string; email: string; role: Role }) {
    const base = await craneFixtures(tx)
    const job = await createJob(
      contextFor(dispatcher),
      jobInput(base, { craneIds: [base.crane.id] }),
      tx,
    )
    return { job, base }
  }

  it('records history, audit and the response stamp', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const { job } = await scheduledJob(tx, dispatcher)

      const triaged = await transitionJob(contextFor(dispatcher), job.id, { status: 'TRIAGED' }, tx)
      expect(triaged.status).toBe('TRIAGED')
      expect(triaged.respondedAt).not.toBeNull()
      expect(triaged.sla.response.state).toBe('met')

      const history = await tx.jobStatusHistory.findMany({
        where: { jobId: job.id },
        orderBy: { changedAt: 'asc' },
      })
      expect(history.map((entry) => entry.toStatus)).toEqual(['NEW', 'TRIAGED'])
      expect(history[1]?.fromStatus).toBe('NEW')

      const logs = await tx.auditLog.findMany({ where: { entity: 'Job', entityId: job.id } })
      expect(logs.map((entry) => entry.action)).toEqual(['CREATE', 'UPDATE'])
    })
  })

  it('refuses an illegal move', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const { job } = await scheduledJob(tx, dispatcher)

      await expect(
        transitionJob(contextFor(dispatcher), job.id, { status: 'COMPLETED' }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('requires a reason to go on hold, and keeps it on the history', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const { job } = await scheduledJob(tx, dispatcher)
      const context = contextFor(dispatcher)

      await transitionJob(context, job.id, { status: 'TRIAGED' }, tx)
      await transitionJob(context, job.id, { status: 'SCHEDULED' }, tx)

      await expect(transitionJob(context, job.id, { status: 'ON_HOLD' }, tx)).rejects.toThrow()

      const held = await transitionJob(
        context,
        job.id,
        {
          status: 'ON_HOLD',
          onHoldReason: 'AWAITING_PARTS',
          note: 'Waiting on a hoist brake.',
        },
        tx,
      )
      expect(held.status).toBe('ON_HOLD')
      expect(held.onHoldReason).toBe('AWAITING_PARTS')
      expect(held.onHoldNote).toBe('Waiting on a hoist brake.')

      const last = await tx.jobStatusHistory.findFirst({
        where: { jobId: job.id, toStatus: 'ON_HOLD' },
      })
      expect(last?.onHoldReason).toBe('AWAITING_PARTS')
      expect(last?.reason).toBe('Waiting on a hoist brake.')
    })
  })

  it('clears the hold reason when the job comes off hold', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const { job } = await scheduledJob(tx, dispatcher)
      const context = contextFor(dispatcher)

      await transitionJob(context, job.id, { status: 'TRIAGED' }, tx)
      await transitionJob(context, job.id, { status: 'SCHEDULED' }, tx)
      await transitionJob(context, job.id, { status: 'ON_HOLD', onHoldReason: 'WEATHER' }, tx)
      const back = await transitionJob(context, job.id, { status: 'SCHEDULED' }, tx)
      expect(back.onHoldReason).toBeNull()
    })
  })

  it('does not overwrite the first arrival time on rework', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const { job } = await scheduledJob(tx, dispatcher)
      const context = contextFor(dispatcher)

      await transitionJob(context, job.id, { status: 'TRIAGED' }, tx)
      await transitionJob(context, job.id, { status: 'SCHEDULED' }, tx)
      await transitionJob(context, job.id, { status: 'DISPATCHED' }, tx)
      await transitionJob(context, job.id, { status: 'IN_PROGRESS' }, tx)
      const firstVisit = await tx.job.findUniqueOrThrow({
        where: { id: job.id },
        select: { onSiteAt: true },
      })
      expect(firstVisit.onSiteAt).not.toBeNull()

      await transitionJob(context, job.id, { status: 'COMPLETED' }, tx)
      await transitionJob(context, job.id, { status: 'IN_PROGRESS', note: 'Rework' }, tx)

      const onSite = await tx.job.findUniqueOrThrow({
        where: { id: job.id },
        select: { onSiteAt: true },
      })
      expect(onSite.onSiteAt?.getTime()).toBe(firstVisit.onSiteAt!.getTime())
    })
  })

  it('refuses a role without job.transition', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const storekeeper = await makeUser(tx, 'STOREKEEPER')
      const { job } = await scheduledJob(tx, dispatcher)

      await expect(
        transitionJob(contextFor(storekeeper), job.id, { status: 'TRIAGED' }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})

describe('converting a ticket', () => {
  it('creates the jobs, links them and marks the ticket CONVERTED', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const context = contextFor(dispatcher)

      const ticket = await createTicket(
        context,
        {
          source: 'PHONE',
          customerId: base.customer.id,
          craneId: base.crane.id,
          description: 'Brake slipping under load.',
          priority: 'P2',
        },
        tx,
      )
      await triageTicket(context, ticket.id, { status: 'TRIAGED', priority: 'P2' }, tx)

      const jobs = await convertTicketToJobs(
        context,
        ticket.id,
        {
          jobs: [
            { jobTypeId: base.jobType.id, priority: 'P2', description: 'Replace brake lining.' },
            { jobTypeId: base.jobType.id, priority: 'P3', description: 'Load test after repair.' },
          ],
        },
        tx,
      )

      expect(jobs).toHaveLength(2)
      for (const job of jobs) {
        expect(job.ticket?.id).toBe(ticket.id)
        expect(job.site?.id).toBe(base.site.id)
        expect(job.cranes.map((crane) => crane.id)).toEqual([base.crane.id])
        expect(job.reportedAt?.getTime()).toBe(ticket.reportedAt.getTime())
      }

      const updated = await tx.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { status: true, closedAt: true },
      })
      expect(updated.status).toBe('CONVERTED')
      expect(updated.closedAt).not.toBeNull()

      await expect(
        convertTicketToJobs(context, ticket.id, { jobs: [{ jobTypeId: base.jobType.id }] }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('refuses a closed ticket', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const context = contextFor(dispatcher)

      const ticket = await createTicket(
        context,
        {
          source: 'PHONE',
          customerId: base.customer.id,
          craneId: base.crane.id,
          description: 'Nothing to do after all.',
        },
        tx,
      )
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      })

      await expect(
        convertTicketToJobs(context, ticket.id, { jobs: [{ jobTypeId: base.jobType.id }] }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })
})

describe('reading jobs', () => {
  it('lets finance read a job but not change it', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const finance = await makeUser(tx, 'FINANCE')
      const base = await craneFixtures(tx)

      const job = await createJob(
        contextFor(dispatcher),
        jobInput(base, { craneIds: [base.crane.id] }),
        tx,
      )

      const seen = await getJob(contextFor(finance), job.id, tx)
      expect(seen.number).toBe(job.number)
      expect(await listJobs(contextFor(finance), {}, tx)).toHaveLength(1)

      await expect(
        updateJob(contextFor(finance), job.id, { description: 'Changed by finance' }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('shows a job to nobody when the id belongs to a deleted job', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const job = await createJob(
        contextFor(dispatcher),
        jobInput(base, { craneIds: [base.crane.id] }),
        tx,
      )
      await tx.job.update({ where: { id: job.id }, data: { deletedAt: new Date() } })

      await expect(getJob(contextFor(dispatcher), job.id, tx)).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  it('counts what is open and what has missed a target', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const context = contextFor(dispatcher)

      await createJob(context, jobInput(base, { craneIds: [base.crane.id], priority: 'P1' }), tx)
      const settled = await createJob(
        context,
        jobInput(base, { craneIds: [base.crane.id], priority: 'P4' }),
        tx,
      )
      await tx.job.update({
        where: { id: settled.id },
        data: { status: 'CANCELLED', closedAt: new Date(), respondedAt: new Date() },
      })

      const stats = await openJobStats(context, tx)
      expect(stats.open).toBe(1)
      expect(stats.p1Open).toBe(1)
      expect(stats.onHold).toBe(0)
    })
  })
})
