import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { ForbiddenError, RuleError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import {
  acknowledgeReregistration,
  getCrane,
  updateCrane,
} from '@/server/cranes/cranes'
import { updateCustomer } from '@/server/customers/customers'
import {
  createComplianceRule,
  listComplianceRules,
  rulesForCraneType,
  updateComplianceRule,
} from '@/server/compliance/rules'
import { createSchedule } from '@/server/schedules/schedules'
import { craneFixtures, inRolledBackTx, testSuffix, type Tx } from './helpers'

/**
 * Compliance rules against the real database, inside a transaction that always rolls back (slice 14).
 *
 * The cases that matter are the ones no screen shows: that a dispatcher can adopt a rule but not
 * write one, that a second rule in force for the same question is refused, and that the changes the
 * brief says may require re-registration actually raise the prompt on the crane.
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

function ruleInput(overrides: Record<string, unknown> = {}) {
  return {
    craneType: 'OVERHEAD',
    scheduleType: 'ANNUAL_EXAMINATION',
    intervalMonths: '12',
    requiresAE: 'on',
    isActive: 'on',
    sourceReference: `Test rule ${testSuffix()}`,
    reviewedAt: '2026-10-01',
    ...overrides,
  }
}

describe('compliance rules', () => {
  it('lets an administrator create one, and audit-logs who signed it off', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')

      const rule = await createComplianceRule(contextFor(admin), ruleInput(), tx)

      expect(rule.inForce).toBe(true)
      expect(rule.intervalMonths).toBe(12)
      expect(rule.reviewedAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z')

      const entry = await tx.auditLog.findFirst({
        where: { entity: 'ComplianceRule', entityId: rule.id, action: 'CREATE' },
      })
      expect(entry).not.toBeNull()
      expect(entry?.userId).toBe(admin.id)
      expect(entry?.after).toMatchObject({ requiresAE: true, intervalMonths: 12 })
    })
  })

  it('denies a dispatcher the ability to write one', async () => {
    await inRolledBackTx(async (tx) => {
      const dispatcher = await makeUser(tx, 'DISPATCHER')

      await expect(createComplianceRule(contextFor(dispatcher), ruleInput(), tx)).rejects.toThrow(
        ForbiddenError,
      )
    })
  })

  it('refuses a second rule in force for the same crane type and obligation', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = contextFor(await makeUser(tx, 'ADMIN'))
      const first = await createComplianceRule(admin, ruleInput(), tx)

      await expect(createComplianceRule(admin, ruleInput(), tx)).rejects.toThrow(RuleError)

      // Ending the first is what makes room for its replacement.
      await updateComplianceRule(
        admin,
        first.id,
        ruleInput({ sourceReference: first.sourceReference, effectiveTo: '2026-01-31' }),
        tx,
      )
      const replacement = await createComplianceRule(
        admin,
        ruleInput({ effectiveFrom: '2026-02-01' }),
        tx,
      )
      expect(replacement.inForce).toBe(true)
    })
  })

  it('offers a dispatcher the in-force rules for a crane type, without letting them write one', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = contextFor(await makeUser(tx, 'ADMIN'))
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const live = await createComplianceRule(admin, ruleInput(), tx)
      const stopped = await createComplianceRule(
        admin,
        ruleInput({ scheduleType: 'LOAD_TEST', isActive: '' }),
        tx,
      )

      const offered = await rulesForCraneType(dispatcher, 'OVERHEAD', tx)
      const ids = offered.map((row) => row.id)
      expect(ids).toContain(live.id)
      expect(ids).not.toContain(stopped.id)

      await expect(listComplianceRules(dispatcher, tx)).rejects.toThrow(ForbiddenError)
    })
  })
})

describe('a schedule adopting a rule', () => {
  it('takes the kind and interval from the rule and records the citation', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = contextFor(await makeUser(tx, 'ADMIN'))
      const dispatcher = contextFor(await makeUser(tx, 'DISPATCHER'))
      const { crane } = await craneFixtures(tx)
      const rule = await createComplianceRule(admin, ruleInput(), tx)

      // The form's own kind and interval are deliberately wrong: the rule decides both.
      const schedule = await createSchedule(
        dispatcher,
        {
          craneId: crane.id,
          ruleId: rule.id,
          scheduleType: 'MONTHLY_SERVICE',
          intervalMonths: '1',
          lastDoneDate: '2026-01-01',
        },
        tx,
      )

      expect(schedule.scheduleType).toBe('ANNUAL_EXAMINATION')
      expect(schedule.intervalMonths).toBe(12)
      expect(schedule.source).toBe('RULE')
      expect(schedule.ruleId).toBe(rule.id)
      expect(schedule.ruleReference).toBe(rule.sourceReference)
      expect(schedule.requiresAE).toBe(true)

      expect((await listComplianceRules(admin, tx)).find((row) => row.id === rule.id)?.adoptedCount)
        .toBe(1)
    })
  })

  it('refuses a rule written for a different kind of crane', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = contextFor(await makeUser(tx, 'ADMIN'))
      const { crane } = await craneFixtures(tx) // an OVERHEAD crane
      const rule = await createComplianceRule(admin, ruleInput({ craneType: 'TOWER' }), tx)

      await expect(
        createSchedule(
          admin,
          { craneId: crane.id, ruleId: rule.id, scheduleType: 'ANNUAL_EXAMINATION' },
          tx,
        ),
      ).rejects.toThrow(RuleError)
    })
  })

  it('refuses a rule that is no longer in force', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = contextFor(await makeUser(tx, 'ADMIN'))
      const { crane } = await craneFixtures(tx)
      const rule = await createComplianceRule(admin, ruleInput({ effectiveTo: '2025-01-31' }), tx)

      await expect(
        createSchedule(
          admin,
          { craneId: crane.id, ruleId: rule.id, scheduleType: 'ANNUAL_EXAMINATION' },
          tx,
        ),
      ).rejects.toThrow(RuleError)
    })
  })
})

describe('the re-registration prompt', () => {
  it('is raised when the owner or the site changes, and cleared when somebody checks', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = await makeUser(tx, 'ADMIN')
      const context = contextFor(admin)
      const { crane } = await craneFixtures(tx)

      const edit = {
        customerId: crane.customerId,
        siteId: crane.siteId,
        type: crane.type,
        swlKg: '5000',
        assetTag: crane.assetTag,
      }

      // Recording an owner for the first time is itself a change of owner of record.
      const first = { ...edit, ownerEntity: 'Crane Owner Pte Ltd' }
      await updateCrane(context, crane.id, first, tx)
      expect((await getCrane(context, crane.id, tx)).reregistrationRequiredAt).not.toBeNull()

      await acknowledgeReregistration(context, crane.id, tx)

      // ... and the change of owner is what the prompt is for.
      await updateCrane(context, crane.id, { ...first, ownerEntity: 'New Owner Pte Ltd' }, tx)
      const flagged = await getCrane(context, crane.id, tx)
      expect(flagged.reregistrationRequiredAt).not.toBeNull()
      expect(flagged.reregistrationReason).toContain('New Owner Pte Ltd')

      await acknowledgeReregistration(context, crane.id, tx)
      expect((await getCrane(context, crane.id, tx)).reregistrationRequiredAt).toBeNull()

      // A move to another site is the "re-assembled elsewhere" case in brief §7.3.
      const otherSite = await tx.site.create({
        data: { customerId: crane.customerId, name: `Test Site 2 ${testSuffix()}` },
      })
      await updateCrane(
        context,
        crane.id,
        { ...first, ownerEntity: 'New Owner Pte Ltd', siteId: otherSite.id },
        tx,
      )
      const moved = await getCrane(context, crane.id, tx)
      expect(moved.reregistrationReason).toContain('Moved from site')

      await acknowledgeReregistration(context, crane.id, tx)
      const cleared = await getCrane(context, crane.id, tx)
      expect(cleared.reregistrationRequiredAt).toBeNull()
      expect(cleared.reregistrationReason).toBeNull()

      const entry = await tx.auditLog.findFirst({
        where: { entity: 'Crane', entityId: crane.id, action: 'UPDATE', userId: admin.id },
        orderBy: { createdAt: 'desc' },
      })
      expect(entry?.after).toMatchObject({ note: 'Checked for re-registration.' })
    })
  })

  it('is raised on every crane of a customer whose UEN changes', async () => {
    await inRolledBackTx(async (tx) => {
      const admin = contextFor(await makeUser(tx, 'ADMIN'))
      const { crane, customer } = await craneFixtures(tx)

      await updateCustomer(
        admin,
        customer.id,
        { legalName: customer.legalName, uen: '202612345A' },
        tx,
      )

      const flagged = await tx.crane.findUniqueOrThrow({ where: { id: crane.id } })
      expect(flagged.reregistrationRequiredAt).not.toBeNull()
      expect(flagged.reregistrationReason).toContain('202612345A')
    })
  })
})
