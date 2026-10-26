import { describe, expect, it } from 'vitest'
import type { Role } from '@prisma/client'
import { CsvError } from '@/lib/csv'
import { ForbiddenError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'
import { applyCustomerImport, previewCustomerImport } from '@/server/customers/import'
import { inRolledBackTx, testSuffix } from './helpers'

/**
 * The importer against the real database. Everything runs inside a transaction that rolls back, and
 * the whole-file write goes through the same transaction, so nothing is left behind.
 */

function contextFor(role: Role, userId: string): AuthContext {
  return {
    userId,
    name: `${role} importer`,
    email: `${role.toLowerCase()}-import@example.test`,
    role,
    technicianId: null,
    customerId: null,
    ip: '203.0.113.7',
    userAgent: 'vitest',
  }
}

function csv(rows: string[]): Buffer {
  return Buffer.from(rows.join('\n'), 'utf8')
}

describe('previewing an import', () => {
  it('writes nothing', async () => {
    await inRolledBackTx(async (tx) => {
      const suffix = testSuffix()
      const user = await tx.user.create({
        data: {
          email: `dispatcher-${suffix}@example.test`,
          name: 'Dispatcher',
          role: 'DISPATCHER',
          passwordHash: 'placeholder',
        },
      })

      const customer = `Preview Only ${suffix}`
      const preview = await previewCustomerImport(
        contextFor('DISPATCHER', user.id),
        csv([`legalName\n${customer}`]),
        tx,
      )

      expect(preview.blocked).toBe(false)
      expect(preview.toCreate).toBe(1)

      const found = await tx.customer.findMany({ where: { legalName: customer } })
      expect(found).toHaveLength(0)
    })
  })

  it('reports a row whose name already exists as a skip', async () => {
    await inRolledBackTx(async (tx) => {
      const suffix = testSuffix()
      const user = await tx.user.create({
        data: {
          email: `dispatcher-${suffix}@example.test`,
          name: 'Dispatcher',
          role: 'DISPATCHER',
          passwordHash: 'placeholder',
        },
      })
      const existing = `Existing ${suffix}`
      await tx.customer.create({ data: { legalName: existing, status: 'ACTIVE' } })

      const preview = await previewCustomerImport(
        contextFor('DISPATCHER', user.id),
        csv([`legalName\n${existing}\nBrand New ${suffix}`]),
        tx,
      )

      expect(preview.toSkip).toBe(1)
      expect(preview.toCreate).toBe(1)
      expect(preview.rows[0]).toMatchObject({ line: 2, outcome: 'skip' })
      expect(preview.rows[1]).toMatchObject({ line: 3, outcome: 'create' })
    })
  })

  it('treats a name repeated within the file as a skip, not a duplicate customer', async () => {
    await inRolledBackTx(async (tx) => {
      const suffix = testSuffix()
      const user = await tx.user.create({
        data: {
          email: `dispatcher-${suffix}@example.test`,
          name: 'Dispatcher',
          role: 'DISPATCHER',
          passwordHash: 'placeholder',
        },
      })

      const preview = await previewCustomerImport(
        contextFor('DISPATCHER', user.id),
        csv([`legalName\nTwice ${suffix}\nTWICE ${suffix}`]),
        tx,
      )

      expect(preview.toCreate).toBe(1)
      expect(preview.toSkip).toBe(1)
      expect(preview.rows[1]?.reason).toMatch(/appears earlier in this file/)
    })
  })

  it('blocks the whole file when one row is invalid', async () => {
    await inRolledBackTx(async (tx) => {
      const suffix = testSuffix()
      const user = await tx.user.create({
        data: {
          email: `dispatcher-${suffix}@example.test`,
          name: 'Dispatcher',
          role: 'DISPATCHER',
          passwordHash: 'placeholder',
        },
      })

      const preview = await previewCustomerImport(
        contextFor('DISPATCHER', user.id),
        csv([`legalName,status\nGood ${suffix},ACTIVE\nBad ${suffix},NOT_A_STATUS`]),
        tx,
      )

      expect(preview.blocked).toBe(true)
      expect(preview.errors.join(' ')).toMatch(/Line 3/)
    })
  })

  it('refuses a file with no legalName column, and names the columns it does understand', async () => {
    await inRolledBackTx(async (tx) => {
      const suffix = testSuffix()
      const user = await tx.user.create({
        data: {
          email: `dispatcher-${suffix}@example.test`,
          name: 'Dispatcher',
          role: 'DISPATCHER',
          passwordHash: 'placeholder',
        },
      })

      const preview = await previewCustomerImport(
        contextFor('DISPATCHER', user.id),
        csv(['name,uen\nAcme,123']),
        tx,
      )

      expect(preview.blocked).toBe(true)
      expect(preview.errors[0]).toMatch(/legalName/)
    })
  })

  it('reports unknown columns rather than dropping them silently', async () => {
    await inRolledBackTx(async (tx) => {
      const suffix = testSuffix()
      const user = await tx.user.create({
        data: {
          email: `dispatcher-${suffix}@example.test`,
          name: 'Dispatcher',
          role: 'DISPATCHER',
          passwordHash: 'placeholder',
        },
      })

      const preview = await previewCustomerImport(
        contextFor('DISPATCHER', user.id),
        csv([`Legal Name,Favourite Colour\nUnknown Column ${suffix},Blue`]),
        tx,
      )

      expect(preview.blocked).toBe(false)
      expect(preview.unknownColumns).toEqual(['Favourite Colour'])
      expect(preview.recognisedColumns).toEqual(['legalName'])
    })
  })

  it('refuses a role without the import capability', async () => {
    await inRolledBackTx(async (tx) => {
      await expect(
        previewCustomerImport(contextFor('TECHNICIAN', 'not-a-real-user'), csv(['legalName\nX']), tx),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})

describe('applying an import', () => {
  it('creates every row and one audit entry each', async () => {
    await inRolledBackTx(async (tx) => {
      const suffix = testSuffix()
      const user = await tx.user.create({
        data: {
          email: `dispatcher-${suffix}@example.test`,
          name: 'Dispatcher',
          role: 'DISPATCHER',
          passwordHash: 'placeholder',
        },
      })

      const outcome = await applyCustomerImport(
        contextFor('DISPATCHER', user.id),
        csv([
          'legalName,status,paymentTerms',
          `Imported A ${suffix},ACTIVE,30`,
          `Imported B ${suffix},DORMANT,60`,
        ]),
        tx,
      )

      expect(outcome).toEqual({ created: 2, skipped: 0 })

      const created = await tx.customer.findMany({
        where: { legalName: { in: [`Imported A ${suffix}`, `Imported B ${suffix}`] } },
        orderBy: { legalName: 'asc' },
      })
      expect(created).toHaveLength(2)
      expect(created[1]?.paymentTerms).toBe(60)

      const logs = await tx.auditLog.findMany({
        where: { entity: 'Customer', entityId: { in: created.map((row) => row.id) } },
      })
      expect(logs).toHaveLength(2)
      expect(logs.every((log) => log.action === 'CREATE')).toBe(true)
      expect(logs[0]?.userId).toBe(user.id)
    })
  })

  it('is harmless to run twice — the second pass creates nothing', async () => {
    await inRolledBackTx(async (tx) => {
      const suffix = testSuffix()
      const user = await tx.user.create({
        data: {
          email: `dispatcher-${suffix}@example.test`,
          name: 'Dispatcher',
          role: 'DISPATCHER',
          passwordHash: 'placeholder',
        },
      })
      const file = csv([`legalName\nIdempotent ${suffix}`])

      const first = await applyCustomerImport(contextFor('DISPATCHER', user.id), file, tx)
      const second = await applyCustomerImport(contextFor('DISPATCHER', user.id), file, tx)

      expect(first).toEqual({ created: 1, skipped: 0 })
      expect(second).toEqual({ created: 0, skipped: 1 })

      const found = await tx.customer.findMany({ where: { legalName: `Idempotent ${suffix}` } })
      expect(found).toHaveLength(1)
    })
  })

  it('refuses a file the preview would block, and writes nothing', async () => {
    await inRolledBackTx(async (tx) => {
      const suffix = testSuffix()
      const user = await tx.user.create({
        data: {
          email: `dispatcher-${suffix}@example.test`,
          name: 'Dispatcher',
          role: 'DISPATCHER',
          passwordHash: 'placeholder',
        },
      })

      await expect(
        applyCustomerImport(
          contextFor('DISPATCHER', user.id),
          csv([`legalName\nGood ${suffix},,extra`]),
          tx,
        ),
      ).rejects.toBeInstanceOf(CsvError)

      const found = await tx.customer.findMany({ where: { legalName: `Good ${suffix}` } })
      expect(found).toHaveLength(0)
    })
  })

  it('refuses a UTF-16 file with an explanation rather than importing mojibake', async () => {
    await inRolledBackTx(async (tx) => {
      const suffix = testSuffix()
      const user = await tx.user.create({
        data: {
          email: `dispatcher-${suffix}@example.test`,
          name: 'Dispatcher',
          role: 'DISPATCHER',
          passwordHash: 'placeholder',
        },
      })

      const utf16 = Buffer.from('﻿legalName\nAcme', 'utf16le')
      const preview = await previewCustomerImport(
        contextFor('DISPATCHER', user.id),
        utf16,
        tx,
      )

      expect(preview.blocked).toBe(true)
      expect(preview.errors[0]).toMatch(/UTF-16/)
    })
  })
})
