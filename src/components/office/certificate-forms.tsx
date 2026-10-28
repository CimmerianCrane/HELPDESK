'use client'

import { useActionState, useRef, useState } from 'react'
import {
  CERTIFICATE_TYPES,
  CERTIFICATE_TYPE_LABELS,
  CERTIFICATE_UPLOAD_TYPES,
} from '@/lib/validation/certificates'
import { MAX_UPLOAD_BYTES } from '@/lib/validation/reports'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import { FieldError, FormMessage, buttonClass, inputClass, labelClass } from './ui'

/**
 * The certificate register's forms (slice 13).
 *
 * The file is uploaded the moment it is chosen, straight to storage through the same signed-URL route
 * the phone uses — a scanned certificate is a PDF and can approach the function body limit, so it
 * never passes through the server action. The action then receives only the File row's id.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

export interface CertificateFormValues {
  id: string
  type: string
  certificateNumber: string | null
  issuer: string | null
  issueDate: Date | null
  expiryDate: Date | null
  nextDueDate: Date | null
  statedSwlKg: number | null
  job: { number: string } | null
  file: { filename: string } | null
  notes: string | null
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

function CertificateFileField({
  craneId,
  existing,
  idPrefix,
  onBusyChange,
}: {
  craneId: string
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
    if (!(CERTIFICATE_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
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
          craneId,
          kind: 'CERTIFICATE',
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
        Scan or photograph
      </label>
      <input
        id={id}
        type="file"
        accept={CERTIFICATE_UPLOAD_TYPES.join(',')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
        }}
        className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
      />
      <input ref={hidden} type="hidden" name="fileId" />
      <p className="mt-1 text-xs text-slate-500">
        {label
          ? `On file: ${label}`
          : 'Optional. A PDF or a photograph of the paper, up to 5 MB.'}
        {message ? <span className="ml-1 text-red-700">{message}</span> : null}
      </p>
    </div>
  )
}

function CertificateFields({
  value,
  craneId,
  idPrefix,
  onBusyChange,
}: {
  value?: CertificateFormValues
  craneId: string
  idPrefix: string
  onBusyChange: (busy: boolean) => void
}) {
  const id = (name: string) => `${idPrefix}-${name}`

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* The form is only rendered on a crane's page, so the crane travels with the submission. */}
      <input type="hidden" name="craneId" value={craneId} />
      <div>
        <label htmlFor={id('type')} className={labelClass}>
          Kind
        </label>
        <select
          id={id('type')}
          name="type"
          required
          defaultValue={value?.type ?? 'STATUTORY_TEST_EXAMINATION'}
          className={inputClass}
        >
          {CERTIFICATE_TYPES.map((type) => (
            <option key={type} value={type}>
              {CERTIFICATE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={id('certificateNumber')} className={labelClass}>
          Certificate number
        </label>
        <input
          id={id('certificateNumber')}
          name="certificateNumber"
          defaultValue={value?.certificateNumber ?? ''}
          className={inputClass}
        />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor={id('issuer')} className={labelClass}>
          Issued by
        </label>
        <input
          id={id('issuer')}
          name="issuer"
          defaultValue={value?.issuer ?? ''}
          placeholder="Authorised Examiner, calibration lab, or the firm that issued it"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('issueDate')} className={labelClass}>
          Issued on
        </label>
        <input
          id={id('issueDate')}
          name="issueDate"
          type="date"
          defaultValue={toDayInput(value?.issueDate ?? null)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('expiryDate')} className={labelClass}>
          Expires
        </label>
        <input
          id={id('expiryDate')}
          name="expiryDate"
          type="date"
          defaultValue={toDayInput(value?.expiryDate ?? null)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('nextDueDate')} className={labelClass}>
          Next due
        </label>
        <input
          id={id('nextDueDate')}
          name="nextDueDate"
          type="date"
          defaultValue={toDayInput(value?.nextDueDate ?? null)}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          Used when renewal falls before expiry. The screen counts whichever comes first.
        </p>
      </div>

      <div>
        <label htmlFor={id('statedSwlKg')} className={labelClass}>
          Stated safe working load (kg)
        </label>
        <input
          id={id('statedSwlKg')}
          name="statedSwlKg"
          type="number"
          min={1}
          defaultValue={value?.statedSwlKg ?? ''}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={id('jobNumber')} className={labelClass}>
          Linked job
        </label>
        <input
          id={id('jobNumber')}
          name="jobNumber"
          defaultValue={value?.job?.number ?? ''}
          placeholder="JOB-2026-0142"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">Optional. The job that produced this document.</p>
      </div>

      <CertificateFileField
        craneId={craneId}
        existing={value?.file ?? null}
        idPrefix={idPrefix}
        onBusyChange={onBusyChange}
      />

      <div className="sm:col-span-2">
        <label htmlFor={id('notes')} className={labelClass}>
          Notes
        </label>
        <textarea
          id={id('notes')}
          name="notes"
          rows={2}
          defaultValue={value?.notes ?? ''}
          className={inputClass}
        />
      </div>
    </div>
  )
}

export function CertificateForm({
  action,
  craneId,
  value,
  submitLabel,
  idPrefix,
}: {
  action: ServerAction
  craneId: string
  value?: CertificateFormValues
  submitLabel: string
  idPrefix: string
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, IDLE_FORM)
  const [uploading, setUploading] = useState(false)

  return (
    <form action={formAction} className="space-y-5">
      <CertificateFields
        value={value}
        craneId={craneId}
        idPrefix={idPrefix}
        onBusyChange={setUploading}
      />
      <FormMessage state={state} />
      <FieldError state={state} name="_form" />
      <FieldError state={state} name="fileId" />
      <button type="submit" disabled={pending || uploading} className={buttonClass}>
        {uploading ? 'Uploading file…' : pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

export function ArchiveCertificateButton({
  action,
  label,
}: {
  action: ServerAction
  label: string
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, IDLE_FORM)

  return (
    <form action={formAction} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
      >
        {pending ? 'Archiving…' : `Archive — ${label}`}
      </button>
      <p className="text-xs text-slate-500">
        Keeps the record, the file and the audit trail. The certificate simply stops counting.
      </p>
      <FormMessage state={state} />
    </form>
  )
}
