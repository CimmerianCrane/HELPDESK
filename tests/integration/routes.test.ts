import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { dayRoute } from '@/server/schedule/routes-service'
import { craneFixtures, inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * The day's round against the real database (slice 35).
 *
 * The ordering arithmetic is `tests/unit/routes.test.ts`; what can only be checked here is the
 * service around it — that the day window is the operating timezone's, that a site without
 * coordinates is set aside rather than dropped, that the technician filter narrows it, and that the
 * capability is enforced on the server.
 */

function contextFor(user: { id: string; name: string; email: string; role: Role }): AuthContext {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    technicianId: null,
    customerId: null,
    ip: '203.0.113.9',
    userAgent: 'vitest',
  }
}

async function makeUser(tx: Tx, role: Role) {
  const suffix = testSuffix()
  return tx.user.create({
    data: {
      email: `${role.toLowerCase()}-route-${suffix}@example.test`,
      name: `${role} ${suffix}`,
      role,
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
}

async function makeTechnician(tx: Tx) {
  const suffix = testSuffix()
  const user = await tx.user.create({
    data: {
      email: `tech-route-${suffix}@example.test`,
      name: `Tech ${suffix}`,
      role: 'TECHNICIAN',
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
  const technician = await tx.technician.create({ data: { userId: user.id } })
  return { user, technician }
}

/** A visit at a site, optionally with coordinates and a technician. */
async function visit(
  tx: Tx,
  base: { customer: { id: string }; jobType: { id: string } },
  options: {
    siteName: string
    latitude?: number
    longitude?: number
    start: Date
    technicianId?: string
  },
) {
  const suffix = testSuffix()
  const site = await tx.site.create({
    data: {
      customerId: base.customer.id,
      name: `${options.siteName} ${suffix}`,
      latitude: options.latitude ?? null,
      longitude: options.longitude ?? null,
    },
  })
  const job = await tx.job.create({
    data: {
      number: `JOB-ROUTE-${suffix}`,
      jobTypeId: base.jobType.id,
      customerId: base.customer.id,
      siteId: site.id,
      status: 'SCHEDULED',
      priority: 'P3',
      scheduledStart: options.start,
      scheduledEnd: new Date(options.start.getTime() + 2 * 3_600_000),
    },
  })
  if (options.technicianId) {
    await tx.jobTechnician.create({
      data: { jobId: job.id, technicianId: options.technicianId, isLead: true },
    })
  }
  return { job, site }
}

describe('the day route', () => {
  it('orders the day from the first scheduled visit and measures each leg', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)

      const first = await visit(tx, base, {
        siteName: 'Jurong',
        latitude: 1.3119,
        longitude: 103.7086,
        start: new Date('2026-10-26T01:00:00Z'),
        technicianId: technician.id,
      })
      const far = await visit(tx, base, {
        siteName: 'Changi',
        latitude: 1.3574,
        longitude: 103.9876,
        start: new Date('2026-10-26T05:00:00Z'),
        technicianId: technician.id,
      })
      const near = await visit(tx, base, {
        siteName: 'Tuas',
        latitude: 1.316,
        longitude: 103.659,
        start: new Date('2026-10-26T03:00:00Z'),
        technicianId: technician.id,
      })

      const route = await dayRoute(
        contextFor(dispatcher),
        { date: '2026-10-26' },
        tx,
        new Date('2026-10-26T00:00:00Z'),
      )

      const ids = route.stops.map((stop) => stop.jobId)
      expect(ids[0]).toBe(first.job.id)
      // Tuas is far closer to Jurong than Changi is, so it comes next.
      expect(ids.slice(0, 2)).toEqual([first.job.id, near.job.id])
      expect(ids).toContain(far.job.id)
      expect(route.stops[0]!.legKm).toBe(0)
      expect(route.stops[1]!.legKm).toBeGreaterThan(0)
      expect(route.totalKm).toBeGreaterThan(0)
      expect(route.driveMinutes).toBe(Math.round((route.totalKm / route.averageSpeedKmh) * 60))
    })
  })

  it('sets a site with no coordinates aside rather than dropping it', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      const placed = await visit(tx, base, {
        siteName: 'Placed',
        latitude: 1.31,
        longitude: 103.71,
        start: new Date('2026-10-26T01:00:00Z'),
      })
      const lost = await visit(tx, base, {
        siteName: 'Unlocated',
        start: new Date('2026-10-26T02:00:00Z'),
      })

      const route = await dayRoute(
        contextFor(dispatcher),
        { date: '2026-10-26' },
        tx,
        new Date('2026-10-26T00:00:00Z'),
      )

      expect(route.stops.map((stop) => stop.jobId)).toEqual([placed.job.id])
      expect(route.unlocated.map((stop) => stop.jobId)).toEqual([lost.job.id])
    })
  })

  it('leaves out the day before and the day after', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      const today = await visit(tx, base, {
        siteName: 'Today',
        latitude: 1.31,
        longitude: 103.71,
        start: new Date('2026-10-26T01:00:00Z'),
      })
      const tomorrow = await visit(tx, base, {
        siteName: 'Tomorrow',
        latitude: 1.31,
        longitude: 103.71,
        start: new Date('2026-10-27T01:00:00Z'),
      })

      const route = await dayRoute(
        contextFor(dispatcher),
        { date: '2026-10-26' },
        tx,
        new Date('2026-10-26T00:00:00Z'),
      )

      const ids = route.stops.map((stop) => stop.jobId)
      expect(ids).toContain(today.job.id)
      expect(ids).not.toContain(tomorrow.job.id)
    })
  })

  it('narrows to one technician’s visits when asked', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const { technician } = await makeTechnician(tx)
      const { technician: other } = await makeTechnician(tx)

      const mine = await visit(tx, base, {
        siteName: 'Mine',
        latitude: 1.31,
        longitude: 103.71,
        start: new Date('2026-10-26T01:00:00Z'),
        technicianId: technician.id,
      })
      const theirs = await visit(tx, base, {
        siteName: 'Theirs',
        latitude: 1.32,
        longitude: 103.72,
        start: new Date('2026-10-26T02:00:00Z'),
        technicianId: other.id,
      })

      const route = await dayRoute(
        contextFor(dispatcher),
        { date: '2026-10-26', technicianId: technician.id },
        tx,
        new Date('2026-10-26T00:00:00Z'),
      )

      const ids = route.stops.map((stop) => stop.jobId)
      expect(ids).toEqual([mine.job.id])
      expect(ids).not.toContain(theirs.job.id)
    })
  })

  it('refuses a role that may not schedule', async () => {
    await inRolledBackTx(async (tx) => {
      const technicianUser = await makeUser(tx, 'TECHNICIAN')
      await expect(
        dayRoute(contextFor(technicianUser), { date: '2026-10-26' }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})
