import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, NotFoundError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { auditEntityLabels, auditTrail, searchAuditLog } from '@/server/audit/audit'
import { createJob, listJobs } from '@/server/jobs/jobs'
import { deleteJobFilter, listSavedJobFilters, saveJobFilter } from '@/server/jobs/saved-filters'
import { craneFixtures, inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * Slice 10's reads against the real database: the job list's new filters, saved filters, and the
 * audit viewer.
 *
 * What cannot be seen without a database is what these tests exist for — that the technician filter
 * reaches through the join, that a date range is a range of instants rather than of strings, that a
 * saved filter belongs to exactly one person, and that the audit search is gated by the capability
 * rather than by the screen.
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
    ip: '203.0.113.9',
    userAgent: 'vitest',
    ...overrides,
  }
}

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${role.toLowerCase()}-s10-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

const TZ = 'Asia/Singapore'

describe('filtering the company-wide job list', () => {
  it('finds a job by the technician assigned to it', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const technician = await tx.technician.create({
        data: {
          user: {
            create: {
              email: `tech-s10-${base.suffix}@example.test`,
              name: `Tech ${base.suffix}`,
              role: 'TECHNICIAN',
              passwordHash: 'placeholder-not-a-real-hash',
            },
          },
        },
      })

      const context = contextFor(dispatcher)
      const withTech = await createJob(context, {
        customerId: base.customer.id,
        siteId: base.site.id,
        jobTypeId: base.jobType.id,
        craneIds: [base.crane.id],
        priority: 'P3',
      }, tx)
      const without = await createJob(context, {
        customerId: base.customer.id,
        siteId: base.site.id,
        jobTypeId: base.jobType.id,
        priority: 'P3',
      }, tx)

      await tx.jobTechnician.create({
        data: { jobId: withTech.id, technicianId: technician.id, isLead: true },
      })

      const found = await listJobs(context, { technicianId: technician.id }, tx, new Date(), TZ)
      const ids = found.map((row) => row.id)
      expect(ids).toContain(withTech.id)
      expect(ids).not.toContain(without.id)
    })
  })

  it('matches a visit date range against scheduled visits and undated jobs by when they were raised', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const context = contextFor(dispatcher)

      const scheduled = await createJob(context, {
        customerId: base.customer.id,
        siteId: base.site.id,
        jobTypeId: base.jobType.id,
        priority: 'P3',
      }, tx)
      const raisedOnly = await createJob(context, {
        customerId: base.customer.id,
        siteId: base.site.id,
        jobTypeId: base.jobType.id,
        priority: 'P3',
      }, tx)

      // A visit on 12 March 2026 at 10:00 Singapore; the other job has no visit and was raised now.
      const visit = new Date('2026-03-12T02:00:00Z')
      await tx.job.update({ where: { id: scheduled.id }, data: { scheduledStart: visit } })
      await tx.job.update({
        where: { id: raisedOnly.id },
        data: { reportedAt: new Date('2026-03-12T02:00:00Z') },
      })

      const inMarch = await listJobs(
        context,
        { from: '2026-03-01', to: '2026-03-31' },
        tx,
        new Date('2026-10-27T00:00:00Z'),
        TZ,
      )
      const ids = inMarch.map((row) => row.id)
      expect(ids).toContain(scheduled.id)
      expect(ids).toContain(raisedOnly.id)

      const inApril = await listJobs(
        context,
        { from: '2026-04-01', to: '2026-04-30' },
        tx,
        new Date('2026-10-27T00:00:00Z'),
        TZ,
      )
      expect(inApril.map((row) => row.id)).not.toContain(scheduled.id)
    })
  })

  it('filters by SLA state from the snapshotted deadline', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const context = contextFor(dispatcher)

      const job = await createJob(context, {
        customerId: base.customer.id,
        siteId: base.site.id,
        jobTypeId: base.jobType.id,
        priority: 'P1',
      }, tx)

      // A P1 has 30 minutes to respond. An hour after it was raised, nothing has been recorded.
      const later = new Date(Date.now() + 60 * 60_000)
      const breached = await listJobs(context, { sla: 'breached' }, tx, later, TZ)
      expect(breached.map((row) => row.id)).toContain(job.id)

      // Once both windows are met, the same filter stops matching it — the state, not the id, decides.
      await tx.job.update({
        where: { id: job.id },
        data: { respondedAt: new Date(), completedAt: new Date() },
      })
      const stillBreached = await listJobs(context, { sla: 'breached' }, tx, later, TZ)
      expect(stillBreached.map((row) => row.id)).not.toContain(job.id)
    })
  })
})

