'use client'

import { useActionState, useState } from 'react'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import { FieldError, FormMessage, buttonClass, inputClass, labelClass, secondaryButtonClass } from './ui'

/**
 * Quote forms (slice 19).
 *
 * The line editor is the same on the job page (raise) and the quote page (edit a draft). Rows post
 * the same four field names in render order, which is the assumption `lineBody` in the action makes.
 * A row with no description is dropped by the action, so the empty row left at the bottom is harmless.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

export interface QuotableFinding {
  id: string
  component: string
  description: string
  recommendation: string | null
}

interface LineDraft {
  key: number
  description: string
  quantity: string
  unitPrice: string
  isVariation: boolean
}

let nextKey = 0
function blankLine(): LineDraft {
  nextKey += 1
  return { key: nextKey, description: '', quantity: '1', unitPrice: '', isVariation: false }
}

export function QuoteForm({
  action,
  findings = [],
  initialLines,
  validUntil = '',
  notes = '',
  submitLabel = 'Raise the quote',
}: {
  action: ServerAction
  /** Open findings on the job, offered as prefilled lines. Only the create form passes these. */
  findings?: QuotableFinding[]
  initialLines?: Array<{
    description: string
    quantity: number
    unitPrice: number
    isVariation: boolean
  }>
  validUntil?: string
  notes?: string
  submitLabel?: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const [lines, setLines] = useState<LineDraft[]>(() => {
    const seeded = (initialLines ?? []).map((line) => {
      nextKey += 1
      return {
        key: nextKey,
        description: line.description,
        quantity: String(line.quantity),
        unitPrice: line.unitPrice.toFixed(2),
        isVariation: line.isVariation,
      }
    })
    return seeded.length > 0 ? seeded : [blankLine()]
  })

  const update = (key: number, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  const addFinding = (finding: QuotableFinding) =>
    setLines((current) => [
      ...current,
      {
        key: (nextKey += 1),
        description: `${finding.component} — ${finding.recommendation ?? finding.description}`,
        quantity: '1',
        unitPrice: '',
        isVariation: false,
      },
    ])

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      {findings.length > 0 ? (
        <div className="rounded-md border border-warn/40 bg-warn/10 p-3">
          <p className="text-sm font-medium text-warn">Open findings on this job</p>
          <p className="mt-1 text-xs text-warn">
            Add one to prefill a line, then put a price on it. Quoting a finding does not change its
            status — the finding form records that it has been quoted.
          </p>
          <ul className="mt-2 space-y-1">
            {findings.map((finding) => (
              <li key={finding.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-warn">
                  <span className="font-medium">{finding.component}</span> —{' '}
                  {finding.recommendation ?? finding.description}
                </span>
                <button
                  type="button"
                  onClick={() => addFinding(finding)}
                  className="text-sm text-warn underline hover:text-ink"
                >
                  Add to quote
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-3">
        {lines.map((line) => (
          <div key={line.key} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-12">
            <div className="sm:col-span-6">
              <label className={labelClass} htmlFor={`description-${line.key}`}>
                Description
              </label>
              <input
                id={`description-${line.key}`}
                name="description"
                value={line.description}
                onChange={(event) => update(line.key, { description: event.target.value })}
                maxLength={500}
                placeholder="e.g. Replace hoist brake pads"
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor={`quantity-${line.key}`}>
                Qty
              </label>
              <input
                id={`quantity-${line.key}`}
                name="quantity"
                type="number"
                step="0.001"
                min="0.001"
                value={line.quantity}
                onChange={(event) => update(line.key, { quantity: event.target.value })}
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor={`price-${line.key}`}>
                Unit price
              </label>
              <input
                id={`price-${line.key}`}
                name="unitPrice"
                type="number"
                step="0.01"
                min="0"
                value={line.unitPrice}
                onChange={(event) => update(line.key, { unitPrice: event.target.value })}
                placeholder="0.00"
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor={`variation-${line.key}`}>
                Kind
              </label>
              <select
                id={`variation-${line.key}`}
                name="isVariation"
                value={line.isVariation ? 'yes' : 'no'}
                onChange={(event) => update(line.key, { isVariation: event.target.value === 'yes' })}
                className={inputClass}
              >
                <option value="no">Quoted work</option>
                <option value="yes">Variation</option>
              </select>
            </div>

            {lines.length > 1 ? (
              <div className="sm:col-span-12">
                <button
                  type="button"
                  onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}
                  className="text-sm text-muted underline hover:text-ink"
                >
                  Remove this line
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <FieldError state={state} name="lines" />

      <button
        type="button"
        onClick={() => setLines((current) => [...current, blankLine()])}
        className={secondaryButtonClass}
      >
        Add a line
      </button>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="validUntil">
            Valid until (optional)
          </label>
          <input
            id="validUntil"
            name="validUntil"
            type="date"
            defaultValue={validUntil}
            className={inputClass}
          />
          <FieldError state={state} name="validUntil" />
        </div>
        <div>
          <label className={labelClass} htmlFor="notes">
            Notes (optional)
          </label>
          <textarea
            id="notes"
            name="notes"
            defaultValue={notes}
            maxLength={2000}
            rows={3}
            className={inputClass}
          />
          <FieldError state={state} name="notes" />
        </div>
      </div>

      <p className="text-xs text-muted">
        GST is added at the rate in Settings when the quote is saved. A draft can be edited; once it
        is sent, the lines are the numbers the customer was offered.
      </p>

      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

/** One decision on a quote: send it, or record the customer's yes or no. */
export function QuoteDecisionForm({
  action,
  status,
  label,
  withNote = false,
  primary = false,
}: {
  action: ServerAction
  status: 'SENT' | 'ACCEPTED' | 'DECLINED'
  label: string
  withNote?: boolean
  primary?: boolean
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-2">
      <FormMessage state={state} />
      <input type="hidden" name="status" value={status} />
      {withNote ? (
        <div>
          <label className={labelClass} htmlFor={`note-${status}`}>
            Note (optional)
          </label>
          <input
            id={`note-${status}`}
            name="note"
            maxLength={500}
            placeholder="e.g. Accepted by phone by the site manager"
            className={inputClass}
          />
          <FieldError state={state} name="note" />
        </div>
      ) : null}
      <button type="submit" className={primary ? buttonClass : secondaryButtonClass} disabled={pending}>
        {pending ? 'Saving…' : label}
      </button>
    </form>
  )
}
