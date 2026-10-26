import { afterAll, describe, expect, it } from 'vitest'
import { craneFixtures, db, inRolledBackTx, jobFixtures } from './helpers'

/**
 * The two rules the brief states twice (§4.2, §4.3) are enforced by Postgres CHECK constraints as
 * well as by the service layer. These tests prove the database itself refuses the bad rows, so no
 * future code path — an import, a migration, a console session — can create one.
 */

afterAll(async () => {
  await db.$disconnect()
})

describe('Job on-hold reason constraint', () => {
  it('rejects ON_HOLD with no reason', async () => {
    await expect(
      inRolledBackTx(async (tx) => {
        const { customer, site, jobType, suffix } = await jobFixtures(tx)
        return tx.job.create({
          data: {
            number: `JOB-TEST-${suffix}`,
            jobTypeId: jobType.id,
            customerId: customer.id,
            siteId: site.id,
            priority: 'P3',
            status: 'ON_HOLD',
          },
        })
      }),
    ).rejects.toThrow(/job_on_hold_requires_reason/)
  })

  it('accepts ON_HOLD with a reason', async () => {
    const job = await inRolledBackTx(async (tx) => {
      const { customer, site, jobType, suffix } = await jobFixtures(tx)
      return tx.job.create({
        data: {
          number: `JOB-TEST-${suffix}`,
          jobTypeId: jobType.id,
          customerId: customer.id,
          siteId: site.id,
          priority: 'P3',
          status: 'ON_HOLD',
          onHoldReason: 'AWAITING_PARTS',
        },
      })
    })

    expect(job.status).toBe('ON_HOLD')
    expect(job.onHoldReason).toBe('AWAITING_PARTS')
  })

  it('allows any other status with no reason', async () => {
    const job = await inRolledBackTx(async (tx) => {
      const { customer, site, jobType, suffix } = await jobFixtures(tx)
      return tx.job.create({
        data: {
          number: `JOB-TEST-${suffix}`,
          jobTypeId: jobType.id,
          customerId: customer.id,
          siteId: site.id,
          priority: 'P1',
          status: 'SCHEDULED',
        },
      })
    })

    expect(job.onHoldReason).toBeNull()
  })
})

describe('Crane restricted reason constraint', () => {
  it('rejects RESTRICTED with no reason', async () => {
    await expect(
      inRolledBackTx(async (tx) => {
        const { crane } = await craneFixtures(tx)
        return tx.crane.update({
          where: { id: crane.id },
          data: { status: 'RESTRICTED' },
        })
      }),
    ).rejects.toThrow(/crane_restricted_requires_reason/)
  })

  it('accepts RESTRICTED with a reason', async () => {
    const crane = await inRolledBackTx(async (tx) => {
      const { crane } = await craneFixtures(tx)
      return tx.crane.update({
        where: { id: crane.id },
        data: { status: 'RESTRICTED', restrictedReason: 'Wire rope beyond discard criteria' },
      })
    })

    expect(crane.status).toBe('RESTRICTED')
  })
})
