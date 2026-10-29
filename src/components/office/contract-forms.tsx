'use client'

import { useActionState } from 'react'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import { PRIORITIES } from '@/lib/validation/tickets'
import {
  CONTRACT_TYPES,
  CONTRACT_TYPE_LABELS,
  type ContractPriority,
} from '@/lib/validation/contracts'
import { FieldError, FormMessage, buttonClass, inputClass, labelClass } from './ui'

/**
 * One contract on the customer page (slice 29). Adds and edits: `values` is null when adding.
 *
 * The four priority rows are the contract's SLA numbers. Blank means "follow the company-wide target
 * for that priority", so the form never shows a number the contract has not actually agreed to.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

export interface ContractFormValues {
  id: string
  type: string
  reference: string | null
  startDate: Date | null
  endDate: Date | null
  renewalDate: Date | null
  includedVisits: number | null
  scopeNotes: string | null
  coveredCranes: Array<{ id: string; assetTag: string }>
  targets: Partial<Record<ContractPriority, { responseMinutes: number; resolutionMinutes: number }>>
}

function toDayInput(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : ''
}

export function ContractForm({
  action,
  values,
  cranes,
  submitLabel,
  idPrefix,
}: {
  action: ServerAction
  values: ContractFormValues | null
  cranes: Array<{ id: string; assetTag: string }>
  submitLabel: string
  idPrefix: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const id = (name: string) => `${idPrefix}-${name}`
  const covered = new Set(values?.coveredCranes.map((crane) => crane.id) ?? [])

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />
      <FieldError state={state} name="_form" />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={id('type')} className={labelClass}>
            Kind of contract
          </label>
          <select
            id={id('type')}
            name="type"
            defaultValue={values?.type ?? 'AMC'}
            className={inputClass}
          >
            {CONTRACT_TYPES.map((type) => (
              <option key={type} value={type}>
                {CONTRACT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <FieldError state={state} name="type" />
        </div>

        <div>
          <label htmlFor={id('reference')} className={labelClass}>
            Reference <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            id={id('reference')}
            name="reference"
            maxLength={80}
            defaultValue={values?.reference ?? ''}
            placeholder="Customer PO or agreement number"
            className={inputClass}
          />
          <FieldError state={state} name="reference" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={id('startDate')} className={labelClass}>
            Starts
          </label>
          <input
            id={id('startDate')}
            name="startDate"
            type="date"
            defaultValue={toDayInput(values?.startDate ?? null)}
            className={inputClass}
          />
          <FieldError state={state} name="startDate" />
        </div>

        <div>
          <label htmlFor={id('endDate')} className={labelClass}>
            Ends <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            id={id('endDate')}
            name="endDate"
            type="date"
            defaultValue={toDayInput(values?.endDate ?? null)}
            className={inputClass}
          />
          <FieldError state={state} name="endDate" />
        </div>

        <div>
          <label htmlFor={id('renewalDate')} className={labelClass}>
            Renewal date <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            id={id('renewalDate')}
            name="renewalDate"
            type="date"
            defaultValue={toDayInput(values?.renewalDate ?? null)}
            className={inputClass}
          />
          <FieldError state={state} name="renewalDate" />
        </div>
      </div>

      <div>
        <label htmlFor={id('includedVisits')} className={labelClass}>
          Included visits <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <input
          id={id('includedVisits')}
          name="includedVisits"
          type="number"
          step="1"
          min="0"
          max="1000"
          defaultValue={values?.includedVisits ?? ''}
          className={inputClass}
        />
        <FieldError state={state} name="includedVisits" />
      </div>

      <fieldset>
        <legend className={labelClass}>Cranes it covers</legend>
        <p className="mt-1 text-xs text-slate-500">
          Tick nothing and the contract covers the whole customer, which is what an AMC usually does.
        </p>
        {cranes.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            This customer has no cranes yet, so the contract covers the account.
          </p>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {cranes.map((crane) => (
              <label key={crane.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="coveredCraneIds"
                  value={crane.id}
                  defaultChecked={covered.has(crane.id)}
                  className="size-4 rounded border-slate-300"
                />
                {crane.assetTag}
              </label>
            ))}
          </div>
        )}
        <FieldError state={state} name="coveredCraneIds" />
      </fieldset>

      <fieldset>
        <legend className={labelClass}>Response and resolution targets</legend>
        <p className="mt-1 text-xs text-slate-500">
          Leave a priority blank to use the company-wide target. A new job snapshots whatever is here
          at the moment it is raised, so a later change never rewrites history.
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1 pr-3 font-medium">Priority</th>
                <th className="py-1 pr-3 font-medium">Response (minutes)</th>
                <th className="py-1 font-medium">Resolution (minutes)</th>
              </tr>
            </thead>
            <tbody>
              {PRIORITIES.map((priority) => {
                const target = values?.targets[priority]
                return (
                  <tr key={priority}>
                    <td className="py-1 pr-3 font-medium text-slate-800">{priority}</td>
                    <td className="py-1 pr-3">
                      <input
                        aria-label={`${priority} response minutes`}
                        name={`sla${priority}Response`}
                        type="number"
                        step="1"
                        min="1"
                        defaultValue={target?.responseMinutes ?? ''}
                        className={inputClass}
                      />
                    </td>
                    <td className="py-1">
                      <input
                        aria-label={`${priority} resolution minutes`}
                        name={`sla${priority}Resolution`}
                        type="number"
                        step="1"
                        min="1"
                        defaultValue={target?.resolutionMinutes ?? ''}
                        className={inputClass}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {PRIORITIES.map((priority) => (
          <div key={priority}>
            <FieldError state={state} name={`sla${priority}Response`} />
            <FieldError state={state} name={`sla${priority}Resolution`} />
          </div>
        ))}
      </fieldset>

      <div>
        <label htmlFor={id('scopeNotes')} className={labelClass}>
          Scope notes <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <textarea
          id={id('scopeNotes')}
          name="scopeNotes"
          rows={3}
          maxLength={4000}
          defaultValue={values?.scopeNotes ?? ''}
          className={inputClass}
        />
        <FieldError state={state} name="scopeNotes" />
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

/** Retiring a contract leaves every job raised under it pointing at a record that still exists. */
export function RetireContractButton({
  action,
  label,
}: {
  action: ServerAction
  label: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`Retire ${label}? Jobs already raised under it keep it.`)) {
          event.preventDefault()
        }
      }}
      className="inline"
    >
      <FormMessage state={state} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-medium text-red-700 underline hover:text-red-900 disabled:opacity-60"
      >
        {pending ? 'Retiring…' : 'Retire'}
      </button>
    </form>
  )
}
