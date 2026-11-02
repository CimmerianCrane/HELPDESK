import { z } from 'zod'

/**
 * The shape of a report template's `schema` column, and therefore of the `Report.data` it validates.
 *
 * A report is not free-form text with a few headings bolted on. Each job type produces the same
 * evidence every time — a servicing visit records a brake lining measurement, a load test records
 * the load at each radius — and the office has to be able to read two of them side by side. So the
 * template declares its sections and fields as data, each field has a stable `key`, and `Report.data`
 * is a map keyed by those keys.
 *
 * Why data rather than a component per template: a report is validated on submit (slice 8), rendered
 * years later (slice 9) and superseded without being edited (CLAUDE.md rule 5). All three need the
 * shape to be readable by code that was not written alongside it.
 *
 * `checklistCode` links a report template to the checklist template a technician fills in on site.
 * They are separate tables because a checklist is completed in the field and a report adds the
 * narrative and the sign-offs; both are versioned independently.
 */

export const FIELD_TYPES = ['PASS_FAIL_NA', 'YES_NO', 'NUMBER', 'TEXT', 'RADIO', 'DATE'] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export interface TemplateField {
  /** Stable across versions, and the key this field's answer is stored under in `Report.data`. */
  key: string
  label: string
  type: FieldType
  /** Shown after the input, e.g. `mm`. Only meaningful for NUMBER. */
  unit?: string
  /** Choices for RADIO, in display order. */
  options?: string[]
  required?: boolean
  /** Free-text hint under the input. */
  help?: string
}

/**
 * How a table of instruments is checked against the calibration register (brief §6.3).
 *
 * Declared by the template rather than found by column name, so a load test can name its own columns
 * and the form still knows which date the instruments had to be valid on and which cell to match
 * against `Resource.serialNumber`. The check warns; it never refuses a report.
 */
export interface CalibrationCheck {
  /** A `fields` section field of type DATE: the day the instrument was used. */
  testDateKey: string
  /** This section's column holding the instrument's serial number. */
  serialKey: string
  /** This section's column holding the calibration due date recorded against the instrument. */
  dueKey: string
  /** This section's column naming the instrument, for the warning's wording. */
  labelKey: string
}

export interface TemplateSection {
  key: string
  label: string
  /**
   * `fields` renders as an ordinary form section. `table` renders repeatable rows — the radii of a
   * load test, the parts fitted to a crane — and `Report.data[section.key]` is then an array of
   * objects keyed by the same field keys.
   */
  layout: 'fields' | 'table'
  fields: TemplateField[]
  /** For a table: how many rows before the form complains. */
  minRows?: number
  /** Set on a table of test instruments, to check each one's calibration at the test date. */
  calibration?: CalibrationCheck
}

export interface TemplateSchema {
  checklistCode?: string
  sections: TemplateSection[]
}

const fieldSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .regex(/^[a-z][a-zA-Z0-9]*$/, 'Field keys are lower camel case, e.g. testLoadKg.'),
    label: z.string().min(1),
    type: z.enum(FIELD_TYPES),
    unit: z.string().min(1).optional(),
    options: z.array(z.string().min(1)).min(2).optional(),
    required: z.boolean().optional(),
    help: z.string().min(1).max(500).optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === 'RADIO' && !field.options) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A RADIO field needs options.' })
    }
    if (field.type !== 'RADIO' && field.options) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only a RADIO field takes options.' })
    }
    if (field.unit && field.type !== 'NUMBER') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only a NUMBER field takes a unit.' })
    }
  })

const calibrationSchema = z.object({
  testDateKey: z.string().min(1),
  serialKey: z.string().min(1),
  dueKey: z.string().min(1),
  labelKey: z.string().min(1),
})

