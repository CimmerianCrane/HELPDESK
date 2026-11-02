'use client'

import { useActionState } from 'react'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import {
  LOCATION_TYPES,
  LOCATION_TYPE_LABELS,
  type LocationTypeName,
} from '@/lib/validation/locations'
import { MOVEMENT_TYPE_LABELS, STOCK_ENTRY_TYPES } from '@/lib/validation/parts'
import { FieldError, FormMessage, buttonClass, inputClass, labelClass } from './ui'

/**
 * The parts book's forms (slice 22).
 *
 * One component adds a part and edits one — the fields are the same, and a second component would be
 * a second place the catalogue's shape is spelled out. `values` is null when adding.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

export interface PartFormValues {
  id: string
  partNumber: string
  description: string
  brand: string | null
  compatibleModels: string[]
  uom: string
  cost: number
  sellPrice: number
  reorderLevel: number | null
  reorderQty: number | null
  trackSerialOrBatch: boolean
  preferredSupplierId: string | null
}

export interface LocationFormValues {
  id: string
  name: string
  type: LocationTypeName
  parentId: string | null
  isActive: boolean
}

export function PartForm({
  action,
  values,
  suppliers = [],
  submitLabel,
}: {
  action: ServerAction
  values: PartFormValues | null
  /** Who the reorder screen groups it under. Empty for a role that cannot read the supplier book. */
  suppliers?: Array<{ id: string; name: string }>
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const id = values?.id ?? 'new'

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-partNumber`} className={labelClass}>
            Part number
          </label>
          <input
            id={`${id}-partNumber`}
            name="partNumber"
            required
            maxLength={80}
            defaultValue={values?.partNumber ?? ''}
            placeholder="WR-13-6X36"
            className={inputClass}
          />
          <FieldError state={state} name="partNumber" />
        </div>

        <div>
          <label htmlFor={`${id}-uom`} className={labelClass}>
            Unit of measure
          </label>
          <input
            id={`${id}-uom`}
            name="uom"
            required
            maxLength={20}
            defaultValue={values?.uom ?? ''}
            placeholder="m, pc, pair, kg"
            className={inputClass}
          />
          <FieldError state={state} name="uom" />
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-description`} className={labelClass}>
          Description
        </label>
        <input
          id={`${id}-description`}
          name="description"
          required
          maxLength={300}
          defaultValue={values?.description ?? ''}
          className={inputClass}
        />
        <FieldError state={state} name="description" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-brand`} className={labelClass}>
            Brand
          </label>
          <input
            id={`${id}-brand`}
            name="brand"
            maxLength={80}
            defaultValue={values?.brand ?? ''}
            className={inputClass}
          />
          <FieldError state={state} name="brand" />
        </div>

        <div>
          <label htmlFor={`${id}-models`} className={labelClass}>
            Fits (comma-separated models)
          </label>
          <input
            id={`${id}-models`}
            name="compatibleModels"
            maxLength={500}
            defaultValue={values?.compatibleModels.join(', ') ?? ''}
            className={inputClass}
          />
          <FieldError state={state} name="compatibleModels" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-cost`} className={labelClass}>
            Cost
          </label>
          <input
            id={`${id}-cost`}
            name="cost"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={values?.cost ?? ''}
            className={inputClass}
          />
          <FieldError state={state} name="cost" />
        </div>

        <div>
          <label htmlFor={`${id}-sellPrice`} className={labelClass}>
            Sell price
          </label>
          <input
            id={`${id}-sellPrice`}
            name="sellPrice"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={values?.sellPrice ?? ''}
            className={inputClass}
          />
          <FieldError state={state} name="sellPrice" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-reorderLevel`} className={labelClass}>
            Reorder level
          </label>
          <input
            id={`${id}-reorderLevel`}
            name="reorderLevel"
            type="number"
            step="0.001"
            min="0"
            defaultValue={values?.reorderLevel ?? ''}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted">
            Warn when on hand drops below this. Leave empty to never warn.
          </p>
          <FieldError state={state} name="reorderLevel" />
        </div>

        <div>
          <label htmlFor={`${id}-reorderQty`} className={labelClass}>
            Reorder quantity
          </label>
          <input
            id={`${id}-reorderQty`}
            name="reorderQty"
            type="number"
            step="0.001"
            min="0"
            defaultValue={values?.reorderQty ?? ''}
            className={inputClass}
          />
          <FieldError state={state} name="reorderQty" />
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-supplier`} className={labelClass}>
          Preferred supplier
        </label>
        <select
          id={`${id}-supplier`}
          name="preferredSupplierId"
          defaultValue={values?.preferredSupplierId ?? ''}
          className={inputClass}
        >
          <option value="">No preferred supplier</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">
          The reorder list groups short parts by this. Without one, the part cannot be ordered.
        </p>
        <FieldError state={state} name="preferredSupplierId" />
      </div>

      <div className="flex items-start gap-2">
        <input
          id={`${id}-track`}
          name="trackSerialOrBatch"
          type="checkbox"
          defaultChecked={values?.trackSerialOrBatch ?? false}
          className="mt-1 size-4 rounded border-line"
        />
        <label htmlFor={`${id}-track`} className="text-sm text-ink">
          Trace by serial or batch
          <span className="block text-xs text-muted">
            Wire rope, hooks, brakes and electrical parts: records which serial went on which crane.
          </span>
        </label>
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

