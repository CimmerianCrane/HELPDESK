'use client'

import { useActionState } from 'react'
import { buttonClass, inputClass, labelClass } from '@/components/office/ui'
import { IDLE_FORM } from '@/server/action-result'
import type { FormState, ImportPreviewState } from '@/server/action-result'

/**
 * The two-step import form, used by every importer.
 *
 * Choose a file and preview it, see exactly what would happen, then import. The preview is a check for
 * a person, not a permission — the apply action re-validates the whole file before writing anything.
 *
 * The preview state is typed loosely on purpose: each importer carries its own extra fields (a crane
 * preview names the asset tag, a customer preview the legal name), and the shape of the row is the
 * importer's business, not this component's.
 */

type PreviewAction = (state: FormState, formData: FormData) => Promise<FormState>
type ApplyAction = (state: FormState, formData: FormData) => Promise<FormState>

const OUTCOME_STYLES = {
  create: 'text-emerald-800',
  skip: 'text-amber-800',
} as const

export function ImportForm({
  previewAction,
  applyAction,
  noun,
  nameHeading,
  hiddenFields = {},
  fileHint,
}: {
  previewAction: PreviewAction
  applyAction: ApplyAction
  /** "customer" or "crane" — used in the buttons and the summary line. */
  noun: string
  /** What the second column of the preview table shows: "Customer" or "Asset tag". */
  nameHeading: string
  /** Values the form has to carry, such as the customer a crane belongs to. */
  hiddenFields?: Record<string, string>
  fileHint?: string
}) {
  // The state type has to be named explicitly: `IDLE_FORM` alone is a plain `FormState`, and the
  // preview's extra fields would be lost to inference.
  const [preview, previewFormAction, previewPending] = useActionState<FormState, FormData>(
    previewAction,
    IDLE_FORM,
  )
  const [applied, applyFormAction, applyPending] = useActionState<FormState, FormData>(
    applyAction,
    IDLE_FORM,
  )

  // Read through the widened shape; the actions return ImportPreviewState, which extends FormState.
  const detail = preview as ImportPreviewState
  const rows = detail.preview?.rows ?? []

  return (
    <div className="space-y-8">
      <form action={previewFormAction} className="space-y-4">
        {Object.entries(hiddenFields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}

        <div>
          <label htmlFor="file" className={labelClass}>
            CSV file
          </label>
          <input id="file" name="file" type="file" accept=".csv,text/csv" required className={inputClass} />
          <p className="mt-1 text-xs text-slate-500">
            {fileHint ?? 'UTF-8 CSV, up to 2 MB. Excel: “Save as → CSV UTF-8”. A header row is required.'}
          </p>
        </div>

        <button type="submit" disabled={previewPending} className={buttonClass}>
          {previewPending ? 'Checking…' : 'Preview'}
        </button>

        {preview.message ? (
          <p
            role={preview.ok ? 'status' : 'alert'}
            className={
              preview.ok
                ? 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900'
                : 'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800'
            }
          >
            {preview.message}
          </p>
        ) : null}

        {preview.fields?._form ? (
          <ul className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {preview.fields._form.slice(0, 25).map((message) => (
              <li key={message} className="list-inside list-disc">
                {message}
              </li>
            ))}
          </ul>
        ) : null}
      </form>

      {detail.preview ? (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <div>
            <h2 className="font-semibold text-slate-900">What will happen</h2>
            <p className="mt-1 text-sm text-slate-600">
              {detail.preview.toCreate} to add, {detail.preview.toSkip} to skip. Nothing has been
              written yet.
            </p>
          </div>

          {detail.preview.unknownColumns.length > 0 ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Ignored columns: {detail.preview.unknownColumns.join(', ')}. Only{' '}
              {detail.preview.recognisedColumns.join(', ')} are imported.
            </p>
          ) : null}

          <div className="max-h-96 overflow-y-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Rows found in the file</caption>
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Line</th>
                  <th scope="col" className="px-3 py-2 font-medium">{nameHeading}</th>
                  <th scope="col" className="px-3 py-2 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={`${row.line}-${row.label}`}>
                    <td className="px-3 py-2 text-slate-500">{row.line}</td>
                    <td className="px-3 py-2 text-slate-900">{row.label}</td>
                    <td className={`px-3 py-2 ${OUTCOME_STYLES[row.outcome]}`}>
                      {row.outcome === 'create' ? 'Add' : 'Skip'}
                      {row.reason ? <span className="block text-xs text-slate-500">{row.reason}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {detail.preview.toCreate > 0 ? (
            <form action={applyFormAction} className="space-y-3">
              <input type="hidden" name="fileText" value={detail.fileText ?? ''} />
              {Object.entries(hiddenFields).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <button type="submit" disabled={applyPending} className={buttonClass}>
                {applyPending
                  ? 'Importing…'
                  : `Import ${detail.preview.toCreate} ${noun}${detail.preview.toCreate === 1 ? '' : 's'}`}
              </button>
              {applied.message ? (
                <p role="alert" className="text-sm text-red-800">
                  {applied.message}
                </p>
              ) : null}
            </form>
          ) : (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Nothing to import — every row is already in the system.
            </p>
          )}
        </section>
      ) : null}
    </div>
  )
}
