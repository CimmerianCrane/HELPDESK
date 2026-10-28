import type { Metadata } from 'next'
import { ComplianceRuleForm } from '@/components/office/compliance-forms'
import { cardClass } from '@/components/office/ui'
import { formatDate } from '@/lib/format'
import { CRANE_TYPE_LABELS } from '@/lib/cranes/labels'
import { SCHEDULE_TYPE_LABELS } from '@/lib/validation/schedules'
import { requireAuth } from '@/server/auth/context'
import { listComplianceRules } from '@/server/compliance/rules'
import { getSettings } from '@/server/settings/settings'
import { createComplianceRuleAction, updateComplianceRuleAction } from './actions'

export const metadata: Metadata = { title: 'Compliance rules — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

/**
 * The compliance rulebook (brief §7, slice 14).
 *
 * The screen is the whole of the regulatory knowledge in this app: nothing here is hard-coded, and
 * the standing notice above the list says so. A rule is never deleted — ending it (`effectiveTo`, or
 * untick *In force*) leaves the record a schedule can still cite.
 */
export default async function CompliancePage() {
  const context = await requireAuth()
  const [rules, settings] = await Promise.all([listComplianceRules(context), getSettings()])

  const inForce = rules.filter((rule) => rule.inForce).length

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Compliance rules</h1>
        <p className="mt-1 text-slate-600">
          {rules.length} {rules.length === 1 ? 'rule' : 'rules'}, {inForce} in force today. A schedule
          adopts a rule, which is what puts a citation on the crane&rsquo;s obligations.
        </p>
      </div>

      {/* Carried verbatim from `Setting.complianceNotice` (CLAUDE.md rule 2, brief §7.4). */}
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        {settings.complianceNotice}
      </p>

      {rules.length === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="font-medium text-slate-900">No rules configured.</p>
          <p className="mt-1 text-sm text-slate-600">
            Add the first one below. Until a rule exists, a schedule&rsquo;s interval and whether an AE
            is needed are typed by hand on the crane.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Compliance rules</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Applies to</th>
                <th scope="col" className="px-4 py-3 font-medium">Rule</th>
                <th scope="col" className="px-4 py-3 font-medium">Dates</th>
                <th scope="col" className="px-4 py-3 font-medium">State</th>
                <th scope="col" className="px-4 py-3 font-medium">Used by</th>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rules.map((rule) => (
                <tr key={rule.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">
                      {CRANE_TYPE_LABELS[rule.craneType]}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {SCHEDULE_TYPE_LABELS[rule.scheduleType]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-slate-900">
                      {rule.intervalMonths ? `Every ${rule.intervalMonths} months` : 'One-off'}
                      {rule.requiresAE ? ' · AE required' : ''}
                    </span>
                    <span className="mt-1 block text-xs text-slate-600">{rule.sourceReference}</span>
                    <span className="block text-xs text-slate-500">
                      Reviewed {formatDate(rule.reviewedAt, settings.timezone)}
                    </span>
                    {rule.notes ? (
                      <span className="mt-1 block text-xs text-slate-500">{rule.notes}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    From {formatDate(rule.effectiveFrom, settings.timezone)}
                    <span className="block">To {formatDate(rule.effectiveTo, settings.timezone)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        rule.inForce
                          ? 'rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800'
                          : 'rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-600'
                      }
                    >
                      {rule.inForce ? 'In force' : 'Not in force'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {rule.adoptedCount} {rule.adoptedCount === 1 ? 'schedule' : 'schedules'}
                  </td>
                  <td className="px-4 py-3">
                    <details>
                      <summary className="cursor-pointer text-sm text-slate-700 underline">
                        Edit
                      </summary>
                      <div className="mt-3 min-w-72">
                        <ComplianceRuleForm
                          action={updateComplianceRuleAction.bind(null, rule.id)}
                          value={rule}
                          submitLabel="Save rule"
                          idPrefix={`rule-${rule.id}`}
                        />
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Add a rule</h2>
        <p className="mt-1 mb-5 text-sm text-slate-600">
          One rule in force per kind of crane and obligation. To replace a rule, give the old one an
          end date first — keeping both in force leaves the app unable to say which applies.
        </p>
        <ComplianceRuleForm
          action={createComplianceRuleAction}
          submitLabel="Add rule"
          idPrefix="new-rule"
        />
      </section>
    </div>
  )
}
