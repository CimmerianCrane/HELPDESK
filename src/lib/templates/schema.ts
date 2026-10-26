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

const sectionSchema = z
  .object({
    key: z.string().min(1).regex(/^[a-z][a-zA-Z0-9]*$/, 'Section keys are lower camel case.'),
    label: z.string().min(1),
    layout: z.enum(['fields', 'table']),
    fields: z.array(fieldSchema).min(1),
    minRows: z.number().int().min(1).optional(),
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
    const flatKeys = template.sections
      .filter((section) => section.layout === 'fields')
      .flatMap((section) => section.fields.map((field) => field.key))
    if (new Set(flatKeys).size !== flatKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Two form sections use the same field key; answers would overwrite each other.',
      })
    }
  })

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
