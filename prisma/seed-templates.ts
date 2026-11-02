import type { PrismaClient } from '@prisma/client'
import { templateSchema, templateOutlineHtml } from '../src/lib/templates/schema'
import { JOB_TYPES, TEMPLATES, type TemplateKey } from '../src/server/templates/definitions'

/**
 * Seeds the 14 job types and the four Phase 1 templates (brief §4.1, §6.3).
 *
 * Idempotent, and deliberately non-destructive: a job type or template that already exists is left
 * exactly as it is. An office that has renamed a job type or changed a default priority must not have
 * that silently undone by the next `npm run seed`, and a template version is immutable by design
 * (CLAUDE.md rule 5) — changing one means publishing version 2, which is a deliberate data entry.
 *
 * Template rows are created at the version the definition declares. This module is the source of
 * truth only for the versions it declares; once published, a row in the database is.
 *
 * A definition at version 2 is the one deliberate exception to "leave the link alone": the job type
 * is moved onto the newer row only when it still points at an *older version of the same template*,
 * which is what "the templates were built out" means. A job type pointed at something else entirely
 * is an office decision and is not touched.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The id of the template version this definition publishes, when the job type is on an older version
 * of the same template. `null` when there is nothing to move: the same version, a different template,
 * or no template at all.
 */
async function supersededTemplateId(
  db: PrismaClient,
  jobType: { defaultReportTemplateId: string | null },
  key: TemplateKey | undefined,
  version: number,
): Promise<string | null> {
  if (!key || !jobType.defaultReportTemplateId) return null
  const current = await db.reportTemplate.findUnique({
    where: { id: jobType.defaultReportTemplateId },
    select: { code: true, version: true },
  })
  // Codes are `<key>-v<n>`, so the same template under an older version shares the key prefix.
  if (!current || !current.code.startsWith(`${key}-v`) || current.version >= version) return null
  const row = await db.reportTemplate.findUnique({
    where: { code_version: { code: `${key}-v${version}`, version } },
    select: { id: true },
  })
  return row?.id ?? null
}

export async function seedJobTypesAndTemplates(db: PrismaClient): Promise<void> {
  // Templates first: a job type points at its default checklist and report template by id.
  const templateIds = new Map<string, { checklistId: string; reportId: string; version: number }>()

  for (const definition of TEMPLATES) {
    // Fail loudly on a malformed definition rather than storing something an on-site form cannot
    // render. The seed is the authoring tool for now, so this is where the check belongs.
    templateSchema.parse(definition.report)

    const checklist =
      (await db.checklistTemplate.findUnique({
        where: { code_version: { code: definition.checklist.code, version: 1 } },
        select: { id: true },
      })) ??
      (await db.checklistTemplate.create({
        data: {
          code: definition.checklist.code,
          name: definition.checklist.name,
          version: 1,
          items: {
            create: definition.checklist.items.map((item, index) => ({
              section: item.section,
              code: item.code,
              label: item.label,
              resultType: item.resultType,
              unit: item.unit ?? null,
              requiresMeasurement: item.requiresMeasurement ?? false,
              sortOrder: index * 10,
            })),
          },
        },
        select: { id: true },
      }))

    const code = `${definition.code}-v${definition.version}`
    const report =
      (await db.reportTemplate.findUnique({
        where: { code_version: { code, version: definition.version } },
        select: { id: true },
      })) ??
      (await db.reportTemplate.create({
        data: {
          code,
          name: definition.name,
          version: definition.version,
          bodyHtml: templateOutlineHtml(definition.name, definition.report, escapeHtml),
          schema: definition.report as never,
          isActive: true,
        },
        select: { id: true },
      }))

    templateIds.set(definition.key, {
      checklistId: checklist.id,
      reportId: report.id,
      version: definition.version,
    })
  }

  let created = 0
  let updatedLinks = 0

  for (const jobType of JOB_TYPES) {
    const existing = await db.jobType.findUnique({ where: { code: jobType.code } })
    const templates = jobType.template ? templateIds.get(jobType.template) : undefined

    if (!existing) {
      await db.jobType.create({
        data: {
          code: jobType.code,
          name: jobType.name,
          description: jobType.description,
          defaultPriority: jobType.defaultPriority,
          sortOrder: jobType.sortOrder,
          requiredDocumentTypes: jobType.requiredDocumentTypes ?? [],
          requiredCompetencies: jobType.requiredCompetencies ?? [],
          isServiceReport: jobType.isServiceReport ?? false,
          defaultChecklistTemplateId: templates?.checklistId ?? null,
          defaultReportTemplateId: templates?.reportId ?? null,
        },
      })
      created += 1
      continue
    }

    // A definition that publishes a newer version moves the job type onto it, but only when the job
    // type still points at an older version of the same template. Anything else is the office's.
    const newer = templates
      ? await supersededTemplateId(db, existing, jobType.template, templates.version)
      : null
    if (newer && newer !== existing.defaultReportTemplateId) {
      await db.jobType.update({
        where: { id: existing.id },
        data: { defaultReportTemplateId: newer },
      })
      updatedLinks += 1
    }

    // Only fill a link that is missing. An office that has pointed a job type at a different
    // template meant it, so leave it alone.
    if (
      templates &&
      (!existing.defaultChecklistTemplateId || !existing.defaultReportTemplateId)
    ) {
      await db.jobType.update({
        where: { id: existing.id },
        data: {
          defaultChecklistTemplateId: existing.defaultChecklistTemplateId ?? templates.checklistId,
          defaultReportTemplateId: existing.defaultReportTemplateId ?? templates.reportId,
        },
      })
      updatedLinks += 1
    }

    // A job type seeded before Service Reports existed is not a Service Report, and turning one on is
    // the office's decision. The static `isServiceReport` flag is therefore filled once, like the
    // competency list below, and never overwritten afterwards.
    if (jobType.isServiceReport && !existing.isServiceReport) {
      await db.jobType.update({
        where: { id: existing.id },
        data: { isServiceReport: true },
      })
      updatedLinks += 1
    }

    // Competency requirements were added in slice 6, so job types seeded before it have an empty
    // list. Empty means "nothing recorded", not "the office deliberately requires nothing", so it is
    // filled once — and never overwritten afterwards.
    if (
      existing.requiredCompetencies.length === 0 &&
      (jobType.requiredCompetencies ?? []).length > 0
    ) {
      await db.jobType.update({
        where: { id: existing.id },
        data: { requiredCompetencies: jobType.requiredCompetencies },
      })
      updatedLinks += 1
    }
  }

  console.log(
    `Job types and templates: ${TEMPLATES.length} templates, ${JOB_TYPES.length} job types ` +
      `(${created} created; ${updatedLinks} existing job type(s) updated).`,
  )
}