describe('saved job filters', () => {
  it('saves a view, replays it, and replaces rather than duplicates on the same name', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const context = contextFor(dispatcher)

      const first = await saveJobFilter(context, { name: 'P1s', query: 'priority=P1' }, tx)
      const second = await saveJobFilter(context, { name: 'P1s', query: 'priority=P1&sla=breached' }, tx)

      expect(second.id).toBe(first.id)
      expect(second.query).toBe('priority=P1&sla=breached')

      const filters = await listSavedJobFilters(context, tx)
      expect(filters).toHaveLength(1)
      expect(filters[0]!.name).toBe('P1s')
    })
  })

  it('keeps one person’s saved filters away from another’s, and refuses to delete theirs', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const finance = await makeUser(tx, 'FINANCE')

      const mine = await saveJobFilter(
        contextFor(dispatcher),
        { name: 'Mine', query: 'priority=P1' },
        tx,
      )

      expect(await listSavedJobFilters(contextFor(finance), tx)).toHaveLength(0)
      await expect(deleteJobFilter(contextFor(finance), mine.id, tx)).rejects.toBeInstanceOf(
        NotFoundError,
      )
      // The row is still there for its owner.
      expect(await listSavedJobFilters(contextFor(dispatcher), tx)).toHaveLength(1)
    })
  })

  it('requires a name', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      await expect(
        saveJobFilter(contextFor(dispatcher), { name: '   ', query: 'priority=P1' }, tx),
      ).rejects.toThrow()
    })
  })

  it('is not available to a role that cannot read the job list', async () => {
    await inRolledBackTx(async (tx) => {
      const technician = await makeUser(tx, 'TECHNICIAN')
      await expect(
        saveJobFilter(contextFor(technician), { name: 'Mine', query: 'priority=P1' }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
      await expect(listSavedJobFilters(contextFor(technician), tx)).rejects.toBeInstanceOf(
        ForbiddenError,
      )
    })
  })
})

describe('the audit viewer', () => {
  it('is admin-only', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      await expect(
        searchAuditLog(contextFor(dispatcher), {}, TZ),
      ).rejects.toBeInstanceOf(ForbiddenError)
      await expect(auditTrail(contextFor(dispatcher), 'Job', 'anything')).rejects.toBeInstanceOf(
        ForbiddenError,
      )
    })
  })

  it('narrows to one record, with the actor attached', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const context = contextFor(admin)

      const base = await craneFixtures(tx)
      const job = await createJob(context, {
        customerId: base.customer.id,
        siteId: base.site.id,
        jobTypeId: base.jobType.id,
        priority: 'P3',
      }, tx)

      const { rows, truncated } = await searchAuditLog(
        context,
        { entity: 'Job', entityId: job.id },
        TZ,
        tx,
      )
      expect(truncated).toBe(false)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.action).toBe('CREATE')
      expect(rows[0]!.userId).toBe(admin.id)
      expect(rows[0]!.user?.email).toBe(admin.email)

      const trail = await auditTrail(context, 'Job', job.id, 20, tx)
      expect(trail.map((entry) => entry.id)).toEqual(rows.map((entry) => entry.id))
    })
  })

  it('labels a job by its number rather than its id', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const base = await craneFixtures(tx)
      const job = await createJob(contextFor(admin), {
        customerId: base.customer.id,
        siteId: base.site.id,
        jobTypeId: base.jobType.id,
        priority: 'P3',
      }, tx)

      const labels = await auditEntityLabels(
        contextFor(admin),
        [{ entity: 'Job', entityId: job.id }],
        tx,
      )
      const label = labels.get(`Job:${job.id}`)
      expect(label?.label).toBe(job.number)
      expect(label?.href).toBe(`/jobs/${job.id}`)
    })
  })
})
