import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, NotFoundError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { myJobs, syncBundle, technicianJob } from '@/server/tech/my-jobs'
import { craneFixtures, inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * The technician's phone, against the real database.
 *
 * Two things can only be proven here. First, that the row-level scope actually narrows the queries —
 * a technician asking for somebody else's job gets "not found", not a page with the address on it.
 * Second, that the bundle really is the whole of what the phone shows: if the job detail needs a
 * query the sync did not make, the screen goes blank in a lift shaft, and no unit test would notice.
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

async function makeTechnician(tx: Tx, name = `Tech ${testSuffix()}`) {
  const suffix = testSuffix()
  const user = await tx.user.create({
    data: {
      email: `tech-mobile-${suffix}@example.test`,
      name,
      role: 'TECHNICIAN',
      passwordHash: 'placeholder-not-a-real-hash',
    },
  })
  const technician = await tx.technician.create({
    data: { userId: user.id, employeeNo: `E-${suffix}` },
  })
  return { user, technician, context: contextFor(user, { technicianId: technician.id }) }
}

/**
 * A site a technician can actually be sent to: an address, access notes, and somebody to ask for.
 * The additions are the point — they are the fields the phone reads that a plain fixture leaves
 * null, and a test that only proves "it did not crash" would pass on empties.
 */
async function siteFixtures(tx: Tx) {
  const base = await craneFixtures(tx)
  const suffix = testSuffix()

  await tx.site.update({
    where: { id: base.site.id },
    data: {
      address: { line1: '12 Tuas Avenue 3', city: 'Singapore', postalCode: '639301' },
      accessNotes: 'Report to the guardhouse. No entry without a pass.',
      inductionRequirements: '15-minute site induction before first visit.',
      operatingHours: '07:00–18:00, Monday to Saturday',
    },
  })

  await tx.contact.create({
    data: {
      customerId: base.customer.id,
      siteId: base.site.id,
      name: 'Mei Ling Tan',
      role: 'SITE_CONTACT',
      phone: '+65 9123 4567',
      email: 'meiling@example.test',
      isPrimary: true,
    },
  })

  const checklistTemplate = await tx.checklistTemplate.create({
    data: { code: `CHK-${suffix}`, name: 'Overhead crane service', version: 1 },
  })
  await tx.checklistItem.createMany({
    data: [
      {
        templateId: checklistTemplate.id,
        section: 'Hoist',
        code: 'H-01',
        label: 'Check hoist brake',
        resultType: 'PASS_FAIL_NA',
        sortOrder: 1,
      },
      {
        templateId: checklistTemplate.id,
        section: 'Hoist',
        code: 'H-02',
        label: 'Measure brake lining',
        resultType: 'NUMBER',
        unit: 'mm',
        requiresMeasurement: true,
        sortOrder: 2,
      },
      {
        templateId: checklistTemplate.id,
        section: 'Structure',
        code: 'S-01',
        label: 'Inspect girder for cracks',
        resultType: 'PASS_FAIL_NA',
        sortOrder: 3,
      },
    ],
  })

  await tx.jobType.update({
    where: { id: base.jobType.id },
    data: { defaultChecklistTemplateId: checklistTemplate.id },
  })

  return { ...base, checklistTemplate, craneId: base.crane.id }
}

async function mobileJob(
  tx: Tx,
  base: {
    customer: { id: string }
    site: { id: string }
    jobType: { id: string }
    craneId?: string
  },
  options: {
    technicianId?: string
    start?: Date
    end?: Date
    status?: 'SCHEDULED' | 'DISPATCHED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
    cranes?: boolean
  } = {},
) {
  const suffix = testSuffix()
  const job = await tx.job.create({
    data: {
      number: `JOB-MOB-${suffix}`,
      jobTypeId: base.jobType.id,
      customerId: base.customer.id,
      siteId: base.site.id,
      status: options.status ?? 'SCHEDULED',
      priority: 'P2',
      description: 'Annual service and brake adjustment.',
      scheduledStart: options.start ?? new Date('2026-11-02T00:00:00Z'),
      scheduledEnd: options.end ?? new Date('2026-11-02T02:00:00Z'),
    },
  })

  if (options.technicianId) {
    await tx.jobTechnician.create({
      data: { jobId: job.id, technicianId: options.technicianId, isLead: true },
    })
  }

  if (options.cranes !== false && base.craneId) {
    await tx.jobCrane.create({
      data: { jobId: job.id, craneId: base.craneId },
    })
  }

  return job
}

describe("a technician's job list", () => {
  it('shows only the work they are on', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await siteFixtures(tx)
      const mine = await makeTechnician(tx, 'Mine')
      const theirs = await makeTechnician(tx, 'Theirs')

      const myJob = await mobileJob(tx, base, { technicianId: mine.technician.id })
      const theirJob = await mobileJob(tx, base, { technicianId: theirs.technician.id })

      const jobs = await myJobs(mine.context, tx)
      const numbers = jobs.map((job) => job.number)

      expect(numbers).toContain(myJob.number)
      expect(numbers).not.toContain(theirJob.number)
    })
  })

  it('leaves finished work off the phone', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await siteFixtures(tx)
      const mine = await makeTechnician(tx)
      const closed = await mobileJob(tx, base, {
        technicianId: mine.technician.id,
        status: 'COMPLETED',
      })
      const open = await mobileJob(tx, base, { technicianId: mine.technician.id })

      const jobs = await myJobs(mine.context, tx)
      const numbers = jobs.map((job) => job.number)
      expect(numbers).toContain(open.number)
      expect(numbers).not.toContain(closed.number)
    })
  })

  it('refuses a login with no technician record rather than showing it everything', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await siteFixtures(tx)
      await mobileJob(tx, base)
      const dispatcher = await tx.user.create({
        data: {
          email: `dispatcher-mobile-${testSuffix()}@example.test`,
          name: 'Dispatcher',
          role: 'DISPATCHER',
          passwordHash: 'placeholder-not-a-real-hash',
        },
      })

      await expect(myJobs(contextFor(dispatcher), tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})

describe('a job on the phone', () => {
  it('carries the site details, the contact, the crane history and the checklist', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await siteFixtures(tx)
      const mine = await makeTechnician(tx)
      const job = await mobileJob(tx, base, { technicianId: mine.technician.id })

      const template = await tx.reportTemplate.create({
        data: {
          code: `RPT-${testSuffix()}`,
          name: 'Crane service report',
          version: 1,
          bodyHtml: '<p>template</p>',
          schema: { sections: [] },
        },
      })
      await tx.report.create({
        data: {
          jobId: job.id,
          craneId: base.crane.id,
          templateId: template.id,
          templateVersion: 1,
          data: {},
          status: 'APPROVED',
        },
      })

      const detail = await technicianJob(mine.context, job.id, tx)

      expect(detail.accessNotes).toContain('guardhouse')
      expect(detail.address).toContain('Tuas Avenue 3')
      expect(detail.inductionRequirements).toContain('induction')
      expect(detail.contact?.name).toBe('Mei Ling Tan')
      expect(detail.contact?.phone).toBe('+65 9123 4567')
      expect(detail.cranes).toHaveLength(1)
      expect(detail.cranes[0]?.assetTag).toBe(base.crane.assetTag)
      expect(detail.cranes[0]?.recent[0]?.label).toContain('Crane service report')
      expect(detail.checklist.map((item) => item.code)).toEqual(['H-01', 'H-02', 'S-01'])
      expect(detail.checklist[1]?.unit).toBe('mm')
      expect(detail.crew.map((person) => person.name)).toContain(mine.user.name)
    })
  })

  it('says out loud that a crane is flagged do not operate', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await siteFixtures(tx)
      const mine = await makeTechnician(tx)
      await tx.crane.update({
        where: { id: base.crane.id },
        data: { status: 'RESTRICTED', restrictedReason: 'Failed brake test' },
      })
      const job = await mobileJob(tx, base, { technicianId: mine.technician.id })

      const detail = await technicianJob(mine.context, job.id, tx)

      expect(detail.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('Failed brake test')]),
      )
      expect(detail.restricted).toBe(1)
    })
  })

  it("refuses somebody else's job as not found, without confirming it exists", async () => {
    await inRolledBackTx(async (tx) => {
      const base = await siteFixtures(tx)
      const mine = await makeTechnician(tx, 'Mine')
      const theirs = await makeTechnician(tx, 'Theirs')
      const theirJob = await mobileJob(tx, base, { technicianId: theirs.technician.id })

      await expect(technicianJob(mine.context, theirJob.id, tx)).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })
  })
})

