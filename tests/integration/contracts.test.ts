import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  contractCraneOptions,
  createContract,
  listCustomerContracts,
  retireContract,
  updateContract,
} from '@/server/contracts/contracts'
import { createJob } from '@/server/jobs/jobs'
import { resolveSlaTargets } from '@/server/sla/sla'
import { craneFixtures, inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * Contracts against the real database, inside a transaction that always rolls back (slice 29).
 *
 * What a screen cannot show: that the negotiated targets are written as `SlaPolicy` rows carrying the
 * contract's id, that a job raised after an override snapshots those numbers, and that a contract can
 * only cover this customer's cranes.
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

function contractInput(overrides: Record<string, unknown> = {}) {
  return {
    type: 'AMC',
    reference: '',
    startDate: '2026-01-01',
    endDate: '',
    renewalDate: '',
    includedVisits: '',
    scopeNotes: '',
    coveredCraneIds: '',
    slaP1Response: '',
    slaP1Resolution: '',
    slaP2Response: '',
    slaP2Resolution: '',
    slaP3Response: '',
    slaP3Resolution: '',
    slaP4Response: '',
    slaP4Resolution: '',
    ...overrides,
  }
}

describe('contracts', () => {
  it('stores the negotiated targets as SlaPolicy rows for the contract', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = contextFor(await makeUser(tx, 'ADMIN'))
      const base = await craneFixtures(tx)

      const contract = await createContract(
        admin,
        base.customer.id,
        contractInput({ slaP1Response: '15', slaP1Resolution: '60' }),
        tx,
      )
      expect(contract.targets).toEqual({ P1: { responseMinutes: 15, resolutionMinutes: 60 } })

      const rows = await tx.slaPolicy.findMany({ where: { contractId: contract.id } })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ priority: 'P1', responseMinutes: 15, resolutionMinutes: 60 })

      const [listed] = await listCustomerContracts(admin, base.customer.id, tx)
      expect(listed?.targets).toEqual(contract.targets)
    })
  })

  it('snapshots the contract’s targets onto a new job, and clears them when the pair is blanked', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = contextFor(await makeUser(tx, 'ADMIN'))
      const base = await craneFixtures(tx)

      const contract = await createContract(
        admin,
        base.customer.id,
        contractInput({ slaP1Response: '15', slaP1Resolution: '60' }),
        tx,
      )

      const job = await createJob(
        admin,
        {
          customerId: base.customer.id,
          jobTypeId: base.jobType.id,
          craneIds: [base.crane.id],
          priority: 'P1',
        },
        tx,
      )
      const stored = await tx.job.findUniqueOrThrow({
        where: { id: job.id },
        select: { contractId: true, reportedAt: true, slaResponseDue: true, slaResolveDue: true },
      })
      const reportedAt = stored.reportedAt!.getTime()
      expect(stored.contractId).toBe(contract.id)
      expect(stored.slaResponseDue!.getTime() - reportedAt).toBe(15 * 60_000)
      expect(stored.slaResolveDue!.getTime() - reportedAt).toBe(60 * 60_000)

      // Blanking the pair removes the row rather than zeroing it, so the company-wide target applies.
      await updateContract(admin, base.customer.id, contract.id, contractInput(), tx)
      expect(await tx.slaPolicy.count({ where: { contractId: contract.id } })).toBe(0)
      expect(await resolveSlaTargets('P1', contract.id, tx)).toEqual(
        await resolveSlaTargets('P1', null, tx),
      )
    })
  })

  it('applies a contract naming cranes only to jobs on one of them', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = contextFor(await makeUser(tx, 'ADMIN'))
      const base = await craneFixtures(tx)
      const other = await tx.crane.create({
        data: {
          siteId: base.site.id,
          customerId: base.customer.id,
          assetTag: `TAG2-${base.suffix}`,
          qrValue: `QR2-${base.suffix}`,
          type: 'OVERHEAD',
          swlKg: 5000,
        },
      })
      const contract = await createContract(
        admin,
        base.customer.id,
        contractInput({
          coveredCraneIds: [base.crane.id],
          slaP1Response: '15',
          slaP1Resolution: '60',
        }),
        tx,
      )

      const covered = await createJob(
        admin,
        {
          customerId: base.customer.id,
          jobTypeId: base.jobType.id,
          craneIds: [base.crane.id],
          priority: 'P1',
        },
        tx,
      )
      const uncovered = await createJob(
        admin,
        {
          customerId: base.customer.id,
          jobTypeId: base.jobType.id,
          craneIds: [other.id],
          priority: 'P1',
        },
        tx,
      )

      const contractOf = async (id: string) =>
        (await tx.job.findUniqueOrThrow({ where: { id }, select: { contractId: true } })).contractId
      expect(await contractOf(covered.id)).toBe(contract.id)
      expect(await contractOf(uncovered.id)).toBeNull()
    })
  })

  it('refuses to cover a crane belonging to another customer', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = contextFor(await makeUser(tx, 'ADMIN'))
      const mine = await craneFixtures(tx)
      const theirs = await craneFixtures(tx)

      await expect(
        createContract(
          admin,
          mine.customer.id,
          contractInput({ coveredCraneIds: [theirs.crane.id] }),
          tx,
        ),
      ).rejects.toBeInstanceOf(ValidationError)

      const options = await contractCraneOptions(admin, mine.customer.id, tx)
      expect(options.map((crane) => crane.id)).toEqual([mine.crane.id])
    })
  })

  it('retires rather than deletes, so the targets stay on record', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = contextFor(await makeUser(tx, 'ADMIN'))
      const base = await craneFixtures(tx)
      const contract = await createContract(
        admin,
        base.customer.id,
        contractInput({ slaP1Response: '15', slaP1Resolution: '60' }),
        tx,
      )

      await retireContract(admin, base.customer.id, contract.id, tx)

      expect(await listCustomerContracts(admin, base.customer.id, tx)).toEqual([])
      expect(await tx.slaPolicy.count({ where: { contractId: contract.id } })).toBe(1)
      await expect(
        updateContract(admin, base.customer.id, contract.id, contractInput(), tx),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  it('lets finance read a contract but nobody but an administrator write one', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = contextFor(await makeUser(tx, 'ADMIN'))
      const finance = contextFor(await makeUser(tx, 'FINANCE'))
      const base = await craneFixtures(tx)
      await createContract(admin, base.customer.id, contractInput(), tx)

      expect(await listCustomerContracts(finance, base.customer.id, tx)).toHaveLength(1)

      for (const role of ['DISPATCHER', 'TECHNICIAN', 'STOREKEEPER', 'FINANCE'] as const) {
        const context = contextFor(await makeUser(tx, role))
        await expect(
          createContract(context, base.customer.id, contractInput(), tx),
        ).rejects.toBeInstanceOf(ForbiddenError)
      }
    })
  })
})
