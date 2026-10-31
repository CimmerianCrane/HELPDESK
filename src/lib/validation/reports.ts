import { z } from 'zod'
import type { TemplateField, TemplateSchema } from '@/lib/templates/schema'

/**
 * Report input rules (slice 8).
 *
 * Two shapes are validated here, because a report is made of two things that look alike and are not:
 *
 *  - `Report.data` follows the **report template** the job type points at. Its `fields` sections are
 *    one flat answer map and its `table` sections are arrays of rows keyed by field key — exactly as
 *    `src/lib/templates/schema.ts` declares. Validated against the template version stored on the
 *    report, never against whatever the template says today.
 *  - `Report.data.checklist` follows the **checklist template** the technician filled in on site.
 *    It is keyed by `ChecklistItem.code`, not by report field keys, because the two catalogues are
 *    versioned independently. The reserved `checklist` key is the one thing this file adds to the
 *    template-declared map; it is recorded in `docs/ASSUMPTIONS.md`.
 *
 * Both are stripped of unknown keys on the way through, so a phone that has an old copy of a
 * template cannot smuggle extra fields into the stored JSON.
 */

export const PASS_FAIL_NA = ['Pass', 'Fail', 'N/A'] as const
export const YES_NO = ['Yes', 'No'] as const

/** Checklist items as the phone receives them, so this file need not import Prisma into a browser. */
export interface ChecklistItemLike {
  code: string
  label: string
  resultType: string
  requiresMeasurement: boolean
}

export interface ChecklistAnswer {
  result?: string | null
  measurement?: number | null
  note?: string | null
}

/** A number the form may leave empty. `''` and `null` mean "no answer", not zero. */
function optionalNumber() {
  return z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.coerce.number().finite(),
  )
}

function fieldSchema(field: TemplateField, required: boolean): z.ZodTypeAny {
  let base: z.ZodTypeAny

  switch (field.type) {
    case 'PASS_FAIL_NA':
      base = z.enum(PASS_FAIL_NA)
      break
    case 'YES_NO':
      base = z.enum(YES_NO)
      break
    case 'RADIO':
      base = z.enum(field.options as [string, ...string[]])
      break
    case 'NUMBER':
      base = optionalNumber()
      break
    case 'DATE':
      base = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD form.')
      break
    default:
      base = required ? z.string().trim().min(1, 'This field is required.') : z.string().max(5000)
  }

  // A required NUMBER must actually be answered: `optionalNumber` already lets `''` through as
  // "not answered", so requiring it means rejecting that undefined rather than merely allowing it.
  if (field.type === 'NUMBER') {
    return required ? base.refine((value) => value !== undefined, 'This field is required.') : base
  }
  return required ? base : base.optional()
}

/**
 * The answer map the report template declares.
 *
 * A `fields` section contributes to one flat map, so its keys must be unique template-wide (the
 * template itself is checked for that when seeded). A `table` section stores its rows under the
 * section key.
 */
export function templateDataSchema(template: TemplateSchema) {
  const shape: z.ZodRawShape = {}

  for (const section of template.sections) {
    if (section.layout === 'fields') {
      for (const field of section.fields) {
        shape[field.key] = fieldSchema(field, field.required === true)
      }
      continue
    }

    const rowShape: z.ZodRawShape = {}
    for (const field of section.fields) {
      rowShape[field.key] = fieldSchema(field, field.required === true)
    }

    // A row the technician added and never filled in is noise, not an answer. Drop it before
    // `minRows` is checked, so "add row" alone cannot satisfy a required table.
    shape[section.key] = z.preprocess(
      (value) => {
        // A table the technician never touched is absent, not invalid — but it is still an empty
        // list, so `minRows` applies to it.
        if (value === undefined || value === null || value === '') return []
        return Array.isArray(value)
          ? value.filter(
              (row) =>
                row &&
                typeof row === 'object' &&
                Object.values(row as Record<string, unknown>).some(
                  (answer) => answer !== '' && answer !== null && answer !== undefined,
                ),
            )
          : value
      },
      z.array(z.object(rowShape)).min(section.minRows ?? 0).max(100),
    )
  }

  return z.object(shape)
}

/** One answer against one checklist item. The item's `resultType` decides which part is required. */
function checklistAnswerSchema(item: ChecklistItemLike) {
  return z
    .object({
      result: z
        .union([z.literal(''), z.enum(['Pass', 'Fail', 'N/A', 'Yes', 'No'])])
        .nullish()
        .transform((value) => (value ? value : null)),
      measurement: optionalNumber().nullish().transform((value) => (value ?? null)),
      note: z
        .string()
        .max(2000)
        .nullish()
        .transform((value) => (value?.trim() ? value.trim() : null)),
    })
    .superRefine((answer, ctx) => {
      if (item.resultType === 'PASS_FAIL_NA' && !answer.result) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose Pass, Fail or N/A.' })
      }
      if (item.resultType === 'YES_NO' && !answer.result) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose Yes or No.' })
      }
      if (
        item.resultType === 'NUMBER' &&
        item.requiresMeasurement &&
        answer.measurement === null
      ) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a measurement.' })
      }
    })
}

/** Checklist answers keyed by item code, every item on the checklist required to appear. */
export function checklistAnswersSchema(items: ChecklistItemLike[]) {
  const shape: z.ZodRawShape = {}
  for (const item of items) shape[item.code] = checklistAnswerSchema(item)
  return z.object(shape)
}

/**
 * The Service Report grading: every checklist line gets a condition rating from 1 to 5 and a short
 * comment saying what needs replacing or what is damaged. Stored under the reserved `grades` key of
 * `Report.data`, one entry per `ChecklistItem.code` — the same key the checklist answers use, because
 * the two are two halves of one line on the paper form.
 *
 * The schema accepts any number and the service checks it is a whole 1–5, so the phone's own check
 * (which uses the same rule) and the server agree on the wording of the refusal.
 */
