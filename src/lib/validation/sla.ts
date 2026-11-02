import { z } from 'zod'
import { PRIORITIES } from './tickets'

/**
 * The company-wide SLA targets (brief §4.3; Phase 4, slice 30).
 *
 * These are the response and resolution minutes every job falls back to when its contract names no
 * override for that priority — the `SlaPolicy` rows still carrying `contractId: null`. Until this
 * slice only the seed could write them, which made `DEFAULT_SLA_POLICIES` the real policy: a code
 * constant nobody at the office could change. The constant stays as the seed's starting point and as
 * `resolveSlaTargets`'s last-resort fallback, not as the number the business runs on.
 */

const minutes = z.coerce
  .number({ invalid_type_error: 'Enter a number of minutes.' })
  .int('Use whole minutes.')
  .min(1, 'A target must be at least a minute.')
  .max(60 * 24 * 365, 'That is more than a year.')

/** Written out rather than built from `PRIORITIES`, so the service gets a real type, not an index. */
const targetFields = {
  responseP1: minutes,
  resolutionP1: minutes,
  responseP2: minutes,
  resolutionP2: minutes,
  responseP3: minutes,
  resolutionP3: minutes,
  responseP4: minutes,
  resolutionP4: minutes,
}

export type CompanySlaInput = z.infer<z.ZodObject<typeof targetFields>>

export const companySlaSchema = z.object(targetFields).superRefine((input, ctx) => {
  for (const priority of PRIORITIES) {
    const response = input[`response${priority}`]
    const resolution = input[`resolution${priority}`]
    if (resolution < response) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [`resolution${priority}`],
        message: 'Resolution cannot be quicker than the response.',
      })
    }
  }
})

export type CompanyTarget = {
  priority: (typeof PRIORITIES)[number]
  responseMinutes: number
  resolutionMinutes: number
}

/** The form's flat fields as one target per priority, which is the shape the service writes. */
export function companyTargetsFrom(input: CompanySlaInput): CompanyTarget[] {
  return PRIORITIES.map((priority) => ({
    priority,
    responseMinutes: input[`response${priority}`],
    resolutionMinutes: input[`resolution${priority}`],
  }))
}
