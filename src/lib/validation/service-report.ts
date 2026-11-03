import { z } from 'zod'
import { SERVICE_GRADE_LABELS, readGrades } from './reports'

/**
 * The Service Report (slice 39): the words a visit's graded checklists become.
 *
 * A **Servicing checklist form** is filled in per crane on site — a `Report` whose `data.grades` holds
 * a 1–4 rating and a comment for every line. The **Service Report** is one document for the job: a
 * section per crane, a paragraph per part, and one `SR<yy><mm><nnn>` number. The prose is generated
 * from the grades and the technicians' comments, and the office may reword any paragraph before
 * approving, so this file is both the generator's output shape and the office's edit contract.
 *
 * Paragraphs are stored, not derived, for the same reason every other issued document snapshots its
 * input: the report must re-render exactly as approved even if a checklist template is superseded.
 */

export const serviceReportParagraphSchema = z.object({
  /** The checklist line's wording as the technician saw it. */
  component: z.string().trim().min(1).max(300),
  grade: z.number().int().min(1).max(5).nullable(),
  /** The technician's own note, kept beside the sentence so an editor can see what it came from. */
  comment: z.string().trim().max(2000).nullable(),
  /** The sentence that prints. Generated on first build, then edited by the office. */
  text: z.string().trim().min(1, 'Every part needs a sentence on the Service Report.').max(2000),
})

export const serviceReportCraneSchema = z.object({
  craneId: z.string().min(1).max(64),
  assetTag: z.string().trim().min(1).max(120),
  type: z.string().max(120).nullable(),
  /** Worst first, so the reader meets the failures before the well-maintained parts. */
  paragraphs: z.array(serviceReportParagraphSchema).max(200),
})

export const serviceReportContentSchema = z.object({
  cranes: z.array(serviceReportCraneSchema).min(1, 'A Service Report needs at least one crane.').max(200),
})

export type ServiceReportContent = z.infer<typeof serviceReportContentSchema>
export type ServiceReportCrane = z.infer<typeof serviceReportCraneSchema>
export type ServiceReportParagraph = z.infer<typeof serviceReportParagraphSchema>

/**
 * One sentence per graded part, from the rating and the technician's note.
 *
 * The wording is deliberately flat — it is a record, not sales copy: "Hoist brake — Grade 2, repair
 * soon. Lining at 1.8 mm, replace next visit." A grade with no comment still gets a sentence, because
 * "grade 1, failed" with no note is itself the finding.
 */
export function serviceReportSentence(
  component: string,
  grade: number | null,
  comment: string | null,
): string {
  const rating = grade ? SERVICE_GRADE_LABELS[grade] : null
  // A stored 5 is a report graded before slice 46; it reads as the five-point scale it was given.
  const verdict =
    grade === null
      ? 'Not graded'
      : `Grade ${grade} of ${grade > 4 ? 5 : 4} — ${rating ?? 'rated'}`
  const note = comment?.trim()
  return note ? `${component}: ${verdict}. ${note}` : `${component}: ${verdict}.`
}

/** What a report's grades look like coming out of `Report.data`, for building the prose. */
export interface GradedChecklist {
  craneId: string
  assetTag: string
  type: string | null
  data: unknown
}

/**
 * Builds the document from a job's submitted per-crane reports.
 *
 * A crane with no grades contributes nothing: an ungraded checklist has not been filled in, and a
 * Service Report that lists a crane with no findings would say the office surveyed a machine nobody
 * looked at. The caller decides whether "no graded cranes" is an error.
 */
export function buildServiceReportContent(cranes: GradedChecklist[]): ServiceReportContent {
  const built = cranes
    .map((crane) => ({
        craneId: crane.craneId,
        assetTag: crane.assetTag,
        type: crane.type,
        paragraphs: Object.entries(readGrades(crane.data))
          .filter(([, entry]) => entry.grade !== null)
          .sort((a, b) => (a[1].grade ?? 9) - (b[1].grade ?? 9))
          .map(([code, entry]) => {
            const component = entry.label ?? code
            return {
              component,
              grade: entry.grade,
              comment: entry.comment,
              text: serviceReportSentence(component, entry.grade, entry.comment),
            }
          }),
      }))
      .filter((crane) => crane.paragraphs.length > 0)
      // Worst crane first, by its worst part — the paragraphs are already sorted, so [0] is it.
      .sort((a, b) => (a.paragraphs[0]!.grade ?? 6) - (b.paragraphs[0]!.grade ?? 6))

  // Nothing graded is a real state on a PM job — no checklist submitted yet, or a job whose cranes
  // have all been removed — and the screen has an empty state for it. The `.min(1)` guard belongs to
  // the stored document, applied by the callers that would write one, not to the read path.
  if (built.length === 0) return { cranes: [] }
  return serviceReportContentSchema.parse({ cranes: built })
}

/** The office's edit: the sentences it may change, and nothing else. */
export const updateServiceReportSchema = z.object({
  content: serviceReportContentSchema,
})

export type UpdateServiceReportInput = z.infer<typeof updateServiceReportSchema>
