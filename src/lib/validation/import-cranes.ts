import { z } from 'zod'
import { mapColumns, type ColumnMapping } from './csv-columns'
import { createCraneSchema } from './cranes'

/**
 * The crane register import. Wider than the customer import because a crane register is exactly the
 * kind of list a new customer sends over in a spreadsheet, and every column in it is a fact someone
 * has to retype otherwise.
 *
 * The site is named rather than ided: a human writes "Tuas Workshop", not a uuid. The importer
 * resolves the name against the customer's sites and refuses a row whose site it cannot find, so a
 * typo cannot quietly create a crane at the wrong place. CSV import does not create sites — that
 * would mean guessing addresses and access notes from a spreadsheet.
 */

export const CRANE_IMPORT_COLUMNS = [
  'assetTag',
  'type',
  'siteName',
  'brand',
  'model',
  'serialNumber',
  'swlKg',
  'yearOfManufacture',
  'statutoryRegistrationNo',
  'registrationDate',
  'ownerEntity',
  'locationOnSite',
  'hourMeter',
  'notes',
] as const

export type CraneImportColumn = (typeof CRANE_IMPORT_COLUMNS)[number]

export const REQUIRED_CRANE_COLUMNS: readonly CraneImportColumn[] = ['assetTag', 'type', 'siteName', 'swlKg']

export function mapCraneHeaders(headers: string[]): ColumnMapping<CraneImportColumn> {
  return mapColumns(CRANE_IMPORT_COLUMNS, headers, REQUIRED_CRANE_COLUMNS)
}

/**
 * The row as the file gives it. `siteName` is not part of `createCraneSchema` — an id is — so this
 * validates the parts a spreadsheet can supply and the service resolves the site.
 */
export const craneImportRowSchema = z.object({
  assetTag: z.string().trim().min(1, 'Every crane needs an asset tag.'),
  type: z.string().trim().min(1, 'Every crane needs a type.'),
  siteName: z.string().trim().min(1, 'Every crane needs a site.'),
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  swlKg: z.string().trim().min(1, 'Every crane needs a safe working load.'),
  yearOfManufacture: z.string().optional(),
  statutoryRegistrationNo: z.string().optional(),
  registrationDate: z.string().optional(),
  ownerEntity: z.string().optional(),
  locationOnSite: z.string().optional(),
  hourMeter: z.string().optional(),
  notes: z.string().optional(),
})

export type CraneImportRow = z.infer<typeof craneImportRowSchema>

/**
 * Runs a row through the same `createCraneSchema` the form uses, once the site has been resolved to
 * an id. Throws nothing: returns the validated fields or the messages to show against that line.
 */
export function validateCraneRow(
  row: CraneImportRow,
  resolved: { siteId: string; customerId: string },
): { ok: true; values: z.infer<typeof createCraneSchema> } | { ok: false; messages: string[] } {
  const parsed = createCraneSchema.safeParse({
    customerId: resolved.customerId,
    siteId: resolved.siteId,
    assetTag: row.assetTag,
    qrValue: undefined,
    type: row.type.trim().toUpperCase(),
    brand: row.brand,
    model: row.model,
    serialNumber: row.serialNumber,
    swlKg: row.swlKg,
    yearOfManufacture: row.yearOfManufacture,
    statutoryRegistrationNo: row.statutoryRegistrationNo,
    registrationDate: row.registrationDate,
    ownerEntity: row.ownerEntity,
    locationOnSite: row.locationOnSite,
    hourMeter: row.hourMeter,
    notes: row.notes,
  })

  if (parsed.success) return { ok: true, values: parsed.data }

  const flat = parsed.error.flatten()
  return {
    ok: false,
    messages: [
      ...flat.formErrors,
      ...Object.entries(flat.fieldErrors).flatMap(([field, list]) =>
        (list ?? []).map((message) => `${field}: ${message}`),
      ),
    ],
  }
}