const sectionSchema = z
  .object({
    key: z.string().min(1).regex(/^[a-z][a-zA-Z0-9]*$/, 'Section keys are lower camel case.'),
    label: z.string().min(1),
    layout: z.enum(['fields', 'table']),
    fields: z.array(fieldSchema).min(1),
    minRows: z.number().int().min(1).optional(),
    calibration: calibrationSchema.optional(),
  })
  .superRefine((section, ctx) => {
    const keys = section.fields.map((field) => field.key)
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate field key in ${section.key}.` })
    }
    if (section.layout === 'fields' && section.minRows !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'minRows is only meaningful for a table section.',
      })
    }
    if (section.calibration && section.layout !== 'table') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A calibration check belongs on a table of instruments.',
      })
    }
  })

/**
 * Validates a template definition. Used by the seed (which is where templates are authored for now)
 * and by any future admin editor, so a malformed template is caught before it is stored rather than
 * when someone tries to fill it in on site.
 */
export const templateSchema = z
  .object({
    checklistCode: z.string().min(1).optional(),
    sections: z.array(sectionSchema).min(1),
  })
  .superRefine((template, ctx) => {
    const keys = template.sections.map((section) => section.key)
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate section key.' })
    }

    // Fields in `fields` sections share one answer map, so their keys must be unique template-wide.
    // Table columns do not: each section's rows are stored under the section key, so `description`
    // can mean "what is wrong" in findings and "the part's description" in parts without collision.
    const flats = template.sections
      .filter((section) => section.layout === 'fields')
      .flatMap((section) => section.fields)
    if (new Set(flats.map((field) => field.key)).size !== flats.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Two form sections use the same field key; answers would overwrite each other.',
      })
    }

    // A calibration check points at a date the form already asks for and at three of its own
    // columns. Naming a key that does not exist would make the check silently do nothing.
    for (const section of template.sections.filter((entry) => entry.calibration)) {
      const check = section.calibration!
      const dateField = flats.find((field) => field.key === check.testDateKey)
      if (dateField?.type !== 'DATE') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Calibration check on ${section.key} needs ${check.testDateKey} to be a DATE field.`,
        })
      }
      for (const key of [check.serialKey, check.dueKey, check.labelKey]) {
        if (!section.fields.some((field) => field.key === key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Calibration check on ${section.key} names a column it does not have (${key}).`,
          })
        }
      }
    }
  })

/** An instrument as the register knows it: what the phone caches, nothing more. */
export interface CalibrationResource {
  name: string
  /** Matched against the template's `serialKey` column, as typed or scanned on site. */
  serialNumber: string
  /** `YYYY-MM-DD` in the operating timezone, from `Resource.calibrationDueDate`. */
  calibrationDue: string | null
}

/** `YYYY-MM-DD` as the office prints it, DD/MM/YYYY (CLAUDE.md rule 8). */
function day(value: string): string {
  const [year, month, date] = value.split('-')
  return `${date}/${month}/${year}`
}

/**
 * Calibration warnings for a report's instrument table (brief §6.3, slice 17).
 *
 * The brief asks that a load test's referenced calibration be valid **at the test date**, and warns
 * rather than blocks. Three things are worth saying out loud, and a fourth is deliberately not:
 *
 *  - the recorded due date is before the test date (lapsed on the day);
 *  - the register's due date for that serial is before the test date, even if the form says otherwise;
 *  - nobody has told this phone the register's date, so the certificate is unverified.
 *
 * An instrument the register has never heard of is not a warning: test weights hired for the day are
 * normal, and their due date is still recorded on the form. Warnings are plain strings so the phone,
 * the office page and a test can all read them, and nothing here reads a clock — the test date is the
 * only date that matters, which is what makes an old report's check reproducible.
 */
export function calibrationWarnings(
  template: TemplateSchema,
  data: Record<string, unknown>,
  calibrationDueBySerial: ReadonlyMap<string, string | null> = new Map(),
): Array<{ instrument: string; message: string }> {
  const warnings: Array<{ instrument: string; message: string }> = []
  const known = new Map(
    [...calibrationDueBySerial].map(([serial, due]) => [serial.trim().toUpperCase(), due]),
  )

  for (const section of template.sections) {
    const check = section.calibration
    if (!check) continue
    const testDate = data[check.testDateKey]
    if (typeof testDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(testDate)) continue

    const rows = Array.isArray(data[section.key]) ? (data[section.key] as unknown[]) : []
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue
      const row = raw as Record<string, unknown>
      const cell = (key: string) =>
        typeof row[key] === 'string' ? (row[key] as string).trim() : ''
      const label = cell(check.labelKey) || 'An instrument'
      const serial = cell(check.serialKey)
      const stated = cell(check.dueKey)

      if (stated && stated < testDate) {
        warnings.push({
          instrument: label,
          message: `${label} was out of calibration on ${day(testDate)}: its due date was ${day(stated)}.`,
        })
      }

      // The register only speaks for a serial it knows; no serial, no question to ask it. Serials are
      // compared case-insensitively, because nobody types TW-1000-04 the same way twice.
      if (!serial) continue
      const registered = known.get(serial.toUpperCase())
      if (registered === undefined) continue
      if (registered === null && !stated) {
        warnings.push({
          instrument: label,
          message: `${label} (${serial}) has no calibration date in the register, so this phone cannot verify it.`,
        })
      } else if (registered && registered < testDate && registered !== stated) {
        warnings.push({
          instrument: label,
          message: `The register says ${label} (${serial}) was due for calibration on ${day(registered)}, before this test.`,
        })
      }
    }
  }

  return warnings
}

/** Every field key in the template, in document order. Handy for tests and for the slice 8 form. */
export function templateFieldKeys(template: TemplateSchema): string[] {
  return template.sections.flatMap((section) => section.fields.map((field) => field.key))
}

/**
 * The template's structure as printable HTML. `ReportTemplate.bodyHtml` is required by the schema
 * and this is what fills it: the template written out in words, so two versions of a report can be
 * compared without reading a JSON blob. Slice 9's PDF does not render from it — that uses a versioned
 * component per template, because pagination and embedded signatures need layout, not prose.
 */
export function templateOutlineHtml(
  name: string,
  template: TemplateSchema,
  escape: (value: string) => string,
): string {
  const sections = template.sections
    .map((section) => {
      const fields = section.fields
        .map((field) => {
          const unit = field.unit ? ` (${escape(field.unit)})` : ''
          const options = field.options ? ` — ${field.options.map(escape).join(' / ')}` : ''
          return `<li>${escape(field.label)}${unit}${options}</li>`
        })
        .join('')
      const layout = section.layout === 'table' ? ' <em>(repeats per row)</em>' : ''
      return `<h2>${escape(section.label)}${layout}</h2><ul>${fields}</ul>`
    })
    .join('')

  return `<h1>${escape(name)}</h1>${sections}`
}
