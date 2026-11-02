import { z } from 'zod'

/**
 * The office's three decisions about a submitted report (slice 9): approve, return, amend. Each is a
 * sentence the person has to type, because all three are the kind of thing somebody will be asked
 * about a year later.
 */

/**
 * Approval carries no input: the report says everything. The schema exists so the action and the
 * service accept the same empty body and a stray form field cannot be mistaken for a decision.
 */
export const approveReportSchema = z.object({}).strict()

export const returnReportSchema = z.object({
  reason: z.string().trim().min(10, 'Say what has to be fixed — at least a sentence.').max(1000),
})

export const amendReportSchema = z.object({
  reportId: z.string().uuid(),
  reason: z.string().trim().min(10, 'Say why the report is being corrected.').max(1000),
})

export type ReturnReportInput = z.infer<typeof returnReportSchema>
export type AmendReportInput = z.infer<typeof amendReportSchema>
