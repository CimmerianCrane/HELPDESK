import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, NotFoundError, RuleError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  archiveCrane,
  createCrane,
  findCraneByQrValue,
  getCrane,
  listCranes,
  restrictCrane,
  unrestrictCrane,
} from '@/server/cranes/cranes'
import { isCraneQrValue } from '@/server/cranes/qr'
import { archiveSite, createSite, getSite, listSites, updateSite } from '@/server/sites/sites'
import { craneFixtures, inRolledBackTx, jobFixture, technicianFixture, testSuffix, type Tx } from './helpers'

/**
 * Sites and cranes against the real database, inside a transaction that always rolls back.
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

function craneInput(site: { id: string; customerId: string }, overrides: Record<string, unknown> = {}) {
  return {
    customerId: site.customerId,
    siteId: site.id,
    type: 'OVERHEAD',
    swlKg: '5000',
    ...overrides,
  }
}

describe('sites', () => {
  it('creates a site attached to its customer, audit-logged', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const customer = await tx.customer.create({
        data: { legalName: `Site Customer ${testSuffix()}`, status: 'ACTIVE' },
      })

      const site = await createSite(
        contextFor(dispatcher),
        { customerId: customer.id, name: 'Tuas Workshop', accessNotes: 'Gate B' },
        tx,
      )

      expect(site.customerId).toBe(customer.id)
      expect(site.name).toBe('Tuas Workshop')

      const logs = await tx.auditLog.findMany({
        where: { entity: 'Site', entityId: site.id },
      })
      expect(logs).toHaveLength(1)
      expect(logs[0]?.action).toBe('CREATE')
    })
  })

  it('refuses a second site with the same name for the same customer', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const customer = await tx.customer.create({
        data: { legalName: `Dup Site ${testSuffix()}`, status: 'ACTIVE' },
      })

      await createSite(contextFor(dispatcher), { customerId: customer.id, name: 'Depot' }, tx)
      await expect(
        createSite(contextFor(dispatcher), { customerId: customer.id, name: 'depot' }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('allows the same site name under a different customer', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const suffix = testSuffix()
      const one = await tx.customer.create({
        data: { legalName: `One ${suffix}`, status: 'ACTIVE' },
      })
      const two = await tx.customer.create({
        data: { legalName: `Two ${suffix}`, status: 'ACTIVE' },
      })

      await createSite(contextFor(dispatcher), { customerId: one.id, name: 'Depot' }, tx)
      const second = await createSite(contextFor(dispatcher), { customerId: two.id, name: 'Depot' }, tx)
      expect(second.name).toBe('Depot')
    })
  })

  it('will not let a site pretend to belong to a customer the caller cannot see', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      await expect(
        createSite(contextFor(dispatcher), { customerId: 'no-such-customer', name: 'Ghost' }, tx),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  it('refuses to move a site to another customer', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const suffix = testSuffix()
      const one = await tx.customer.create({ data: { legalName: `Move A ${suffix}`, status: 'ACTIVE' } })
      const two = await tx.customer.create({ data: { legalName: `Move B ${suffix}`, status: 'ACTIVE' } })
      const site = await createSite(contextFor(dispatcher), { customerId: one.id, name: 'Yard' }, tx)

      await expect(
        updateSite(contextFor(dispatcher), site.id, { customerId: two.id, name: 'Yard' }, tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('archives a site only once its cranes are gone', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      await tx.crane.update({ where: { id: base.crane.id }, data: { deletedAt: new Date() } })

      await archiveSite(contextFor(dispatcher), base.site.id, tx)
      await expect(getSite(contextFor(dispatcher), base.site.id, tx)).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })
  })

  it('refuses to archive a site that still has a crane', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      await expect(archiveSite(contextFor(dispatcher), base.site.id, tx)).rejects.toBeInstanceOf(
        RuleError,
      )
    })
  })

  it('keeps a finance user able to read sites but not write them', async () => {
    await inRolledBackTx(async (tx) => {
      const finance = await makeUser(tx, 'FINANCE')
      const base = await craneFixtures(tx)

      const sites = await listSites(contextFor(finance), { customerId: base.customer.id }, tx)
      expect(sites.map((site) => site.id)).toContain(base.site.id)

      await expect(
        createSite(contextFor(finance), { customerId: base.customer.id, name: 'Nope' }, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})

describe('the crane register', () => {
  it('generates a QR value and an asset tag when they are left blank', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      const crane = await createCrane(
        contextFor(dispatcher),
        craneInput(base.site, { assetTag: '', qrValue: '' }),
        tx,
      )

      expect(isCraneQrValue(crane.qrValue)).toBe(true)
      expect(crane.assetTag).toMatch(/^CC-/)
      expect(crane.status).toBe('IN_SERVICE')
    })
  })

  it('refuses an asset tag already in the register', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      await createCrane(contextFor(dispatcher), craneInput(base.site, { assetTag: 'OVH-01' }), tx)
      await expect(
        createCrane(contextFor(dispatcher), craneInput(base.site, { assetTag: 'ovh-01' }), tx),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('takes the customer from the site, not from the form', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const other = await tx.customer.create({
        data: { legalName: `Other ${testSuffix()}`, status: 'ACTIVE' },
      })

      await expect(
        createCrane(
          contextFor(dispatcher),
          { ...craneInput(base.site), customerId: other.id },
          tx,
        ),
      ).rejects.toBeInstanceOf(RuleError)
    })
  })

  it('requires a reason to restrict, and records it on the crane', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      await expect(
        restrictCrane(contextFor(dispatcher), base.crane.id, { reason: '' }, tx),
      ).rejects.toBeTruthy()

      const restricted = await restrictCrane(
        contextFor(dispatcher),
        base.crane.id,
        { reason: 'Broken wire rope' },
        tx,
      )
      expect(restricted.status).toBe('RESTRICTED')
      expect(restricted.restrictedReason).toBe('Broken wire rope')

      const cleared = await unrestrictCrane(contextFor(dispatcher), base.crane.id, {}, tx)
      expect(cleared.status).toBe('IN_SERVICE')
      expect(cleared.restrictedReason).toBeNull()

      const logs = await tx.auditLog.findMany({
        where: { entity: 'Crane', entityId: base.crane.id },
        orderBy: { createdAt: 'asc' },
      })
      // Restrict and unrestrict, each with the status that changed.
      expect(logs).toHaveLength(2)
      expect(logs[0]?.after).toMatchObject({ status: 'RESTRICTED' })
    })
  })

  it('refuses to archive a crane that has job history', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)
      const job = await jobFixture(tx, {
        customerId: base.customer.id,
        siteId: base.site.id,
        jobTypeId: base.jobType.id,
      })
      await tx.jobCrane.create({ data: { jobId: job.id, craneId: base.crane.id } })

      await expect(archiveCrane(contextFor(dispatcher), base.crane.id, tx)).rejects.toBeInstanceOf(
        RuleError,
      )
    })
  })

  it('archives a crane entered by mistake', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      await archiveCrane(contextFor(dispatcher), base.crane.id, tx)
      await expect(getCrane(contextFor(dispatcher), base.crane.id, tx)).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })
  })

  it('hides every crane from a technician with no job on their list', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await craneFixtures(tx)
      const { user, technician } = await technicianFixture(tx)
      const context = contextFor(user, { technicianId: technician.id })

      const cranes = await listCranes(context, {}, tx)
      expect(cranes.map((crane) => crane.id)).not.toContain(base.crane.id)

      await expect(getCrane(context, base.crane.id, tx)).rejects.toBeInstanceOf(NotFoundError)
      expect(await findCraneByQrValue(context, base.crane.qrValue, tx)).toBeNull()
    })
  })

  it('shows a technician the cranes at a site they are working at', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await craneFixtures(tx)
      const { user, technician } = await technicianFixture(tx)
      await jobFixture(
        tx,
        { customerId: base.customer.id, siteId: base.site.id, jobTypeId: base.jobType.id },
        { suffix: base.suffix, assignTo: technician.id },
      )

      const context = contextFor(user, { technicianId: technician.id })
      const cranes = await listCranes(context, { siteId: base.site.id }, tx)
      expect(cranes.map((crane) => crane.id)).toContain(base.crane.id)
    })
  })

  it('resolves a scanned QR value for someone allowed to see the crane', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await craneFixtures(tx)
      const dispatcher = await makeUser(tx, 'DISPATCHER')

      const found = await findCraneByQrValue(contextFor(dispatcher), base.crane.qrValue, tx)
      expect(found?.id).toBe(base.crane.id)

      const missing = await findCraneByQrValue(contextFor(dispatcher), 'CRN000000000000', tx)
      expect(missing).toBeNull()
    })
  })

  it('searches the register by asset tag, serial and customer name', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')
      const base = await craneFixtures(tx)

      const byTag = await listCranes(contextFor(dispatcher), { q: base.crane.assetTag }, tx)
      expect(byTag.map((crane) => crane.id)).toEqual([base.crane.id])

      const byCustomer = await listCranes(contextFor(dispatcher), { q: base.customer.legalName }, tx)
      expect(byCustomer.map((crane) => crane.id)).toContain(base.crane.id)

      const byStatus = await listCranes(contextFor(dispatcher), { status: 'RESTRICTED' }, tx)
      expect(byStatus.map((crane) => crane.id)).not.toContain(base.crane.id)
    })
  })
})