/**
 * The store's receipt, return and count-correction form.
 *
 * One quantity field whatever the type: an `ADJUST` reads it as the **counted** quantity, the others
 * as what arrived. The hint under the select changes with it, because a form that means something
 * different depending on a dropdown has to say which meaning it is on.
 */
export function StockEntryForm({
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
          <label htmlFor="stock-type" className={labelClass}>
            Movement
          </label>
          <select id="stock-type" name="type" defaultValue="RECEIVE" className={inputClass}>
            {STOCK_ENTRY_TYPES.map((type) => (
              <option key={type} value={type}>
                {MOVEMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <FieldError state={state} name="type" />
        </div>

        <div>
          <label htmlFor="stock-quantity" className={labelClass}>
            Quantity
          </label>
          <input
            id="stock-quantity"
            name="quantity"
            type="number"
            step="0.001"
            min="0"
            required
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted">
            Accounted quantity for an adjustment; what arrived for the rest.
          </p>
          <FieldError state={state} name="quantity" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="stock-location" className={labelClass}>
            Location
          </label>
          <select id="stock-location" name="locationId" defaultValue="" className={inputClass}>
            <option value="">Main store</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          <FieldError state={state} name="locationId" />
        </div>

        <div>
          <label htmlFor="stock-serial" className={labelClass}>
            Serial or batch
          </label>
          <input id="stock-serial" name="serialOrBatch" maxLength={120} className={inputClass} />
          <FieldError state={state} name="serialOrBatch" />
        </div>
      </div>

      <div>
        <label htmlFor="stock-reason" className={labelClass}>
          Reason
        </label>
        <input
          id="stock-reason"
          name="reasonCode"
          maxLength={80}
          placeholder="Supplier delivery, stock count, damaged in transit…"
          className={inputClass}
        />
        <FieldError state={state} name="reasonCode" />
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Posting…' : 'Post movement'}
      </button>
    </form>
  )
}

/**
 * Moving stock between two locations (slice 23).
 *
 * Both ends are chosen here rather than reusing the stock form: a transfer is the one movement with
 * two locations that both matter, and a form whose meaning changes with a dropdown is the thing this
 * slice was written to stop guessing at.
 */
export function TransferForm({
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
          <label htmlFor="transfer-from" className={labelClass}>
            From
          </label>
          <select id="transfer-from" name="fromLocationId" required defaultValue="" className={inputClass}>
            <option value="">Choose a location</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          <FieldError state={state} name="fromLocationId" />
        </div>

        <div>
          <label htmlFor="transfer-to" className={labelClass}>
            To
          </label>
          <select id="transfer-to" name="toLocationId" required defaultValue="" className={inputClass}>
            <option value="">Choose a location</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          <FieldError state={state} name="toLocationId" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="transfer-quantity" className={labelClass}>
            Quantity
          </label>
          <input
            id="transfer-quantity"
            name="quantity"
            type="number"
            step="0.001"
            min="0"
            required
            className={inputClass}
          />
          <FieldError state={state} name="quantity" />
        </div>

        <div>
          <label htmlFor="transfer-serial" className={labelClass}>
            Serial or batch
          </label>
          <input id="transfer-serial" name="serialOrBatch" maxLength={120} className={inputClass} />
          <FieldError state={state} name="serialOrBatch" />
        </div>
      </div>

      <div>
        <label htmlFor="transfer-reason" className={labelClass}>
          Reason
        </label>
        <input
          id="transfer-reason"
          name="reasonCode"
          maxLength={80}
          placeholder="To the van for tomorrow's jobs…"
          className={inputClass}
        />
        <FieldError state={state} name="reasonCode" />
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Transferring…' : 'Transfer stock'}
      </button>
    </form>
  )
}

/**
 * One location: its name, its kind, and — for a bin — the warehouse it sits in. A retired location
 * stays listed so the movements that name it still read.
 */
export function LocationForm({
  action,
  values,
  warehouses,
  submitLabel,
}: {
  action: ServerAction
  values: LocationFormValues | null
  warehouses: Array<{ id: string; name: string }>
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const id = values?.id ?? 'new'

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-name`} className={labelClass}>
            Name
          </label>
          <input
            id={`${id}-name`}
            name="name"
            required
            maxLength={120}
            defaultValue={values?.name ?? ''}
            placeholder="Main store, Bin B-14, Van 1…"
            className={inputClass}
          />
          <FieldError state={state} name="name" />
        </div>

        <div>
          <label htmlFor={`${id}-type`} className={labelClass}>
            Kind
          </label>
          <select
            id={`${id}-type`}
            name="type"
            defaultValue={values?.type ?? 'WAREHOUSE'}
            className={inputClass}
          >
            {LOCATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {LOCATION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <FieldError state={state} name="type" />
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-parent`} className={labelClass}>
          Inside (bins only)
        </label>
        <select
          id={`${id}-parent`}
          name="parentId"
          defaultValue={values?.parentId ?? ''}
          className={inputClass}
        >
          <option value="">Not inside another location</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}
            </option>
          ))}
        </select>
        <FieldError state={state} name="parentId" />
      </div>

      <div className="flex items-start gap-2">
        <input
          id={`${id}-active`}
          name="isActive"
          type="checkbox"
          defaultChecked={values?.isActive ?? true}
          className="mt-1 size-4 rounded border-line"
        />
        <label htmlFor={`${id}-active`} className="text-sm text-ink">
          Active
          <span className="block text-xs text-muted">
            A retired location still appears on past movements, but no new stock goes there.
          </span>
        </label>
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

