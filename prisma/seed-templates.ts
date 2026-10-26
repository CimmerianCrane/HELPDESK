import type { PrismaClient } from '@prisma/client'
import { templateSchema, templateOutlineHtml } from '../src/lib/templates/schema'
import { JOB_TYPES, TEMPLATES } from '../src/server/templates/definitions'

/**
 * Seeds the 14 job types and the four Phase 1 templates (brief §4.1, §6.3).
 *
 * Idempotent, and deliberately non-destructive: a job type or template that already exists is left
 * exactly as it is. An office that has renamed a job type or changed a default priority must not have
 * that silently undone by the next `npm run seed`, and a template version is immutable by design
 * (CLAUDE.md rule 5) — changing one means publishing version 2, which is a deliberate data entry.
 *
 * Template rows are created at version 1. This module is the source of truth only for the first
 * version; after that the rows in the database are.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function seedJobTypesAndTemplates(db: PrismaClient): Promise<void> {
  // Templates first: a job type points at its default checklist and report template by id.
  const templateIds = new Map<string, { checklistId: string; reportId: string }>()

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

    const report =
      (await db.reportTemplate.findUnique({
        where: { code_version: { code: `${definition.code}-v1`, version: 1 } },
        select: { id: true },
      })) ??
      (await db.reportTemplate.create({
        data: {
          code: `${definition.code}-v1`,
          name: definition.name,
          version: 1,
          bodyHtml: templateOutlineHtml(definition.name, definition.report, escapeHtml),
          schema: definition.report as never,
          isActive: true,
        },
        select: { id: true },
      }))

    templateIds.set(definition.key, { checklistId: checklist.id, reportId: report.id })
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
          defaultChecklistTemplateId: templates?.checklistId ?? null,
          defaultReportTemplateId: templates?.reportId ?? null,
        },
      })
      created += 1
      continue
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
  }

  console.log(
    `Job types and templates: ${TEMPLATES.length} templates, ${JOB_TYPES.length} job types ` +
      `(${created} created; ${updatedLinks} existing job type(s) had a missing template link filled).`,
  )
}
