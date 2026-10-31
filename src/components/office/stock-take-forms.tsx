'use client'

import { useActionState } from 'react'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import { LOCATION_TYPE_LABELS, type LocationTypeName } from '@/lib/validation/locations'
import { STOCK_TAKE_REASON_CODES } from '@/lib/validation/stock-takes'
import { FieldError, FormMessage, buttonClass, inputClass, labelClass, secondaryButtonClass } from './ui'

/**
 * The stock take's forms (slice 26).
 *
 * Opening is one session over one location. Counting is one row per line, prefilled with what the
 * books say unless the session is blind — a blind count is the point of the exercise, so the system
 * quantity is rendered nowhere on the form the counter holds.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

export interface CountLine {
  id: string
  partNumber: string
  description: string
  uom: string
  systemQty: number
  countedQty: number | null
  variance: number | null
  reasonCode: string | null
}

export function StockTakeForm({
  action,
  locations,
}: {
  action: ServerAction
  locations: Array<{ id: string; name: string; type: string }>
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="take-location" className={labelClass}>
            Location to count
          </label>
          <select id="take-location" name="scopeLocationId" required defaultValue="" className={inputClass}>
            <option value="">Choose a location</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} · {LOCATION_TYPE_LABELS[location.type as LocationTypeName] ?? location.type}
              </option>
            ))}
          </select>
          <FieldError state={state} name="scopeLocationId" />
        </div>

        <div>
          <label htmlFor="take-category" className={labelClass}>
            Part numbers starting with
          </label>
          <input
            id="take-category"
            name="scopeCategory"
            maxLength={80}
            placeholder="Optional — e.g. WR-"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted">
            Leave empty to count everything at that location.
          </p>
          <FieldError state={state} name="scopeCategory" />
        </div>
      </div>

      <div className="flex items-start gap-2">
        <input
          id="take-blind"
          name="blindCount"
          type="checkbox"
          defaultChecked
          className="mt-1 size-4 rounded border-line"
        />
        <label htmlFor="take-blind" className="text-sm text-ink">
          Blind count
          <span className="block text-xs text-muted">
            The counter is not shown what the books say. An honest count is worth more than a matching
            one.
          </span>
        </label>
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Opening…' : 'Open the count'}
      </button>
    </form>
  )
}

/**
 * One row per line in scope: the part, the counted field, and — when the session is not blind — what
 * the system said at the moment it opened, so the variance is visible as it is typed.
 */
export function CountForm({
  action,
  lines,
  blind,
}: {
  action: ServerAction
  lines: CountLine[]
  blind: boolean
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="overflow-x-auto rounded-lg bg-field">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Lines to count</caption>
          <thead className="border-b border-line bg-sheet text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Part</th>
              {blind ? null : (
                <>
                  <th scope="col" className="px-4 py-3 text-right font-medium">System</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Variance</th>
                </>
              )}
              <th scope="col" className="px-4 py-3 text-right font-medium">Counted</th>
              <th scope="col" className="px-4 py-3 font-medium">Reason if it differs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {lines.map((line) => (
              <tr key={line.id} className="align-top">
                <td className="px-4 py-3">
                  <span className="font-mono text-sm font-medium text-ink">{line.partNumber}</span>
                  <span className="block text-ink">{line.description}</span>
                  <input type="hidden" name="lineId" value={line.id} />
                </td>
                {blind ? null : (
                  <>
                    <td className="px-4 py-3 text-right text-muted">
                      {line.systemQty} {line.uom}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={
                          line.variance === null || line.variance === 0
                            ? 'text-muted'
                            : 'font-medium text-warn'
                        }
                      >
                        {line.variance === null
                          ? '—'
                          : line.variance > 0
                            ? `+${line.variance}`
                            : line.variance}
                      </span>
                    </td>
                  </>
                )}
                <td className="px-4 py-3 text-right">
                  <input
                    type="number"
                    name="counted"
                    step="0.001"
                    min="0"
                    defaultValue={line.countedQty ?? ''}
                    aria-label={`Counted quantity of ${line.partNumber}`}
                    className={`${inputClass} mt-0 w-28 text-right`}
                  />
                </td>
                <td className="px-4 py-3">
                  <select
                    name="reasonCode"
                    defaultValue={line.reasonCode ?? ''}
                    aria-label={`Reason for the ${line.partNumber} difference`}
                    className={`${inputClass} mt-0`}
                  >
                    <option value="">—</option>
                    {STOCK_TAKE_REASON_CODES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        A blank leaves the line uncounted, which is not the same as a zero. Every line must be counted
        before the session can be approved.
      </p>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : 'Save counts'}
      </button>
    </form>
  )
}

/** Approving posts one correction per differing line; cancelling drops the session and posts nothing. */
export function ApproveStockTakeForm({
  approveAction,
  cancelAction,
  reference,
  varianceLines,
}: {
  approveAction: ServerAction
  cancelAction: ServerAction
  reference: string
  varianceLines: number
}) {
  const [state, formAction, pending] = useActionState(approveAction, IDLE_FORM)
  const [cancelState, cancelFormAction, cancelling] = useActionState(cancelAction, IDLE_FORM)

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <FormMessage state={state} />
        <p className="text-sm text-muted">
          Approving posts {varianceLines === 0 ? 'nothing — every line matches' : `${varianceLines} correction${varianceLines === 1 ? '' : 's'}`}{' '}
          through the stock ledger, each carrying this count&rsquo;s reference.
        </p>
        <div className="max-w-md">
          <label htmlFor="approve-reason" className={labelClass}>
            Reason for the difference
          </label>
          <input
            id="approve-reason"
            name="reasonCode"
            maxLength={80}
            placeholder="Stock count — annual"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted">
            Required when any line has less than the books said. A line with its own reason keeps it.
          </p>
          <FieldError state={state} name="reasonCode" />
        </div>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Approving…' : `Approve ${reference}`}
        </button>
      </form>

      <form action={cancelFormAction}>
        <FormMessage state={cancelState} />
        <button type="submit" disabled={cancelling} className={secondaryButtonClass}>
          {cancelling ? 'Cancelling…' : 'Cancel this count'}
        </button>
      </form>
    </div>
  )
}
