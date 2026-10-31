'use client'

import { useActionState, useRef, useState } from 'react'
import {
  CALIBRATION_UPLOAD_TYPES,
  EQUIPMENT_STATUSES,
  EQUIPMENT_STATUS_LABELS,
  EQUIPMENT_TYPES,
  EQUIPMENT_TYPE_LABELS,
} from '@/lib/validation/calibrations'
import { MAX_UPLOAD_BYTES } from '@/lib/validation/reports'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import { FieldError, FormMessage, buttonClass, inputClass, labelClass } from './ui'

/**
 * One piece of equipment (slice 34). Adds and edits: the fields are the same, and `values` is null
 * when adding.
 *
 * The calibration certificate is uploaded the moment it is chosen, straight to storage through the
 * same signed-URL route the crane certificates use. On a new item the upload happens *after* the
 * first save, because the storage key names the resource's id — so the file field is only rendered
 * when editing, and says why.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

export interface CalibrationFormValues {
  id: string
  name: string
  type: string
  serialNumber: string | null
  status: string
  calibrationDueDate: Date | null
  file: { filename: string } | null
}

interface UploadTicket {
  fileId: string
  uploadUrl: string
  method: 'PUT'
}

/** `YYYY-MM-DD` for a date input; the stored value is already UTC midnight on the day it means. */
function toDayInput(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : ''
}

function CalibrationFileField({
  resourceId,
  existing,
  idPrefix,
  onBusyChange,
}: {
  resourceId: string
  existing: { filename: string } | null
  idPrefix: string
  onBusyChange: (busy: boolean) => void
}) {
  const id = `${idPrefix}-file`
  const hidden = useRef<HTMLInputElement>(null)
  const fileId = useRef<string | null>(null)
  const [label, setLabel] = useState(existing?.filename ?? '')
  const [message, setMessage] = useState<string | null>(null)

  async function upload(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setMessage('Files must be 5 MB or smaller.')
      return
    }
    if (!(CALIBRATION_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
      setMessage('Upload a PDF or a photograph (JPEG, PNG or WebP).')
      return
    }

    fileId.current ??= crypto.randomUUID()
    setMessage(null)
    onBusyChange(true)
    try {
      const response = await fetch('/api/files/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // The same id on a retry rewrites the File row rather than orphaning the first attempt.
          id: fileId.current,
          resourceId,
          kind: 'CALIBRATION',
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      })
      const ticket = (await response.json()) as UploadTicket & { error?: string }
      if (!response.ok) throw new Error(ticket.error ?? 'That upload could not be started.')

      const put = await fetch(ticket.uploadUrl, {
        method: ticket.method,
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!put.ok) throw new Error('The file reached the server but was not stored.')

      if (hidden.current) hidden.current.value = ticket.fileId
      setLabel(file.name)
    } catch (error) {
      if (hidden.current) hidden.current.value = ''
      setMessage(error instanceof Error ? error.message : 'That file could not be uploaded.')
    } finally {
      onBusyChange(false)
    }
  }

  return (
    <div className="sm:col-span-2">
      <label htmlFor={id} className={labelClass}>
        Calibration certificate
      </label>
      <input
        id={id}
        type="file"
        accept={CALIBRATION_UPLOAD_TYPES.join(',')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
        }}
        className="mt-1 block w-full text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
      />
      <input ref={hidden} type="hidden" name="fileId" />
      <p className="mt-1 text-xs text-muted">
        {label
          ? `On file: ${label}`
          : 'Optional. The certificate from the calibration lab — a PDF or a photograph, up to 5 MB.'}
        {message ? <span className="ml-1 text-neg">{message}</span> : null}
      </p>
    </div>
  )
}

export function CalibrationForm({
  action,
  values,
  submitLabel,
}: {
  action: ServerAction
  values: CalibrationFormValues | null
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const [uploading, setUploading] = useState(false)
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
            placeholder="Load cell — 10 t"
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
            defaultValue={values?.type ?? 'LOAD_CELL'}
            className={inputClass}
          >
            {EQUIPMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {EQUIPMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <FieldError state={state} name="type" />
        </div>

        <div>
          <label htmlFor={`${id}-serial`} className={labelClass}>
            Serial number
          </label>
          <input
            id={`${id}-serial`}
            name="serialNumber"
            maxLength={80}
            defaultValue={values?.serialNumber ?? ''}
            placeholder="LC-10T-11"
            className={inputClass}
          />
          <FieldError state={state} name="serialNumber" />
        </div>

        <div>
          <label htmlFor={`${id}-status`} className={labelClass}>
            State
          </label>
          <select
            id={`${id}-status`}
            name="status"
            defaultValue={values?.status ?? 'AVAILABLE'}
            className={inputClass}
          >
            {EQUIPMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {EQUIPMENT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          <FieldError state={state} name="status" />
        </div>

        <div>
          <label htmlFor={`${id}-due`} className={labelClass}>
            Calibration runs out
          </label>
          <input
            id={`${id}-due`}
            name="calibrationDueDate"
            type="date"
            defaultValue={toDayInput(values?.calibrationDueDate ?? null)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted">
            The date on the calibration certificate. Leave it blank if there is none on file — the
            register shows that as its own state rather than guessing.
          </p>
          <FieldError state={state} name="calibrationDueDate" />
        </div>
      </div>

      {values ? (
        <CalibrationFileField
          resourceId={values.id}
          existing={values.file ?? null}
          idPrefix={id}
          onBusyChange={setUploading}
        />
      ) : (
        <p className="text-xs text-muted">
          Save the item first, then attach its calibration certificate.
        </p>
      )}

      <FieldError state={state} name="_form" />
      <FieldError state={state} name="fileId" />
      <button type="submit" disabled={pending || uploading} className={buttonClass}>
        {uploading ? 'Uploading file…' : pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
