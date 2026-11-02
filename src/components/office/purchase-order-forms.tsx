'use client'

import { useActionState } from 'react'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import { formatMoney } from '@/lib/format'
import { FormMessage, buttonClass, inputClass, labelClass } from './ui'

/**
 * The reorder screen's two forms (slice 25).
 *
 * Raising is one form per supplier group: every short part is offered with its suggested quantity, and
 * blanking a quantity leaves that part off the order. Receiving is one form per purchase order: the
 * quantities default to what is still owed, so a delivery that arrived whole is one click.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

export interface RaiseLine {
  partId: string
  partNumber: string
  description: string
  uom: string
  onHand: number
  reorderLevel: number | null
  suggestedQuantity: number
  cost: number
}

export function RaisePurchaseOrderForm({
  action,
  supplierName,
  lines,
  currency,
}: {
  action: ServerAction
  supplierName: string
  lines: RaiseLine[]
  currency: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <FormMessage state={state} />

      <div className="overflow-x-auto rounded-lg bg-field">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Parts to order from {supplierName}</caption>
          <thead className="border-b border-line bg-sheet text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Part</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">On hand</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Reorder at</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Cost each</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {lines.map((line) => (
              <tr key={line.partId} className="align-top">
                <td className="px-4 py-3">
                  <span className="font-mono text-sm font-medium text-ink">
                    {line.partNumber}
                  </span>
                  <span className="block text-ink">{line.description}</span>
                </td>
                <td className="px-4 py-3 text-right text-warn">
                  {line.onHand} {line.uom}
                </td>
                <td className="px-4 py-3 text-right text-muted">
                  {line.reorderLevel === null ? '—' : `${line.reorderLevel} ${line.uom}`}
                </td>
                <td className="px-4 py-3 text-right text-ink">
                  {formatMoney(line.cost, currency)}
                </td>
                <td className="px-4 py-3 text-right">
                  <input type="hidden" name="partId" value={line.partId} />
                  <div className="flex items-center justify-end gap-2">
                    <input
                      type="number"
                      name="quantity"
                      step="0.001"
                      min="0"
                      defaultValue={line.suggestedQuantity}
                      aria-label={`Quantity of ${line.partNumber} to order`}
                      className={`${inputClass} mt-0 w-28 text-right`}
                    />
                    <span className="text-xs text-muted">{line.uom}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Blank a quantity to leave that part off the order. Cost is the catalogue&rsquo;s, copied onto the
        order as it stands today.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`expected-${lines[0]?.partId ?? 'none'}`} className={labelClass}>
            Expected
          </label>
          <input
            id={`expected-${lines[0]?.partId ?? 'none'}`}
            name="expectedAt"
            type="date"
            className={inputClass}
          />
        </div>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Raising…' : 'Raise purchase order'}
        </button>
      </div>
    </form>
  )
}

export interface ReceiveLine {
  id: string
  partNumber: string | null
  description: string
  uom: string | null
  quantity: number
  receivedQuantity: number
  remaining: number
}

export function ReceivePurchaseOrderForm({
  action,
  number,
  lines,
  locations,
}: {
  action: ServerAction
  number: string
  lines: ReceiveLine[]
  locations: Array<{ id: string; name: string }>
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <FormMessage state={state} />

      <div className="overflow-x-auto rounded-lg bg-field">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Lines on {number}</caption>
          <thead className="border-b border-line bg-sheet text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Part</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">On order</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Received</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Arrived now</th>
              <th scope="col" className="px-4 py-3 font-medium">Serial or batch</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {lines.map((line) => (
              <tr key={line.id} className="align-top">
                <td className="px-4 py-3">
                  <span className="font-mono text-sm font-medium text-ink">
                    {line.partNumber ?? '—'}
                  </span>
                  <span className="block text-ink">{line.description}</span>
                </td>
                <td className="px-4 py-3 text-right text-muted">
                  {line.quantity} {line.uom ?? ''}
                </td>
                <td className="px-4 py-3 text-right text-muted">{line.receivedQuantity}</td>
                <td className="px-4 py-3 text-right">
                  <input type="hidden" name="lineId" value={line.id} />
                  <input
                    type="number"
                    name="received"
                    step="0.001"
                    min="0"
                    max={line.remaining}
                    defaultValue={line.remaining}
                    aria-label={`Quantity of ${line.partNumber ?? line.description} that arrived`}
                    className={`${inputClass} mt-0 w-24 text-right`}
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    name="serialOrBatch"
                    maxLength={120}
                    aria-label={`Serial or batch for ${line.partNumber ?? line.description}`}
                    className={`${inputClass} mt-0`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`receive-location-${number}`} className={labelClass}>
            Received into
          </label>
          <select
            id={`receive-location-${number}`}
            name="locationId"
            defaultValue=""
            className={inputClass}
          >
            <option value="">Main store</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Posting…' : `Post receipt against ${number}`}
        </button>
      </div>
    </form>
  )
}
