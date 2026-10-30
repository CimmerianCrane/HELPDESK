'use client'

import { useActionState } from 'react'
import type { Priority } from '@prisma/client'
import { PRIORITY_DESCRIPTIONS, PRIORITY_LABELS } from '@/server/tickets/labels'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import { FieldError, FormMessage, buttonClass, inputClass, labelClass } from './ui'

/**
 * The company-wide SLA targets (slice 30). One form for all four priorities, because the numbers
 * only make sense beside each other: P1 has to be tighter than P2, and an administrator setting them
 * one at a time cannot see that.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

export interface CompanySlaFormValues {
  priority: Priority
  responseMinutes: number
  resolutionMinutes: number
  isFallback: boolean
}

export function CompanySlaForm({
  action,
  values,
}: {
  action: ServerAction
  values: CompanySlaFormValues[]
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />
      <FieldError state={state} name="_form" />

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Company-wide response and resolution targets</caption>
          <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th scope="col" className="px-2 py-2 font-medium">Priority</th>
              <th scope="col" className="px-2 py-2 font-medium">
                Response (minutes)
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Resolution (minutes)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {values.map((value) => (
              <tr key={value.priority} className="align-top">
                <td className="px-2 py-3">
                  <span className="font-medium text-slate-900">{PRIORITY_LABELS[value.priority]}</span>
                  <span className="block text-xs text-slate-500">
                    {PRIORITY_DESCRIPTIONS[value.priority]}
                  </span>
                  {value.isFallback ? (
                    <span className="mt-1 block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                      Nothing configured — the built-in default is in force
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-3">
                  <label htmlFor={`response-${value.priority}`} className="sr-only">
                    {value.priority} response minutes
                  </label>
                  <input
                    id={`response-${value.priority}`}
                    name={`response${value.priority}`}
                    type="number"
                    step="1"
                    min="1"
                    required
                    defaultValue={value.responseMinutes}
                    className={inputClass}
                  />
                  <FieldError state={state} name={`response${value.priority}`} />
                </td>
                <td className="px-2 py-3">
                  <label htmlFor={`resolution-${value.priority}`} className="sr-only">
                    {value.priority} resolution minutes
                  </label>
                  <input
                    id={`resolution-${value.priority}`}
                    name={`resolution${value.priority}`}
                    type="number"
                    step="1"
                    min="1"
                    required
                    defaultValue={value.resolutionMinutes}
                    className={inputClass}
                  />
                  <FieldError state={state} name={`resolution${value.priority}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={labelClass}>
        A job snapshots these at the moment it is raised, so changing one never rewrites a job that
        already has a deadline. Contracts may override them per customer — that is done on the
        customer page.
      </p>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : 'Save targets'}
      </button>
    </form>
  )
}
