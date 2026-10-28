'use client'

import { useActionState, useRef, useState } from 'react'
import { SignaturePad } from '@/components/tech/signature-pad'
import { formatDate } from '@/lib/format'
import {
  DELIVERY_CHARGE_TYPES,
  DELIVERY_CHARGE_TYPE_LABELS,
  DELIVERY_STATUS_LABELS,
} from '@/lib/validation/delivery-orders'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import { FieldError, FormMessage, buttonClass, inputClass, labelClass, secondaryButtonClass } from './ui'

/**
 * Delivery orders on a job (slice 18).
 *
 * Three things live here, in the order the paperwork moves: raise a DO from the parts the technician
 * already issued, record who took them (and how much of each), and book the loan kit back. The parts
 * offered for a new DO are the ones not already on one — that list comes from the server, so the
 * form can never invent a part that stock never issued.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

export interface IssuedPart {
  movementId: string
  partNumber: string
  description: string
  quantity: number
  serialOrBatch: string | null
  issuedAt: string
}

export interface DeliveryLine {
  id: string
  partNumber: string | null
  description: string
  quantity: number
  receivedQuantity: number
  returnedQuantity: number
  serialOrBatch: string | null
  condition: string | null
  chargeType: (typeof DELIVERY_CHARGE_TYPES)[number]
  expectedReturnDate: Date | null
  outstanding: boolean
}

export interface DeliveryOrder {
  id: string
  number: string
  status: keyof typeof DELIVERY_STATUS_LABELS
  issuedAt: string | null
  receivedAt: string | null
  receiverName: string | null
  receiverSignatureUrl: string | null
  deliveryAddress: string[]
  lines: DeliveryLine[]
}

/** Raise a DO. Each ticked part posts one row, in the same field names, as `formValues` expects. */
export function CreateDeliveryOrderForm({
  action,
  parts,
  timezone,
}: {
  action: ServerAction
  parts: IssuedPart[]
  timezone: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const [selected, setSelected] = useState<string[]>([])

  if (parts.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        Nothing to deliver yet. A delivery order is raised from the parts a technician issues on the
        job, so it appears here once a report records them.
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <FormMessage state={state} />
      <div className="space-y-2">
        {parts.map((part) => {
          const checked = selected.includes(part.movementId)
          return (
            <div key={part.movementId} className="rounded-md border border-slate-200 p-3">
              <label className="flex items-start gap-3 text-sm text-slate-800">
                <input
                  type="checkbox"
                  name="movementId"
                  value={part.movementId}
                  checked={checked}
                  onChange={() =>
                    setSelected((current) =>
                      checked
                        ? current.filter((id) => id !== part.movementId)
                        : [...current, part.movementId],
                    )
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  <span className="font-medium text-slate-900">{part.partNumber}</span> —{' '}
                  {part.description}
                  <span className="text-slate-500">
                    {' '}
                    · {part.quantity}
                    {part.serialOrBatch ? ` · serial ${part.serialOrBatch}` : ''} · issued{' '}
                    {formatDate(new Date(part.issuedAt), timezone)}
                  </span>
                </span>
              </label>

              {checked ? (
                <div className="mt-3 grid gap-2 pl-7 sm:grid-cols-3">
                  <div>
                    <label className={labelClass} htmlFor={`charge-${part.movementId}`}>
                      Terms
                    </label>
                    <select
                      id={`charge-${part.movementId}`}
                      name="chargeType"
                      defaultValue="CHARGEABLE"
                      className={inputClass}
                    >
                      {DELIVERY_CHARGE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {DELIVERY_CHARGE_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass} htmlFor={`condition-${part.movementId}`}>
                      Condition on issue
                    </label>
                    <input
                      id={`condition-${part.movementId}`}
                      name="condition"
                      maxLength={200}
                      placeholder="e.g. new, sealed"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor={`return-${part.movementId}`}>
                      Expected return
                    </label>
                    <input
                      id={`return-${part.movementId}`}
                      name="expectedReturnDate"
                      type="date"
                      className={inputClass}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <FieldError state={state} name="lines" />
      <p className="text-xs text-slate-500">
        Raised from what was issued, never typed again — so the delivery and the stock ledger cannot
        disagree. An expected return date is only meaningful for loan kit.
      </p>
      <button type="submit" className={buttonClass} disabled={pending || selected.length === 0}>
        {pending ? 'Raising…' : 'Raise the delivery order'}
      </button>
    </form>
  )
}

/**
 * The customer's representative takes the parts, with their signature.
 *
 * The signature uploads straight to storage through the same signed-URL route a phone uses; the
 * action receives only the File id. Each line posts the running total received, defaulting to what
 * was ordered — the common case is "all of it" and the person corrects the short lines.
 */
export function ReceiveDeliveryOrderForm({
  action,
  deliveryOrderId,
  lines,
}: {
  action: ServerAction
  deliveryOrderId: string
  lines: DeliveryLine[]
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const [signature, setSignature] = useState<string | null>(null)
  const [fileId, setFileId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const hidden = useRef<HTMLInputElement>(null)
  const idRef = useRef<string | null>(null)

  async function capture(dataUrl: string | null) {
    setSignature(dataUrl)
    setUploadError(null)
    if (!dataUrl) {
      setFileId(null)
      if (hidden.current) hidden.current.value = ''
      return
    }

    idRef.current ??= crypto.randomUUID()
    try {
      const response = await fetch('/api/files/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: idRef.current,
          deliveryOrderId,
          kind: 'DELIVERY_SIGNATURE',
          filename: `receiver-signature-${idRef.current}.png`,
          mimeType: 'image/png',
          sizeBytes: Math.max(1, Math.round(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4)),
        }),
      })
      const ticket = (await response.json()) as {
        fileId?: string
        uploadUrl?: string
        method?: string
        error?: string
      }
      if (!response.ok || !ticket.uploadUrl) {
        throw new Error(ticket.error ?? 'That signature could not be uploaded.')
      }

      const blob = await (await fetch(dataUrl)).blob()
      const put = await fetch(ticket.uploadUrl, {
        method: ticket.method ?? 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: blob,
      })
      if (!put.ok) throw new Error('The signature reached the server but was not stored.')

      setFileId(ticket.fileId ?? idRef.current)
      if (hidden.current) hidden.current.value = ticket.fileId ?? idRef.current
    } catch (error) {
      setFileId(null)
      if (hidden.current) hidden.current.value = ''
      setUploadError(error instanceof Error ? error.message : 'That signature could not be uploaded.')
    }
  }

  return (
    <form action={formAction} className="mt-3 space-y-3 rounded border border-slate-200 bg-slate-50 p-3">
      <FormMessage state={state} />
      <div>
        <label className={labelClass} htmlFor={`receiver-${deliveryOrderId}`}>
          Received by
        </label>
        <input
          id={`receiver-${deliveryOrderId}`}
          name="receiverName"
          required
          maxLength={200}
          className={inputClass}
        />
        <FieldError state={state} name="receiverName" />
      </div>

      <div className="space-y-2">
        {lines.map((line) => (
          <div key={line.id} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="lineId" value={line.id} />
            <span className="flex-1 text-sm text-slate-800">
              {line.description}
              <span className="text-slate-500"> · {line.quantity} ordered</span>
            </span>
            <div className="w-28">
              <label className={labelClass} htmlFor={`received-${line.id}`}>
                Received
              </label>
              <input
                id={`received-${line.id}`}
                name="received"
                type="number"
                step="any"
                min={0}
                max={line.quantity}
                defaultValue={line.quantity}
                className={inputClass}
              />
            </div>
          </div>
        ))}
      </div>

      <SignaturePad label="Receiver signature" value={signature} onChange={(value) => void capture(value)} />
      <input ref={hidden} type="hidden" name="signatureFileId" />
      <FieldError state={state} name="signatureFileId" />
      {uploadError ? (
        <p role="alert" className="text-sm text-red-700">
          {uploadError}
        </p>
      ) : null}

      <button type="submit" className={buttonClass} disabled={pending || !fileId}>
        {pending ? 'Recording…' : 'Record the receipt'}
      </button>
    </form>
  )
}

/** Loan kit coming back. Only loan lines are shown — there is nothing to return on the others. */
export function ReturnDeliveryOrderForm({
  action,
  deliveryOrderId,
  lines,
}: {
  action: ServerAction
  deliveryOrderId: string
  lines: DeliveryLine[]
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const loans = lines.filter((line) => line.chargeType === 'LOAN')

  if (loans.length === 0) return null

  return (
    <form action={formAction} className="mt-3 space-y-3 rounded border border-slate-200 bg-white p-3">
      <FormMessage state={state} />
      <div className="space-y-2">
        {loans.map((line) => (
          <div key={line.id} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="lineId" value={line.id} />
            <span className="flex-1 text-sm text-slate-800">
              {line.description}
              <span className={line.outstanding ? ' text-amber-800' : ' text-slate-500'}>
                {' '}
                · {line.quantity} out, {line.returnedQuantity} back
              </span>
            </span>
            <div className="w-28">
              <label className={labelClass} htmlFor={`returned-${line.id}`}>
                Returned
              </label>
              <input
                id={`returned-${line.id}`}
                name="returned"
                type="number"
                step="any"
                min={line.returnedQuantity}
                max={line.quantity}
                defaultValue={line.quantity}
                className={inputClass}
              />
            </div>
          </div>
        ))}
      </div>
      <div>
        <label className={labelClass} htmlFor={`return-note-${deliveryOrderId}`}>
          Note (optional)
        </label>
        <input
          id={`return-note-${deliveryOrderId}`}
          name="note"
          maxLength={500}
          placeholder="e.g. Returned to the store, condition good"
          className={inputClass}
        />
      </div>
      <button type="submit" className={secondaryButtonClass} disabled={pending}>
        {pending ? 'Recording…' : 'Record the return'}
      </button>
    </form>
  )
}
