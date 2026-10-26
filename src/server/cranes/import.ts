import { CsvError, decodeCsv, parseCsv } from '@/lib/csv'
import { db, type Tx } from '@/lib/db'
import {
  CRANE_IMPORT_COLUMNS,
  craneImportRowSchema,
  mapCraneHeaders,
  validateCraneRow,
  type CraneImportColumn,
} from '@/lib/validation/import-cranes'
import { rowToColumns } from '@/lib/validation/csv-columns'
import { withAudit } from '@/server/audit/audit'
import { NotFoundError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { customerReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { generateQrValue } from './qr'

/**
 * Crane register import (brief §12.3).
 *
 * The same two-step shape as the customer import — preview, then apply — and for the same reasons.
 * What is different is the site: a spreadsheet names a site, so the importer resolves that name
 * against the chosen customer's sites and refuses a row whose site it cannot find. Guessing would put
 * a crane at the wrong site, and every future job for it would then send a technician to the wrong
 * address.
 *
 * Nothing here creates sites. A site carries an address and access notes that a register spreadsheet
 * does not have, and inventing a site from a bare name is how a register fills up with duplicates.
 */

export interface CraneImportRowResult {
  line: number
  assetTag: string
  outcome: 'create' | 'skip'
  reason?: string
}

export interface CraneImportPreview {
  unknownColumns: string[]
  recognisedColumns: CraneImportColumn[]
  rows: CraneImportRowResult[]
  toCreate: number
  toSkip: number
  errors: string[]
  blocked: boolean
}

export const MAX_CRANE_IMPORT_ROWS = 2000

function blocked(errors: string[], unknownColumns: string[] = []): CraneImportPreview {
  return {
    unknownColumns,
    recognisedColumns: [],
    rows: [],
    toCreate: 0,
    toSkip: 0,
    errors,
    blocked: true,
  }
}

/** Reads and checks a file against one customer's sites and register, writing nothing. */
export async function previewCraneImport(
  context: AuthContext,
  customerId: string,
  file: ArrayBuffer | Buffer,
  client: Tx = db,
): Promise<CraneImportPreview> {
  assertCan(context, 'crane.import')

  let text: string
  try {
    text = decodeCsv(file)
  } catch (error) {
    if (error instanceof CsvError) return blocked([error.message])
    throw error
  }

  const customer = await client.customer.findFirst({
    where: { id: customerId, ...customerReadWhere(context) },
    select: { id: true, legalName: true },
  })
  if (!customer) throw new NotFoundError('No such customer.')

  let table: ReturnType<typeof parseCsv>
  try {
    table = parseCsv(text)
  } catch (error) {
    if (error instanceof CsvError) return blocked([error.message])
    throw error
  }

  const { mapping, unknown, missing } = mapCraneHeaders(table.headers)
  const recognisedColumns = CRANE_IMPORT_COLUMNS.filter((column) =>
    [...mapping.values()].includes(column),
  )

  const errors: string[] = []
  if (missing.length > 0) {
    errors.push(
      `The file needs ${missing.map((column) => `“${column}”`).join(', ')}. Recognised columns are: ${CRANE_IMPORT_COLUMNS.join(', ')}.`,
    )
  }
  if (table.rows.length > MAX_CRANE_IMPORT_ROWS) {
    errors.push(
      `The file has ${table.rows.length} rows; the limit is ${MAX_CRANE_IMPORT_ROWS}. Split it into smaller files.`,
    )
  }
  if (errors.length > 0) return blocked(errors, unknown)

  const sites = await client.site.findMany({
    where: { customerId, deletedAt: null },
    select: { id: true, name: true },
  })
  const siteByName = new Map(sites.map((site) => [site.name.trim().toLowerCase(), site.id]))

  const existing = await client.crane.findMany({
    where: { deletedAt: null },
    select: { assetTag: true },
  })
  const seen = new Set(existing.map((row) => row.assetTag.trim().toLowerCase()))

  const rows: CraneImportRowResult[] = []
  const rowErrors: string[] = []

  for (const row of table.rows) {
    const raw = rowToColumns(row, mapping)

    const shape = craneImportRowSchema.safeParse(raw)
    if (!shape.success) {
      const flat = shape.error.flatten()
      const messages = [
        ...flat.formErrors,
        ...Object.entries(flat.fieldErrors).flatMap(([field, list]) =>
          (list ?? []).map((message) => `${field}: ${message}`),
        ),
      ]
      rowErrors.push(`Line ${row.line}: ${messages.join('; ')}`)
      continue
    }

    const assetTag = shape.data.assetTag
    const siteId = siteByName.get(shape.data.siteName.trim().toLowerCase())
    if (!siteId) {
      rowErrors.push(
        `Line ${row.line}: “${shape.data.siteName}” is not a site of ${customer.legalName}. Add the site first, or correct the name.`,
      )
      continue
    }

    const validated = validateCraneRow(shape.data, { siteId, customerId })
    if (!validated.ok) {
      rowErrors.push(`Line ${row.line}: ${validated.messages.join('; ')}`)
      continue
    }

    const key = assetTag.toLowerCase()
    if (seen.has(key)) {
      rows.push({
        line: row.line,
        assetTag,
        outcome: 'skip',
        reason: 'This asset tag is already in the register, or appears earlier in this file.',
      })
      continue
    }

    seen.add(key)
    rows.push({ line: row.line, assetTag, outcome: 'create' })
  }

  // One bad row blocks the file: a half-imported register is worse than a rejected one, because the
  // office has to work out which cranes went in before they can re-run the corrected file.
  const isBlocked = rowErrors.length > 0
  if (isBlocked) {
    errors.push(...rowErrors.slice(0, 25))
    if (rowErrors.length > 25) {
      errors.push(`…and ${rowErrors.length - 25} more problems. Fix the file and preview again.`)
    }
  }

  return {
    unknownColumns: unknown,
    recognisedColumns,
    rows,
    toCreate: rows.filter((row) => row.outcome === 'create').length,
    toSkip: rows.filter((row) => row.outcome === 'skip').length,
    errors,
    blocked: isBlocked,
  }
}

export interface CraneImportOutcome {
  created: number
  skipped: number
}

/** Applies an import. Re-validates the whole file rather than trusting the preview. */
export async function applyCraneImport(
  context: AuthContext,
  customerId: string,
  file: ArrayBuffer | Buffer,
  client: Tx = db,
): Promise<CraneImportOutcome> {
  assertCan(context, 'crane.import')

  const preview = await previewCraneImport(context, customerId, file, client)
  if (preview.blocked) throw new CsvError(preview.errors.join('\n'))

  const toCreate = preview.rows.filter((row) => row.outcome === 'create')
  if (toCreate.length === 0) return { created: 0, skipped: preview.toSkip }

  const text = decodeCsv(file)
  const table = parseCsv(text)
  const { mapping } = mapCraneHeaders(table.headers)
  const wanted = new Set(toCreate.map((row) => row.assetTag.trim().toLowerCase()))

  const sites = await client.site.findMany({
    where: { customerId, deletedAt: null },
    select: { id: true, name: true },
  })
  const siteByName = new Map(sites.map((site) => [site.name.trim().toLowerCase(), site.id]))

  await withAudit(
    context,
    async (tx, log) => {
      for (const row of table.rows) {
        const raw = rowToColumns(row, mapping)
        const shape = craneImportRowSchema.safeParse(raw)
        if (!shape.success) continue
        if (!wanted.has(shape.data.assetTag.trim().toLowerCase())) continue

        const siteId = siteByName.get(shape.data.siteName.trim().toLowerCase())
        if (!siteId) continue

        const validated = validateCraneRow(shape.data, { siteId, customerId })
        if (!validated.ok) continue
        const input = validated.values

        const crane = await tx.crane.create({
          data: {
            customerId,
            siteId,
            assetTag: input.assetTag ?? shape.data.assetTag,
            qrValue: generateQrValue(),
            type: input.type,
            brand: input.brand,
            model: input.model,
            serialNumber: input.serialNumber,
            swlKg: input.swlKg,
            yearOfManufacture: input.yearOfManufacture,
            statutoryRegistrationNo: input.statutoryRegistrationNo,
            registrationDate: input.registrationDate,
            ownerEntity: input.ownerEntity,
            locationOnSite: input.locationOnSite,
            hourMeter: input.hourMeter,
            notes: input.notes,
            status: 'IN_SERVICE',
            createdById: context.userId,
          },
          select: { id: true, assetTag: true, qrValue: true },
        })

        await log({
          entity: 'Crane',
          entityId: crane.id,
          action: 'CREATE',
          after: { assetTag: crane.assetTag, qrValue: crane.qrValue, importedFrom: 'csv' },
        })
      }
    },
    client,
  )

  return { created: toCreate.length, skipped: preview.toSkip }
}

/** Header row only, so a downloaded template cannot be mistaken for data. */
export function craneImportTemplate(): string {
  return `${CRANE_IMPORT_COLUMNS.join(',')}\n`
}
