import type { Metadata } from 'next'
import { CompanySlaForm } from '@/components/office/sla-forms'
import { cardClass } from '@/components/office/ui'
import { getCompanySlaTargets } from '@/server/sla/sla'
import { requireAuth } from '@/server/auth/context'
import { updateCompanySlaAction } from './actions'

export const metadata: Metadata = { title: 'Service levels — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The company-wide SLA targets (brief §4.3; slice 30).
 *
 * Before this screen the four numbers every job fell back to lived in `DEFAULT_SLA_POLICIES`, a code
 * constant, and only the seed could write the rows over them. That made a business target something
 * only a deploy could change. They are contractual, so they are configuration, and configuration has
 * a screen — the same reasoning `/admin/compliance` rests on.
 *
 * Contract overrides are deliberately not editable here: they are one customer's agreed terms and
 * belong with that customer, on its own page.
 */
export default async function SlaPage() {
  const context = await requireAuth()
  const targets = await getCompanySlaTargets(context)
  const missing = targets.filter((target) => target.isFallback).length

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-title font-semibold text-ink">Service levels</h1>
        <p className="mt-1 text-muted">
          The response and resolution minutes every job starts from, per priority. A contract can
          tighten or loosen these for one customer, and its numbers win over the ones here.
        </p>
      </div>

      <section className={cardClass}>
        <h2 className="font-semibold text-ink">Company-wide targets</h2>
        <p className="mt-1 mb-5 text-sm text-muted">
          {missing > 0
            ? `${missing} of ${targets.length} ${missing === 1 ? 'priority has' : 'priorities have'} no row yet — the amber note says which number is currently in force instead. Saving writes all four.`
            : 'These rows are what a job with no contract override counts down from.'}
        </p>
        <CompanySlaForm action={updateCompanySlaAction} values={targets} />
      </section>

      {/* Carried from the same rule the seed comment gives: the clock is calendar minutes. */}
      <p className="rounded-lg border border-line bg-sheet p-4 text-sm text-ink">
        The clock runs in calendar minutes, day and night, with no working-hours calendar applied. A
        target is therefore harder to meet than one that paused overnight, which is the safe direction
        to be wrong in. Changing a number here does not change any job already raised: each job
        snapshots its deadline when it is created.
      </p>
    </div>
  )
}