describe('the sync bundle', () => {
  it("contains the technician's own work and nothing else", async () => {
    await inRolledBackTx(async (tx) => {
      const base = await siteFixtures(tx)
      const mine = await makeTechnician(tx, 'Mine')
      const theirs = await makeTechnician(tx, 'Theirs')
      const myA = await mobileJob(tx, base, { technicianId: mine.technician.id })
      const myB = await mobileJob(tx, base, { technicianId: mine.technician.id })
      const theirJob = await mobileJob(tx, base, { technicianId: theirs.technician.id })

      const bundle = await syncBundle(mine.context, tx)
      const numbers = bundle.jobs.map((job) => job.number)

      expect(numbers).toEqual(expect.arrayContaining([myA.number, myB.number]))
      expect(numbers).not.toContain(theirJob.number)
      // The phone renders the detail screen from this, so a summary-only bundle would go blank.
      expect(bundle.jobs[0]?.accessNotes).toBeTruthy()
      expect(bundle.checklistItems.length).toBeGreaterThan(0)
    })
  })

  it('sends the operating timezone, so a phone abroad shows the office’s times', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await siteFixtures(tx)
      const mine = await makeTechnician(tx)
      await mobileJob(tx, base, { technicianId: mine.technician.id })

      const bundle = await syncBundle(mine.context, tx)

      expect(bundle.timeZone).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$/)
      expect(bundle.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  it('sends only the contacts at sites this technician is attending', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await siteFixtures(tx)
      const other = await siteFixtures(tx)
      const mine = await makeTechnician(tx)
      await mobileJob(tx, base, { technicianId: mine.technician.id })
      await tx.contact.create({
        data: {
          customerId: other.customer.id,
          siteId: other.site.id,
          name: 'Somebody Else',
          role: 'SITE_CONTACT',
        },
      })

      const bundle = await syncBundle(mine.context, tx)
      const names = bundle.contacts.map((contact) => contact.name)

      expect(names).toContain('Mei Ling Tan')
      expect(names).not.toContain('Somebody Else')
    })
  })

  it('sends only the instruments booked on this technician’s own jobs', async () => {
    await inRolledBackTx(async (tx) => {
      const base = await siteFixtures(tx)
      const mine = await makeTechnician(tx, 'Mine')
      const theirs = await makeTechnician(tx, 'Theirs')
      const myJob = await mobileJob(tx, base, { technicianId: mine.technician.id })
      const theirJob = await mobileJob(tx, base, { technicianId: theirs.technician.id })
      const suffix = testSuffix()

      const ours = await tx.resource.create({
        data: {
          name: `Load cell ${suffix}`,
          type: 'LOAD_CELL',
          serialNumber: `LC-${suffix}`,
          calibrationDueDate: new Date('2027-01-31T00:00:00Z'),
        },
      })
      const theirResource = await tx.resource.create({
        data: {
          name: `Test weight ${suffix}`,
          type: 'TEST_WEIGHT',
          serialNumber: `TW-${suffix}`,
        },
      })
      await tx.jobResource.create({ data: { jobId: myJob.id, resourceId: ours.id } })
      await tx.jobResource.create({
        data: { jobId: theirJob.id, resourceId: theirResource.id },
      })

      const bundle = await syncBundle(mine.context, tx)
      const serials = bundle.calibrationResources.map((row) => row.serialNumber)

      expect(serials).toContain(`LC-${suffix}`)
      expect(serials).not.toContain(`TW-${suffix}`)
      // The register's date travels as a day in the operating zone, which is what the warning compares.
      const mineRow = bundle.calibrationResources.find((row) => row.serialNumber === `LC-${suffix}`)
      expect(mineRow?.calibrationDue).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(bundle.calibrationResources.find((row) => row.serialNumber === `TW-${suffix}`)).toBeUndefined()
    })
  })

  it('refuses a technician whose session has no technician record', async () => {
    await inRolledBackTx(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `admin-mobile-${testSuffix()}@example.test`,
          name: 'Admin',
          role: 'ADMIN',
          passwordHash: 'placeholder-not-a-real-hash',
        },
      })

      await expect(syncBundle(contextFor(user), tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})
