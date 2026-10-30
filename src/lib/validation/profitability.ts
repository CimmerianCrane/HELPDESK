import { z } from 'zod'

/**
 * Filters for the profitability report (brief §11, slice 32).
 *
 * A `YYYY-MM-DD` pair read as wall dates in the operating timezone, the same contract the job list's
 * `from`/`to` use. Empty means "no bound", so an unfiltered screen is the whole ledger — which is the
 * honest default for a report nobody has narrowed yet.
 */
export const profitabilityFilterSchema = z.object({
  from: z.string().trim().max(10).optional().default(''),
  to: z.string().trim().max(10).optional().default(''),
})

export type ProfitabilityFilter = z.infer<typeof profitabilityFilterSchema>
