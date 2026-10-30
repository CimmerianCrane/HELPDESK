import { z } from 'zod'
import { CERTIFICATE_UPLOAD_TYPES } from './certificates'
import { MAX_UPLOAD_BYTES } from './reports'

/**
 * Input rules for the calibration register (slice 34).
 *
 * The register is the equipment the business already books onto jobs — test weights, load cells,
 * vehicles and tools (`Resource`) — and the one fact it tracks is when each was last proved accurate.
 * A calibration certificate is a scanned document like any other, so it is stored with the same
 * types and the same size limit as a crane certificate; only its owner differs.
 */

export const EQUIPMENT_TYPES = ['VEHICLE', 'TEST_WEIGHT', 'LOAD_CELL', 'TOOL'] as const
export type EquipmentTypeName = (typeof EQUIPMENT_TYPES)[number]

export const EQUIPMENT_TYPE_LABELS: Record<EquipmentTypeName, string> = {
  VEHICLE: 'Vehicle',
  TEST_WEIGHT: 'Test weight',
  LOAD_CELL: 'Load cell',
  TOOL: 'Tool',
}

export const EQUIPMENT_STATUSES = ['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED'] as const
export type EquipmentStatusName = (typeof EQUIPMENT_STATUSES)[number]

export const EQUIPMENT_STATUS_LABELS: Record<EquipmentStatusName, string> = {
  AVAILABLE: 'Available',
  IN_USE: 'In use',
  MAINTENANCE: 'In maintenance',
  RETIRED: 'Retired',
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : null))

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A date input, read as UTC midnight — the same convention schedules and certificates use. */
function isoDayToUtc(value: string): Date | null {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10) === value ? date : null
}

const optionalDay = z
  .union([z.literal(''), z.string().regex(ISO_DAY, 'Use a date like 2026-10-26.')])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value))
  .superRefine((value, ctx) => {
    if (value !== null && isoDayToUtc(value) === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'That is not a real date.' })
    }
  })
  .transform((value) => (value === null ? null : isoDayToUtc(value)))

export const resourceFields = {
  name: z.string().trim().min(1, 'Give the equipment a name.').max(120, 'Use 120 characters or fewer.'),
  type: z.enum(EQUIPMENT_TYPES, {
    errorMap: () => ({ message: 'Choose what kind of equipment it is.' }),
  }),
  serialNumber: optionalText(80),
  status: z.enum(EQUIPMENT_STATUSES, {
    errorMap: () => ({ message: 'Choose the equipment’s state.' }),
  }),
  /**
   * The date the calibration certificate runs out. Blank means nobody has recorded one — which is a
   * fact worth showing, not an error: a new tool may not have come back from the lab yet.
   */
  calibrationDueDate: optionalDay,
}

export const createResourceSchema = z.object(resourceFields)

/**
 * Editing takes the certificate as well. A new item has no id for the upload's storage key to name,
 * so the scan is attached on the second visit — the item exists first, then its paper.
 */
export const updateResourceSchema = z.object({
  ...resourceFields,
  /** Set by the upload field in the form; the server checks it belongs to this equipment. */
  fileId: optionalText(64),
})

export const calibrationFilterSchema = z.object({
  q: z.string().trim().max(160).optional().default(''),
  /** `overdue` | `30` | `60` | `90` | `none` (no date) | '' for everything. */
  due: z
    .union([z.literal(''), z.enum(['overdue', '30', '60', '90', 'none'] as const)])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
  type: z
    .union([z.literal(''), z.enum(EQUIPMENT_TYPES)])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
})

export type ResourceInput = z.infer<typeof createResourceSchema>
export type CalibrationFilter = z.infer<typeof calibrationFilterSchema>

/** A calibration certificate is a scanned document: the certificate register's accepted types. */
export const CALIBRATION_UPLOAD_TYPES = CERTIFICATE_UPLOAD_TYPES

export const calibrationUploadSchema = z.object({
  /** Client-generated, so a retried upload rewrites the same File row instead of orphaning one. */
  id: z.string().uuid(),
  resourceId: z.string().trim().min(1).max(40),
  kind: z.literal('CALIBRATION'),
  filename: z.string().trim().min(1).max(200),
  mimeType: z.enum(CALIBRATION_UPLOAD_TYPES),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_UPLOAD_BYTES, 'Files must be 5 MB or smaller.'),
})

export type CalibrationUploadInput = z.infer<typeof calibrationUploadSchema>
