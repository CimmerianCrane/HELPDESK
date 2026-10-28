import { z } from 'zod'
import { MAX_UPLOAD_BYTES } from './reports'

/**
 * Input rules for a crane's certificates (brief §6.6, slice 13).
 *
 * The register holds documents somebody else issued — an Authorised Examiner's certificate of test
 * and examination, a load test certificate, a calibration record. Our own reports are company
 * inspections and never appear here (CLAUDE.md rule 3), which is why every type carries an issuer
 * field rather than a "we certify" claim.
 */

export const CERTIFICATE_TYPES = [
  'STATUTORY_TEST_EXAMINATION',
  'LOAD_TEST',
  'CALIBRATION',
  'COMPETENCY',
  'REGISTRATION',
  'LIFTING_GEAR_EXAM',
  'REPAIR_MODIFICATION_RECORD',
] as const

export const CERTIFICATE_TYPE_LABELS: Record<(typeof CERTIFICATE_TYPES)[number], string> = {
  STATUTORY_TEST_EXAMINATION: 'Statutory test & examination',
  LOAD_TEST: 'Load test certificate',
  CALIBRATION: 'Calibration certificate',
  COMPETENCY: 'Competency certificate',
  REGISTRATION: 'Registration document',
  LIFTING_GEAR_EXAM: 'Lifting gear examination',
  REPAIR_MODIFICATION_RECORD: 'Repair / modification record',
}

/**
 * The one type the brief says an Authorised Examiner issues (§6.6, §7). Everything else is a document
 * we hold: a certificate from a calibration lab, a registration paper, a competency record. Keeping
 * the label apart from the rest is what stops the UI implying our own inspections are statutory.
 */
export const STATUTORY_CERTIFICATE_TYPES = ['STATUTORY_TEST_EXAMINATION'] as const

export function isStatutoryCertificate(type: string): boolean {
  return (STATUTORY_CERTIFICATE_TYPES as readonly string[]).includes(type)
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value ? value : null))

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A date input, read as UTC midnight — the same convention schedules and cranes use. */
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

const statedSwlKg = z
  .union([
    z.literal(''),
    z.coerce
      .number()
      .positive('A safe working load must be above zero.')
      .max(10_000_000, 'That is not a plausible safe working load.'),
  ])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value))

const certificateFields = {
  type: z.enum(CERTIFICATE_TYPES, {
    errorMap: () => ({ message: 'Choose the kind of certificate.' }),
  }),
  certificateNumber: optionalText(120),
  issuer: optionalText(160),
  issueDate: optionalDay,
  expiryDate: optionalDay,
  nextDueDate: optionalDay,
  statedSwlKg,
  /** The job that produced it, by number — a select of every job on the crane is not worth the query. */
  jobNumber: optionalText(80),
  /** Set by the upload field in the form; the server checks it belongs to this crane. */
  fileId: optionalText(64),
  notes: optionalText(2000),
}

function checkDates(
  input: { issueDate: Date | null; expiryDate: Date | null; nextDueDate: Date | null },
  ctx: z.RefinementCtx,
) {
  if (input.issueDate && input.expiryDate && input.expiryDate < input.issueDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiryDate'],
      message: 'A certificate cannot expire before it was issued.',
    })
  }
  if (input.issueDate && input.nextDueDate && input.nextDueDate < input.issueDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nextDueDate'],
      message: 'The next due date cannot come before the issue date.',
    })
  }
}

export const createCertificateSchema = z
  .object({
    craneId: z.string().trim().min(1, 'Choose a crane.').max(40),
    ...certificateFields,
  })
  .superRefine(checkDates)

export const updateCertificateSchema = z
  .object(certificateFields)
  .superRefine((input, ctx) => checkDates(input, ctx))

export const certificateFilterSchema = z.object({
  q: z.string().trim().max(160).optional().default(''),
  /** `overdue` | `30` | `60` | `90` | `none` (no date) | '' for everything. */
  due: z
    .union([z.literal(''), z.enum(['overdue', '30', '60', '90', 'none'] as const)])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
  type: z
    .union([z.literal(''), z.enum(CERTIFICATE_TYPES)])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
})

export type CreateCertificateInput = z.infer<typeof createCertificateSchema>
export type UpdateCertificateInput = z.infer<typeof updateCertificateSchema>
export type CertificateFilter = z.infer<typeof certificateFilterSchema>

/** What a certificate may be stored as: a scan (PDF) or a phone photograph of the paper. */
export const CERTIFICATE_UPLOAD_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export const certificateUploadSchema = z.object({
  /** Client-generated, so a retried upload rewrites the same File row instead of orphaning one. */
  id: z.string().uuid(),
  craneId: z.string().trim().min(1).max(40),
  kind: z.literal('CERTIFICATE'),
  filename: z.string().trim().min(1).max(200),
  mimeType: z.enum(CERTIFICATE_UPLOAD_TYPES),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_UPLOAD_BYTES, 'Files must be 5 MB or smaller.'),
})

export type CertificateUploadInput = z.infer<typeof certificateUploadSchema>
