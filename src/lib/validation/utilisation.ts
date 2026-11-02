import { z } from 'zod'

/**
 * Filters for the utilisation report (brief §11, slice 33).
 *
 * The same `YYYY-MM-DD` wall-date pair the profitability report reads, in the operating timezone.
 * Empty means **the last 30 days**, not "all time": hours worked two years ago are a different
 * question, and a screen that opens on the whole ledger answers nothing about this month.
 */
export const utilisationFilterSchema = z.object({
  from: z.string().trim().max(10).optional().default(''),
  to: z.string().trim().max(10).optional().default(''),
})

export type UtilisationFilter = z.infer<typeof utilisationFilterSchema>
