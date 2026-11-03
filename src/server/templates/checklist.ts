import type { CraneType, Prisma } from '@prisma/client'
import type { Tx } from '@/lib/db'

/**
 * Which checklist applies to a job (slice 46).
 *
 * A checklist is not chosen by job type alone: a PM visit to an overhead crane needs the Crane and
 * Monorail sheet, while a PM visit to a mobile crane still gets the generic servicing list. A
 * `ChecklistTemplate` therefore names its job type *and* the crane types it covers, and this module is
 * the one place that decides, so the phone, the report submission and the dispatch message cannot
 * disagree about what the technician was given.
 *
 * A sheet with no crane types is only ever a job type default. Matching `craneTypes` without the
 * `jobTypeId` half would let any active sheet override every job type, which is why both are
 * required.
 */

export interface ChecklistLine {
  section: string
  code: string
  label: string
  resultType: string
  unit: string | null
  requiresMeasurement: boolean
}

const itemSelect = {
  section: true,
  code: true,
  label: true,
  resultType: true,
  unit: true,
  requiresMeasurement: true,
} satisfies Prisma.ChecklistItemSelect

export async function checklistForJob(
  client: Tx,
  jobType: { id: string; defaultChecklistTemplateId: string | null },
  craneTypes: CraneType[],
): Promise<{ fallback: ChecklistLine[]; byType: Map<CraneType, ChecklistLine[]> }> {
  const types = [...new Set(craneTypes)]
  if (!jobType.defaultChecklistTemplateId && types.length === 0) {
    return { fallback: [], byType: new Map() }
  }

  // One query per job: the explicit default (whether or not it is still active — the link is the
  // office's decision) plus the active sheets naming one of this job's crane types, newest first.
  const templates = await client.checklistTemplate.findMany({
    where: {
      OR: [
        ...(jobType.defaultChecklistTemplateId
          ? [{ id: jobType.defaultChecklistTemplateId }]
          : []),
        ...(types.length > 0
          ? [{ isActive: true, jobTypeId: jobType.id, craneTypes: { hasSome: types } }]
          : []),
      ],
    },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      craneTypes: true,
      items: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], select: itemSelect },
    },
  })

  const fallback = jobType.defaultChecklistTemplateId
    ? (templates.find((template) => template.id === jobType.defaultChecklistTemplateId)?.items ?? [])
    : []

  const byType = new Map<CraneType, ChecklistLine[]>()
  for (const type of types) {
    // An empty sheet falls back rather than showing a blank form.
    const match = templates.find(
      (template) => template.craneTypes.includes(type) && template.items.length > 0,
    )
    if (match) byType.set(type, match.items)
  }

  return { fallback, byType }
}