export const SERVICE_GRADES = [1, 2, 3, 4, 5] as const

export const SERVICE_GRADE_LABELS: Record<number, string> = {
  5: 'As new',
  4: 'Good',
  3: 'Serviceable',
  2: 'Repair soon',
  1: 'Failed',
}

export interface ComponentGrade {
  grade: number | null
  comment: string | null
  /** The checklist line's wording, snapshotted at submission so an old report re-renders as signed. */
  label: string | null
}

export function serviceGradesSchema() {
  return z.object({
    grades: z
      .record(
        z.string().min(1).max(80),
        z.object({
          // `''` and `null` mean "not graded": the schema keeps that distinction because the service
          // uses it to tell an unanswered line from a rated one.
          grade: z
            .preprocess(
              (value) => (value === '' || value === undefined ? null : value),
              z.union([z.null(), z.coerce.number().finite()]),
            )
            .transform((value) => value ?? null),
          comment: z
            .string()
            .max(2000)
            .nullish()
            .transform((value) => (value?.trim() ? value.trim() : null)),
          label: z.string().max(300).nullish().transform((value) => value ?? null),
        }),
      )
      .superRefine((grades, ctx) => {
        for (const [code, entry] of Object.entries(grades)) {
          if (entry.grade !== null && !SERVICE_GRADES.includes(entry.grade as 1 | 2 | 3 | 4 | 5)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [code, 'grade'],
              message: 'Grade must be a whole number from 1 to 5.',
            })
          }
        }
      })
      .optional(),
  })
}

/** The grades on a report, read back without trusting the stored JSON. */
export function readGrades(data: unknown): Record<string, ComponentGrade> {
  if (!data || typeof data !== 'object') return {}
  const raw = (data as Record<string, unknown>).grades
  const parsed = serviceGradesSchema().safeParse({ grades: raw })
  return parsed.success ? (parsed.data.grades ?? {}) : {}
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
export const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export const fileUploadSchema = z.object({
  /** Client-generated, so a retried upload upserts the same File row instead of adding another. */
  id: z.string().uuid(),
  jobId: z.string().min(1).max(64),
  kind: z.enum(['PHOTO', 'SIGNATURE']),
  filename: z.string().trim().min(1).max(200),
  mimeType: z.enum(ALLOWED_UPLOAD_TYPES),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_UPLOAD_BYTES, 'Files must be 5 MB or smaller.'),
})

export type FileUploadInput = z.infer<typeof fileUploadSchema>

/**
 * The report as the phone submits it.
 *
 * `reportId` is generated on the phone before it ever has a signal, so the retry and the idempotency
 * receipt can both key on it. Nothing here is trusted: the service derives the template and the
 * checklist from the job and checks that this phone still has the version it rendered.
 */
export function reportSubmitSchema(template: TemplateSchema, checklistItems: ChecklistItemLike[]) {
  return z
    .object({
      reportId: z.string().uuid(),
      jobId: z.string().min(1).max(64),
      craneId: z.string().min(1).max(64),
      templateId: z.string().min(1).max(64),
      templateVersion: z.number().int().positive(),
      data: templateDataSchema(template),
      checklist: checklistAnswersSchema(checklistItems),
      /** Service Reports only; the server refuses a grading on any other job type. */
      ...serviceGradesSchema().shape,
      parts: z
        .array(
          z.object({
            partNumber: z.string().trim().min(1).max(80),
            quantity: z.coerce.number().positive().max(10_000),
            serialOrBatch: z
              .string()
              .trim()
              .max(120)
              .nullish()
              .transform((value) => (value ? value : null)),
          }),
        )
        .max(50)
        .default([]),
      photoFileIds: z.array(z.string().min(1).max(64)).max(20).default([]),
      technicianSignerName: z.string().trim().min(1, 'Record the technician’s name.').max(120),
      technicianSignatureFileId: z.string().min(1, 'A technician signature is required.').max(64),
      customerSignerName: z
        .string()
        .trim()
        .max(120)
        .nullish()
        .transform((value) => (value ? value : null)),
      customerSignerDesignation: z
        .string()
        .trim()
        .max(120)
        .nullish()
        .transform((value) => (value ? value : null)),
      customerSignatureFileId: z
        .string()
        .max(64)
        .nullish()
        .transform((value) => (value ? value : null)),
      customerDeclinedReason: z
        .string()
        .trim()
        .max(500)
        .nullish()
        .transform((value) => (value ? value : null)),
    })
    .superRefine((value, ctx) => {
      // Brief §6.4: unavailable or declined is a reason, not a blank signature.
      if (!value.customerSignatureFileId && !value.customerDeclinedReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['customerDeclinedReason'],
          message: 'Capture the customer’s signature, or say why they did not sign.',
        })
      }
      if (value.customerSignatureFileId && value.customerDeclinedReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['customerDeclinedReason'],
          message: 'A signature and a decline reason cannot both be recorded.',
        })
      }
      if (value.customerSignatureFileId && !value.customerSignerName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['customerSignerName'],
          message: 'Record the name of the person who signed.',
        })
      }
    })
}

export type ReportSubmitInput = z.infer<ReturnType<typeof reportSubmitSchema>>

/**
 * `Report.safeToOperate` is a short code; the template asks the question in words. Mapping lives
 * here so the service and the form cannot disagree about which option means which code.
 */
export function safeToOperateCode(value: unknown): 'YES' | 'NO' | 'WITH_RESTRICTIONS' | null {
  if (value === 'Yes') return 'YES'
  if (value === 'No') return 'NO'
  if (value === 'Yes, with restrictions') return 'WITH_RESTRICTIONS'
  return null
}
