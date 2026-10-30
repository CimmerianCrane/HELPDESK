import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { listCertificates } from '@/server/certificates/certificates'
import { listCranes } from '@/server/cranes/cranes'
import { portalJob, portalJobs, portalReports, portalSummary } from '@/server/portal/portal'
import { craneFixtures, inRolledBackTx, type Tx } from './helpers'

/**
 * The customer portal (slice 31), against the real database.
 *
 * The claim this suite defends is the whole point of the slice: a portal login sees **its own**
 * customer's jobs, cranes, certificates and issued reports, and nothing else — and a login with no
 * customer sees nothing rather than everything. Everything runs in a rolled-back transaction.
 *
 * The scope filters are shared with the office screens, so the tests build two customers with a
 * crane each and assert the second customer's rows never come back through the same services the
 * portal pages call.
 */

function contextFor(customerId: string | null, role: Role = 'CUSTOMER'): AuthContext {
  return {
    userId: `portal-${customerId ?? 'none'}`,
    name: 'Portal User',
    email: 'portal@example.test',
    role,
    technicianId: null,
    customerId,
    ip: '203.0.113.9',
    userAgent: 'vitest',
  }
}

/** A customer, a crane, a job on it, and an approved report — the minimum the portal lists. */
async function portalEstate(tx: Tx) {
  const mine = await craneFixtures(tx)
  const theirs = await craneFixtures(tx)

  const job = await tx.job.create({
    data: {
      number: `PORTAL-${mine.suffix}`,
      jobTypeId: mine.jobType.id,
      customerId: mine.customer.id,
      siteId: mine.site.id,
      status: 'COMPLETED',
      priority: 'P3',
      reportedAt: new Date(),
      cranes: { create: { craneId: mine.crane.id } },
    },
  })

  const template = await tx.reportTemplate.create({
    data: {
      code: `PORTAL-T-${mine.suffix}`,
      name: 'Portal test template',
      version: 1,
      bodyHtml: '<p>Test</p>',
      schema: { sections: [] },
    },
  })

  const report = await tx.report.create({
    data: {
      jobId: job.id,
      craneId: mine.crane.id,
      templateId: template.id,
      templateVersion: 1,
      status: 'APPROVED',
      documentNumber: `RPT-${mine.suffix}`,
      approvedAt: new Date(),
      data: {},
    },
  })

  // A submitted — not approved — report on the same crane, which the portal must never list.
  const draft = await tx.report.create({
    data: {
      jobId: job.id,
      craneId: mine.crane.id,
      templateId: template.id,
      templateVersion: 1,
      status: 'SUBMITTED',
      data: {},
    },
  })

  const otherJob = await tx.job.create({
    data: {
      number: `OTHER-${theirs.suffix}`,
      jobTypeId: theirs.jobType.id,
      customerId: theirs.customer.id,
      siteId: theirs.site.id,
      status: 'SCHEDULED',
      priority: 'P3',
      reportedAt: new Date(),
    },
  })

  return { mine, theirs, job, otherJob, report, draft }
}

describe('a customer portal login', () => {
  it('sees only its own customer’s jobs', async () => {
    await inRolledBackTx(async (tx) => {
      const { mine, job, otherJob, theirs } = await portalEstate(tx)

      const jobs = await portalJobs(contextFor(mine.customer.id), {}, tx)
      const ids = jobs.map((entry) => entry.id)

      expect(ids).toContain(job.id)
      expect(ids).not.toContain(otherJob.id)
      expect(ids.every((id) => id !== otherJob.id)).toBe(true)

      // And the other customer sees only their own.
      const theirsJobs = await portalJobs(contextFor(theirs.customer.id), {}, tx)
      expect(theirsJobs.map((entry) => entry.id)).toEqual([otherJob.id])
    })
  })

  it('cannot open another customer’s job by id', async () => {
    await inRolledBackTx(async (tx) => {
      const { mine, otherJob } = await portalEstate(tx)
      expect(await portalJob(contextFor(mine.customer.id), otherJob.id, tx)).toBeNull()
    })
  })

  it('sees only its own cranes, through the office register read', async () => {
    await inRolledBackTx(async (tx) => {
      const { mine, theirs } = await portalEstate(tx)

      const cranes = await listCranes(contextFor(mine.customer.id), {}, tx)
      expect(cranes.map((crane) => crane.id)).toEqual([mine.crane.id])
      expect(cranes.map((crane) => crane.id)).not.toContain(theirs.crane.id)
    })
  })

  it('sees issued reports only — never one the office has not signed off', async () => {
    await inRolledBackTx(async (tx) => {
      const { mine, report, draft } = await portalEstate(tx)

      const reports = await portalReports(contextFor(mine.customer.id), {}, tx)
      const ids = reports.map((entry) => entry.id)

      expect(ids).toContain(report.id)
      expect(ids).not.toContain(draft.id)
    })
  })

  it('counts its own account in the overview, not the company', async () => {
    await inRolledBackTx(async (tx) => {
      const { mine } = await portalEstate(tx)
      const summary = await portalSummary(contextFor(mine.customer.id), new Date(), tx)

      expect(summary.openJobs).toBe(0) // the only own job is COMPLETED
      expect(summary.cranes).toBe(1)
      expect(summary.recent.map((job) => job.number)).toContain(`PORTAL-${mine.suffix}`)
    })
  })

  it('sees no certificates belonging to another customer', async () => {
    await inRolledBackTx(async (tx) => {
      const { mine, theirs } = await portalEstate(tx)

      await tx.certificate.create({
        data: {
          craneId: mine.crane.id,
          type: 'LOAD_TEST',
          certificateNumber: `CERT-${mine.suffix}`,
          expiryDate: new Date(),
        },
      })
      const foreign = await tx.certificate.create({
        data: {
          craneId: theirs.crane.id,
          type: 'LOAD_TEST',
          certificateNumber: `CERT-${theirs.suffix}`,
          expiryDate: new Date(),
        },
      })

      const certificates = await listCertificates(contextFor(mine.customer.id), {}, tx)
      expect(certificates.map((entry) => entry.id)).not.toContain(foreign.id)
      expect(certificates.every((entry) => entry.crane.id === mine.crane.id)).toBe(true)
    })
  })

  /**
   * The fail-closed rule: a CUSTOMER login with no customer is the shape a half-finished admin save
   * would leave behind. It must see nothing, not everything.
   */
  it('sees nothing when the login is not attached to a customer', async () => {
    await inRolledBackTx(async (tx) => {
      await portalEstate(tx)
      const orphan = contextFor(null)

      expect(await portalJobs(orphan, {}, tx)).toEqual([])
      expect(await listCranes(orphan, {}, tx)).toEqual([])
      expect(await portalReports(orphan, {}, tx)).toEqual([])
      await expect(portalSummary(orphan, new Date(), tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  it('cannot be reached by a role that does not hold portal.read', async () => {
    await inRolledBackTx(async (tx) => {
      const { theirs } = await portalEstate(tx)
      // A technician with a customerId set would be an admin mistake; the capability gates it anyway.
      const technician = contextFor(theirs.customer.id, 'TECHNICIAN')

      await expect(portalJobs(technician, {}, tx)).rejects.toBeInstanceOf(ForbiddenError)
      await expect(portalSummary(technician, new Date(), tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})
