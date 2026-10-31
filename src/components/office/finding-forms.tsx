'use client'

import { newId } from '@/lib/id'
import { useActionState, useRef, useState } from 'react'
import { SignaturePad } from '@/components/tech/signature-pad'
import {
  FINDING_SEVERITY_LABELS,
  FINDING_STATUS_LABELS,
  type FindingSeverityName,
  type FindingStatusName,
} from '@/lib/validation/findings'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import { FieldError, FormMessage, buttonClass, inputClass, labelClass } from './ui'

/**
 * The office's handling of a finding (slice 16).
 *
 * Three things a person can do: say where the defect has got to, raise the follow-up job with one
 * click, or record a customer refusing the repair with their signature. Each is its own form because
 * each has its own requirements — and the decline is a signature capture, not a status change.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const

/** The statuses a form may post. Declining is absent on purpose — it needs a signature. */
const MOVEABLE: FindingStatusName[] = ['OPEN', 'QUOTED', 'SCHEDULED', 'RECTIFIED']

export function FindingStatusForm({
  action,
  current,
}: {
  action: ServerAction
  current: FindingStatusName
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  const options = MOVEABLE.filter((status) => status !== current)

  if (options.length === 0) return null

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
      <div>
        <label className={labelClass} htmlFor={`finding-status-${current}`}>
          Move to
        </label>
        <select
          id={`finding-status-${current}`}
          name="status"
          defaultValue={options[0]}
          className={inputClass}
        >
          {options.map((status) => (
            <option key={status} value={status}>
              {FINDING_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-48 flex-1">
        <label className={labelClass} htmlFor={`finding-note-${current}`}>
          Note (optional)
        </label>
        <input
          id={`finding-note-${current}`}
          name="note"
          maxLength={1000}
          placeholder="Quote ref, or why not yet"
          className={inputClass}
        />
      </div>
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </button>
      <div className="w-full">
        <FormMessage state={state} />
        <FieldError state={state} name="status" />
        <FieldError state={state} name="note" />
      </div>
    </form>
  )
}

/**
 * One click to a follow-up job, pre-filled from the finding.
 *
 * The crane, the customer and the site all come from the finding, so the two decisions left are what
 * kind of work it is and how urgent — the same two a person makes when raising a job by hand.
 */
export function FollowUpJobForm({
  action,
  jobTypes,
  suggestedPriority,
  suggestedDescription,
  severity,
}: {
  action: ServerAction
  jobTypes: Array<{ id: string; name: string; code: string }>
  suggestedPriority: 'P1' | 'P2' | 'P3' | 'P4'
  suggestedDescription: string
  severity: FindingSeverityName
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM)
  // The job type the seeded catalogue calls a follow-up is the obvious default when it exists.
  const followUp = jobTypes.find((type) => type.code === 'FOLLOW_UP') ?? jobTypes[0]

  return (
    <form action={formAction} className="mt-2 space-y-3 rounded border border-line bg-sheet p-3">
      <p className="text-xs text-muted">
        Raises a new job for this crane, linked to both this finding and the job the report belongs
        to. {FINDING_SEVERITY_LABELS[severity]} findings start at {suggestedPriority}.
      </p>
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="follow-up-job-type">
            Kind of work
          </label>
          <select
            id="follow-up-job-type"
            name="jobTypeId"
            defaultValue={followUp?.id ?? ''}
            required
            className={inputClass}
          >
            {jobTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
          <FieldError state={state} name="jobTypeId" />
        </div>
        <div>
          <label className={labelClass} htmlFor="follow-up-priority">
            Priority
          </label>
          <select
            id="follow-up-priority"
            name="priority"
            defaultValue={suggestedPriority}
            className={inputClass}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
          <FieldError state={state} name="priority" />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="follow-up-description">
          What the job says
        </label>
        <textarea
          id="follow-up-description"
          name="description"
          rows={4}
          defaultValue={suggestedDescription}
          maxLength={2000}
          className={inputClass}
        />
        <FieldError state={state} name="description" />
      </div>
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? 'Raising…' : 'Raise the follow-up job'}
      </button>
    </form>
  )
}

/**
 * A customer declining a recommended repair, with their own signature (brief §6.4).
 *
 * The signature is drawn here and uploaded straight to storage through the same signed-URL route the
 * phone uses; the action receives only the File id. This is the record that the customer was told and
 * chose otherwise, so the name and the date are both required.
 */
export function DeclineFindingForm({
  action,
  findingId,
  today,
}: {
  action: ServerAction
  findingId: string
  /** `YYYY-MM-DD` in the operating timezone, the default for the date field. */
  today: string
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

    // One id per form, so a redraw rewrites the same File row rather than orphaning the first.
    idRef.current ??= newId()
    try {
      const response = await fetch('/api/files/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: idRef.current,
          findingId,
          kind: 'FINDING_SIGNATURE',
          filename: `decline-signature-${idRef.current}.png`,
          mimeType: 'image/png',
          // The pad exports a PNG data URL; its base64 payload is what will be stored.
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
    <form action={formAction} className="mt-2 space-y-3 rounded border border-warn/40 bg-warn/10 p-3">
      <p className="text-xs text-warn">
        Records that the customer was told this repair was recommended and declined it. Their
        signature is stored against the finding, and the finding is closed as declined.
      </p>
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="decline-name">
            Customer representative
          </label>
          <input id="decline-name" name="name" required maxLength={200} className={inputClass} />
          <FieldError state={state} name="name" />
        </div>
        <div>
          <label className={labelClass} htmlFor="decline-date">
            Date
          </label>
          <input
            id="decline-date"
            name="date"
            type="date"
            required
            defaultValue={today}
            className={inputClass}
          />
          <FieldError state={state} name="date" />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="decline-note">
          What was said
        </label>
        <input
          id="decline-note"
          name="note"
          maxLength={1000}
          placeholder="e.g. Deferred to next budget year"
          className={inputClass}
        />
        <FieldError state={state} name="note" />
      </div>

      <SignaturePad label="Customer signature" value={signature} onChange={(value) => void capture(value)} />
      <input ref={hidden} type="hidden" name="signatureFileId" />
      <FieldError state={state} name="signatureFileId" />
      {uploadError ? (
        <p role="alert" className="text-sm text-neg">
          {uploadError}
        </p>
      ) : null}

      <button
        type="submit"
        className="rounded-md border border-warn/40 bg-field px-4 py-2 font-medium text-warn hover:bg-warn/10 disabled:opacity-60"
        disabled={pending || !fileId}
      >
        {pending ? 'Recording…' : 'Record the declined repair'}
      </button>
    </form>
  )
}
