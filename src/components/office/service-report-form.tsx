'use client'

import { useActionState } from 'react'
import { IDLE_FORM, type FormState } from '@/server/action-result'
import { SERVICE_GRADE_LABELS } from '@/lib/validation/reports'
import { FieldError, FormMessage, buttonClass, hiVisButtonClass, inputClass, labelClass } from './ui'

/**
 * The Service Report's office screen (slice 39).
 *
 * Every graded part has one sentence, generated from the technician's rating and note when the draft
 * is first built. The office rewords any of them here and issues the document; it cannot add a part,
 * change a crane or edit a grade — those are what the technician signed.
 *
 * Two forms, not one with an `intent` button: saving and issuing are different services with
 * different permissions, and a stray field must not be able to choose between them.
 *
 * Inputs post as index-aligned columns in render order — the contract `saveServiceReportAction`
 * reads. `paragraphCrane` is the crane's index, repeated on every paragraph of that crane.
 */

type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>

export interface ServiceReportEditorCrane {
  craneId: string
  assetTag: string
  type: string | null
  paragraphs: Array<{ component: string; grade: number | null; text: string }>
}

export function ServiceReportForm({
  saveAction,
  approveAction,
  cranes,
  editable,
}: {
  saveAction: ServerAction
  approveAction: ServerAction
  cranes: ServiceReportEditorCrane[]
  /** False once the document is issued — then it is shown, not edited. */
  editable: boolean
}) {
  const [saveState, saveFormAction, saving] = useActionState(saveAction, IDLE_FORM)
  const [approveState, approveFormAction, approving] = useActionState(approveAction, IDLE_FORM)

  return (
    <div className="space-y-4">
      <FormMessage state={saveState} />
      <FormMessage state={approveState} />

      {editable ? (
        <form action={saveFormAction} className="space-y-5">
          {cranes.map((crane, craneIndex) => (
            <CraneBlock key={crane.craneId} crane={crane} craneIndex={craneIndex} readOnly={false} />
          ))}
          <FieldError state={saveState} name="_form" />
          <button type="submit" disabled={saving} className={buttonClass}>
            Save the wording
          </button>
        </form>
      ) : (
        cranes.map((crane, craneIndex) => (
          <CraneBlock key={crane.craneId} crane={crane} craneIndex={craneIndex} readOnly />
        ))
      )}

      {editable ? (
        <form action={approveFormAction}>
          <FieldError state={approveState} name="_form" />
          <button type="submit" disabled={approving} className={hiVisButtonClass}>
            Issue the Service Report
          </button>
        </form>
      ) : null}
    </div>
  )
}

function CraneBlock({
  crane,
  craneIndex,
  readOnly,
}: {
  crane: ServiceReportEditorCrane
  craneIndex: number
  readOnly: boolean
}) {
  return (
    <div>
      {readOnly ? null : <input type="hidden" name="craneId" value={crane.craneId} />}
      <h3 className="text-sm font-semibold text-ink">{crane.assetTag}</h3>
      {crane.type ? <p className="text-xs text-muted">{crane.type}</p> : null}
      <ul className="mt-2 space-y-3">
        {crane.paragraphs.map((paragraph, index) => (
          <li
            key={`${craneIndex}-${index}`}
            className="border-t border-rule pt-3 first:border-0 first:pt-0"
          >
            {readOnly ? null : (
              <>
                <input type="hidden" name="paragraphCrane" value={craneIndex} />
                <input type="hidden" name="component" value={paragraph.component} />
                <input type="hidden" name="grade" value={paragraph.grade ?? ''} />
              </>
            )}
            <label className={labelClass}>
              {paragraph.component}
              {paragraph.grade ? (
                <span className="ml-2 font-normal text-muted">
                  Grade {paragraph.grade} — {SERVICE_GRADE_LABELS[paragraph.grade]}
                </span>
              ) : null}
            </label>
            {readOnly ? (
              <p className="mt-1 text-sm text-ink">{paragraph.text}</p>
            ) : (
              <textarea
                name="text"
                aria-label={`${paragraph.component} on the Service Report`}
                defaultValue={paragraph.text}
                rows={2}
                className={inputClass}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
