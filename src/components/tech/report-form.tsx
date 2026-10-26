'use client'

import { useCallback, useEffect, useState } from 'react'
import type { TemplateField, TemplateSection } from '@/lib/templates/schema'
import { reportSubmitSchema, type ChecklistAnswer } from '@/lib/validation/reports'
import {
  TECHNICIAN_NAME_KEY,
  techDb,
  type CachedPart,
  type LocalFile,
  type ReportDraft,
} from '@/offline/db'
import { flushOutbox } from '@/offline/outbox'
import type { TechCrane, TechJobDetail } from '@/server/tech/my-jobs'
import { SignaturePad } from './signature-pad'

/**
 * The report, filled in on the phone.
 *
 * The draft lives in Dexie and is written every couple of seconds, so the back button, a reload or
 * the browser being killed in a lift loses nothing (CLAUDE.md rule 11). Submitting does not send the
 * draft: it puts a snapshot in the outbox and tries to flush it, and the report only disappears from
 * the phone once the server has confirmed it. Every id is generated here, before there is any signal,
 * which is what lets the server recognise a second attempt as the same report.
 *
 * The form is driven by the template the job type points at — sections, field types and rows are data
 * — and the same template version is checked again on the server. A phone holding an old version is
 * told to sync rather than having its answers stored against a shape nobody rendered.
 */

interface Loaded {
  draft: ReportDraft
  photos: LocalFile[]
  technicianSignature: string | null
  customerSignature: string | null
  queued: boolean
}

export function ReportForm({
  job,
  crane,
  technicianName,
}: {
  job: TechJobDetail
  crane: TechCrane
  /** The signed-in technician's name, when the page knows it. The offline shell does not. */
  technicianName?: string
}) {
  const template = job.reportTemplate
  const submitted = job.reports.find((report) => report.craneId === crane.id)

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [partsCatalogue, setPartsCatalogue] = useState<CachedPart[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [done, setDone] = useState(false)
  const [templateChanged, setTemplateChanged] = useState(false)

  // --- loading ---------------------------------------------------------------------------------

  useEffect(() => {
    if (!template || submitted) return

    void (async () => {
      const [existing, catalogue, nameRow] = await Promise.all([
        techDb.drafts
          .where('jobId')
          .equals(job.id)
          .filter((draft) => draft.craneId === crane.id)
          .first(),
        techDb.parts.toArray(),
        techDb.meta.get(TECHNICIAN_NAME_KEY),
      ])

      // The page's own answer first: the bundle that carries the name can arrive after this form
      // opens, and a technician should not have to type their own name to get past that race.
      const draftName = technicianName || nameRow?.value || ''
      let draft = existing
      if (draft && (draft.templateId !== template.id || draft.templateVersion !== template.version)) {
        // The answers were given against a shape the server will no longer accept. Keeping the old
        // draft would let the technician spend an hour filling a form that cannot be submitted.
        setTemplateChanged(true)
        await techDb.drafts.delete(draft.id)
        draft = undefined
      }
      if (!draft) draft = blankDraft(job.id, crane.id, template.id, template.version, draftName)
      // A draft begun before the name was known takes it now rather than making the field a chore.
      else if (!draft.technicianSignerName && draftName) draft = { ...draft, technicianSignerName: draftName }

      const ids = [
        ...draft.photoIds,
        ...(draft.technicianSignatureId ? [draft.technicianSignatureId] : []),
        ...(draft.customerSignatureId ? [draft.customerSignatureId] : []),
      ]
      const files = ids.length > 0 ? await techDb.files.bulkGet(ids) : []
      const byId = new Map(files.filter((file): file is LocalFile => Boolean(file)).map((f) => [f.id, f]))
      const queued = Boolean(await techDb.outbox.get(draft.id))

      setPartsCatalogue(catalogue)
      setLoaded({
        draft,
        photos: draft.photoIds
          .map((id) => byId.get(id))
          .filter((file): file is LocalFile => Boolean(file)),
        technicianSignature: draft.technicianSignatureId
          ? (byId.get(draft.technicianSignatureId)?.dataUrl ?? null)
          : null,
        customerSignature: draft.customerSignatureId
          ? (byId.get(draft.customerSignatureId)?.dataUrl ?? null)
          : null,
        queued,
      })
    })()
  }, [crane.id, job.id, submitted, technicianName, template])

  // --- autosave --------------------------------------------------------------------------------

  useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => {
      void techDb.drafts
        .put({ ...loaded.draft, updatedAt: new Date().toISOString() })
        .then(() => setSavedAt(new Date()))
    }, 1500)
    return () => clearTimeout(timer)
  }, [loaded])

  const update = useCallback((change: (draft: ReportDraft) => ReportDraft) => {
    setLoaded((current) => (current ? { ...current, draft: change(current.draft) } : current))
  }, [])

  const setAnswer = useCallback(
    (key: string, value: string) => {
      update((draft) => ({ ...draft, data: { ...draft.data, [key]: value } }))
    },
    [update],
  )

  const setRows = useCallback(
    (key: string, rows: Array<Record<string, unknown>>) => {
      update((draft) => ({ ...draft, data: { ...draft.data, [key]: rows } }))
    },
    [update],
  )

  const setChecklist = useCallback(
    (code: string, change: Partial<ChecklistAnswer>) => {
      update((draft) => ({
        ...draft,
        checklist: { ...draft.checklist, [code]: { ...draft.checklist[code], ...change } },
      }))
    },
    [update],
  )

  // --- parts -----------------------------------------------------------------------------------

  const setParts = useCallback(
    (parts: ReportDraft['parts']) => {
      update((draft) => {
        const data = { ...draft.data }
        // The breakdown template asks for parts as table rows as well. One list, two outputs: the
        // rows the report prints, and the stock movements the server writes from `parts`.
        if (template?.schema.sections.some((section) => section.key === 'parts')) {
          data.parts = parts.map((part) => ({
            partNumber: part.partNumber,
            description: part.description,
            quantity: part.quantity,
          }))
        }
        return { ...draft, parts, data }
      })
    },
    [template, update],
  )

  // --- photos and signatures -------------------------------------------------------------------

  async function addPhoto(file: File) {
    if (!loaded) return
    try {
      const compressed = await compressImage(file)
      const id = crypto.randomUUID()
      const local: LocalFile = {
        id,
        jobId: job.id,
        kind: 'PHOTO',
        filename: `${id}.jpg`,
        mimeType: compressed.mimeType,
        sizeBytes: compressed.sizeBytes,
        dataUrl: compressed.dataUrl,
        uploadedAs: null,
        createdAt: new Date().toISOString(),
      }
      await techDb.files.put(local)
      setLoaded((current) =>
        current
          ? {
              ...current,
              photos: [...current.photos, local],
              draft: { ...current.draft, photoIds: [...current.draft.photoIds, id] },
            }
          : current,
      )
    } catch {
      setMessage('That photo could not be read. Try taking it again.')
    }
  }

  async function removePhoto(id: string) {
    await techDb.files.delete(id)
    setLoaded((current) =>
      current
        ? {
            ...current,
            photos: current.photos.filter((photo) => photo.id !== id),
            draft: { ...current.draft, photoIds: current.draft.photoIds.filter((photoId) => photoId !== id) },
          }
        : current,
    )
  }

  async function storeSignature(role: 'technician' | 'customer', dataUrl: string | null) {
    if (!loaded) return
    const currentId =
      role === 'technician'
        ? loaded.draft.technicianSignatureId
        : loaded.draft.customerSignatureId

    if (!dataUrl) {
      if (currentId) await techDb.files.delete(currentId)
      setLoaded((current) =>
        current
          ? {
              ...current,
              ...(role === 'technician'
                ? { technicianSignature: null }
                : { customerSignature: null }),
              draft: {
                ...current.draft,
                ...(role === 'technician'
                  ? { technicianSignatureId: null }
                  : { customerSignatureId: null }),
              },
            }
          : current,
      )
      return
    }

    const id = currentId ?? crypto.randomUUID()
    const local: LocalFile = {
      id,
      jobId: job.id,
      kind: 'SIGNATURE',
      filename: `signature-${id}.png`,
      mimeType: 'image/png',
      sizeBytes: Math.max(1, Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)),
      dataUrl,
      // A redraw replaces the bytes, so any earlier upload of this id no longer matches them.
      uploadedAs: null,
      createdAt: new Date().toISOString(),
    }
    await techDb.files.put(local)
    setLoaded((current) =>
      current
        ? {
            ...current,
            ...(role === 'technician' ? { technicianSignature: dataUrl } : { customerSignature: dataUrl }),
            draft: {
              ...current.draft,
              ...(role === 'technician'
                ? { technicianSignatureId: id }
                : { customerSignatureId: id }),
            },
          }
        : current,
    )
  }

  // --- submit ----------------------------------------------------------------------------------

  async function submit() {
    if (!loaded || !template) return
    setMessage(null)

    const { draft } = loaded
    const parsed = reportSubmitSchema(template.schema, job.checklist).safeParse({
      reportId: draft.id,
      jobId: draft.jobId,
      craneId: draft.craneId,
      templateId: draft.templateId,
      templateVersion: draft.templateVersion,
      data: draft.data,
      checklist: draft.checklist,
      parts: draft.parts.map((part) => ({
        partNumber: part.partNumber,
        quantity: part.quantity,
        serialOrBatch: part.serialOrBatch,
      })),
      photoFileIds: draft.photoIds,
      technicianSignerName: draft.technicianSignerName,
      technicianSignatureFileId: draft.technicianSignatureId ?? '',
      customerSignerName: draft.customerSignerName,
      customerSignerDesignation: draft.customerSignerDesignation,
      customerSignatureFileId: draft.customerSignatureId,
      customerDeclinedReason: draft.customerDeclinedReason,
    })

    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      setMessage(issue?.message ?? 'The report is not complete yet.')
      return
    }

    const now = new Date().toISOString()
    // The outbox keeps its own snapshot: a later edit to the draft must not change what was queued.
    const payload = { ...draft }
    await techDb.drafts.put({ ...draft, updatedAt: now })
    await techDb.outbox.put({
      id: draft.id,
      kind: 'report.submit',
      jobId: draft.jobId,
      reportId: draft.id,
      payload,
      createdAt: now,
      attempts: 0,
      lastError: null,
    })
    setLoaded((current) => (current ? { ...current, queued: true } : current))

    if (!navigator.onLine) {
      setMessage('Saved on this phone. It will upload when there is signal.')
      return
    }

    setSending(true)
    try {
      const result = await flushOutbox()
      const stillQueued = await techDb.outbox.get(draft.id)
      if (!stillQueued) {
        setDone(true)
        setLoaded((current) => (current ? { ...current, queued: false } : current))
      } else {
        setMessage(stillQueued.lastError ?? result.errors[0] ?? 'Still queued for upload.')
      }
    } finally {
      setSending(false)
    }
  }

  // --- render ----------------------------------------------------------------------------------

  if (!template) {
    return (
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
        This job type has no report template. Ask the office to attach one before filling a report.
      </p>
    )
  }

  if (submitted) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
        <p className="font-medium">Report submitted</p>
        <p className="mt-1 text-sm">
          {submitted.submittedAt
            ? `Sent on ${new Date(submitted.submittedAt).toLocaleString()}.`
            : 'This report is already on the server.'}
        </p>
      </div>
    )
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
        <p className="font-medium">Report sent</p>
        <p className="mt-1 text-sm">The office has it. You can head off.</p>
      </div>
    )
  }

  if (!loaded) {
    return <p className="text-slate-600">Reading the draft on this phone…</p>
  }

  const { draft } = loaded
  const findingsTable = template.schema.sections.find((section) => section.key === 'findings')

  return (
    <div className="space-y-5 pb-24">
      <header className="space-y-1">
        <p className="text-sm text-slate-500">
          {job.number} · {template.name}
        </p>
        <h1 className="text-xl font-semibold text-slate-900">{crane.assetTag}</h1>
        <p className="text-sm text-slate-600">
          {crane.type.replace(/_/g, ' ').toLowerCase()} · SWL {crane.swlKg} kg
        </p>
        {crane.status === 'RESTRICTED' && (
          <p className="rounded-md bg-red-100 px-2 py-1 text-sm font-medium text-red-900">
            Do Not Operate{crane.restrictedReason ? `: ${crane.restrictedReason}` : ''}
          </p>
        )}
        <p className="text-xs text-slate-500" aria-live="polite">
          {loaded.queued
            ? 'Waiting to upload. Everything stays on this phone until the office has it.'
            : savedAt
              ? `Saved on this phone at ${savedAt.toLocaleTimeString()}.`
              : 'Saves on this phone every couple of seconds.'}
        </p>
      </header>

      {templateChanged && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          The office changed this report template, so the form has started again. Anything already
          sent is unaffected.
        </p>
      )}

      {message && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {message}
        </p>
      )}

      {template.schema.sections
        .filter((section) => !(section.key === 'parts' && section.layout === 'table'))
        .map((section) =>
          section.layout === 'table' ? (
            <TableSection
              key={section.key}
              section={section}
              rows={asRows(draft.data[section.key])}
              onChange={(rows) => setRows(section.key, rows)}
            />
          ) : (
            <div key={section.key} className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-base font-semibold text-slate-900">{section.label}</h2>
              <div className="mt-3 space-y-4">
                {section.fields.map((field) => (
                  <FieldInput
                    key={field.key}
                    field={field}
                    value={draft.data[field.key]}
                    onChange={(value) => setAnswer(field.key, value)}
                  />
                ))}
              </div>
            </div>
          ),
        )}

      <PartsSection
        parts={draft.parts}
        catalogue={partsCatalogue}
        onChange={setParts}
        shownOnTemplate={template.schema.sections.some((section) => section.key === 'parts')}
      />

      {job.checklist.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900">Checklist</h2>
          <div className="mt-3 space-y-5">
            {groupChecklist(job.checklist).map((group) => (
              <div key={group.name}>
                <h3 className="text-sm font-medium text-slate-700">{group.name}</h3>
                <ul className="mt-2 space-y-3">
                  {group.items.map((item) => {
                    const answer = draft.checklist[item.code] ?? {}
                    const choices =
                      item.resultType === 'PASS_FAIL_NA'
                        ? ['Pass', 'Fail', 'N/A']
                        : item.resultType === 'YES_NO'
                          ? ['Yes', 'No']
                          : null
                    return (
                      <li key={item.code} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
                        <p className="text-slate-900">
                          {item.label}
                          {item.unit && <span className="text-slate-500"> ({item.unit})</span>}
                        </p>
                        {choices ? (
                          <ChoiceButtons
                            label={item.label}
                            options={choices}
                            value={answer.result ?? null}
                            onChange={(value) => setChecklist(item.code, { result: value })}
                          />
                        ) : item.resultType === 'NUMBER' ? (
                          <input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            aria-label={item.label}
                            value={answer.measurement ?? ''}
                            onChange={(event) =>
                              setChecklist(item.code, {
                                measurement:
                                  event.target.value === '' ? null : Number(event.target.value),
                              })
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-lg"
                          />
                        ) : (
                          <textarea
                            aria-label={item.label}
                            value={answer.note ?? ''}
                            onChange={(event) => setChecklist(item.code, { note: event.target.value })}
                            rows={2}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Photos</h2>
        <p className="mt-1 text-sm text-slate-500">
          {findingsTable ? 'Photograph anything you raised as a finding.' : 'Anything worth showing the office.'}
        </p>
        {loaded.photos.length > 0 && (
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {loaded.photos.map((photo) => (
              <li key={photo.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.dataUrl}
                  alt={`Photo ${loaded.photos.indexOf(photo) + 1}`}
                  className="h-24 w-full rounded-lg object-cover"
                />
                <button
                  type="button"
                  onClick={() => void removePhoto(photo.id)}
                  className="absolute top-1 right-1 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className="mt-3 inline-block rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-900 active:bg-slate-100">
          Take photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void addPhoto(file)
              event.target.value = ''
            }}
          />
        </label>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Signatures</h2>
        <div className="mt-3 space-y-2">
          <label className="block text-sm font-medium text-slate-700" htmlFor="technician-name">
            Technician name
          </label>
          <input
            id="technician-name"
            value={draft.technicianSignerName}
            onChange={(event) =>
              update((current) => ({ ...current, technicianSignerName: event.target.value }))
            }
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </div>
        <div className="mt-4">
          <SignaturePad
            label="Technician signature"
            value={loaded.technicianSignature}
            onChange={(dataUrl) => void storeSignature('technician', dataUrl)}
            disabled={false}
          />
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-medium text-slate-700">Customer</h3>
          <div className="mt-2 grid grid-cols-1 gap-2">
            <input
              aria-label="Customer name"
              placeholder="Name"
              value={draft.customerSignerName}
              onChange={(event) =>
                update((current) => ({ ...current, customerSignerName: event.target.value }))
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <input
              aria-label="Customer designation"
              placeholder="Designation (e.g. site supervisor)"
              value={draft.customerSignerDesignation}
              onChange={(event) =>
                update((current) => ({ ...current, customerSignerDesignation: event.target.value }))
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          <div className="mt-3">
            <SignaturePad
              label="Customer signature"
              value={loaded.customerSignature}
              onChange={(dataUrl) => void storeSignature('customer', dataUrl)}
              disabled={Boolean(draft.customerDeclinedReason)}
            />
          </div>
          <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="declined-reason">
            Or: why the customer did not sign
          </label>
          <textarea
            id="declined-reason"
            value={draft.customerDeclinedReason}
            onChange={(event) =>
              update((current) => ({ ...current, customerDeclinedReason: event.target.value }))
            }
            rows={2}
            placeholder="Customer unavailable, refused to sign, site closed…"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </div>
      </section>

      {/* Sits above the layout's bottom nav rather than under it, so the button is never covered. */}
      <div className="fixed inset-x-0 bottom-16 z-20 border-t border-slate-200 bg-white p-3">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={sending}
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-lg font-semibold text-white disabled:opacity-60"
          >
            {sending ? 'Sending…' : loaded.queued ? 'Try sending again' : 'Submit report'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function blankDraft(
  jobId: string,
  craneId: string,
  templateId: string,
  templateVersion: number,
  technicianName: string,
): ReportDraft {
  return {
    id: crypto.randomUUID(),
    jobId,
    craneId,
    templateId,
    templateVersion,
    data: {},
    checklist: {},
    parts: [],
    photoIds: [],
    technicianSignerName: technicianName,
    technicianSignatureId: null,
    customerSignerName: '',
    customerSignerDesignation: '',
    customerSignatureId: null,
    customerDeclinedReason: '',
    updatedAt: new Date().toISOString(),
  }
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: TemplateField
  value: unknown
  onChange: (value: string) => void
}) {
  const id = `field-${field.key}`
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {field.label}
        {field.unit && <span className="font-normal text-slate-500"> ({field.unit})</span>}
        {field.required && <span className="text-red-700"> *</span>}
      </label>
      {field.type === 'RADIO' && field.options ? (
        <ChoiceButtons
          label={field.label}
          options={field.options}
          value={text || null}
          onChange={onChange}
        />
      ) : field.type === 'PASS_FAIL_NA' || field.type === 'YES_NO' ? (
        <ChoiceButtons
          label={field.label}
          options={field.type === 'PASS_FAIL_NA' ? ['Pass', 'Fail', 'N/A'] : ['Yes', 'No']}
          value={text || null}
          onChange={onChange}
        />
      ) : field.type === 'NUMBER' ? (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step="any"
          value={text}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-lg"
        />
      ) : field.type === 'DATE' ? (
        <input
          id={id}
          type="date"
          value={text}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-lg"
        />
      ) : field.help ? (
        <textarea
          id={id}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      ) : (
        <input
          id={id}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      )}
      {field.help && <p className="mt-1 text-xs text-slate-500">{field.help}</p>}
    </div>
  )
}

function ChoiceButtons({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly string[]
  value: string | null
  onChange: (value: string) => void
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`rounded-lg border px-4 py-2 font-medium ${
            value === option
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-300 bg-white text-slate-900'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

function TableSection({
  section,
  rows,
  onChange,
}: {
  section: TemplateSection
  rows: Array<Record<string, unknown>>
  onChange: (rows: Array<Record<string, unknown>>) => void
}) {
  function changeRow(index: number, key: string, value: string) {
    onChange(rows.map((row, position) => (position === index ? { ...row, [key]: value } : row)))
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">{section.label}</h2>
      <p className="mt-1 text-sm text-slate-500">
        {section.minRows ? `At least ${section.minRows} row(s) required.` : 'Leave empty if none.'}
      </p>
      <div className="mt-3 space-y-4">
        {rows.map((row, index) => (
          <div key={index} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-600">Row {index + 1}</p>
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, position) => position !== index))}
                className="text-sm text-red-700 underline"
              >
                Remove
              </button>
            </div>
            <div className="mt-2 space-y-3">
              {section.fields.map((field) => (
                <FieldInput
                  key={field.key}
                  field={field}
                  value={row[field.key]}
                  onChange={(value) => changeRow(index, field.key, value)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...rows, {}])}
        className="mt-3 rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-900 active:bg-slate-100"
      >
        Add row
      </button>
    </section>
  )
}

function PartsSection({
  parts,
  catalogue,
  onChange,
  shownOnTemplate,
}: {
  parts: ReportDraft['parts']
  catalogue: CachedPart[]
  onChange: (parts: ReportDraft['parts']) => void
  shownOnTemplate: boolean
}) {
  const [choice, setChoice] = useState('')

  function add() {
    const part = catalogue.find((entry) => entry.partNumber === choice)
    if (!part) return
    if (parts.some((entry) => entry.partNumber === part.partNumber)) return
    onChange([
      ...parts,
      { partNumber: part.partNumber, description: part.description, quantity: 1, serialOrBatch: null },
    ])
    setChoice('')
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">Parts used</h2>
      <p className="mt-1 text-sm text-slate-500">
        Fitting a part here records stock leaving the van.{' '}
        {shownOnTemplate && 'These rows also fill the parts table on the report.'}
      </p>

      {parts.length > 0 && (
        <ul className="mt-3 space-y-3">
          {parts.map((part, index) => (
            <li key={part.partNumber} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900">{part.partNumber}</p>
                  <p className="text-sm text-slate-600">{part.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onChange(parts.filter((_, position) => position !== index))}
                  className="text-sm text-red-700 underline"
                >
                  Remove
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-sm text-slate-700">
                  Quantity
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={part.quantity}
                    onChange={(event) =>
                      onChange(
                        parts.map((entry, position) =>
                          position === index
                            ? { ...entry, quantity: Number(event.target.value) }
                            : entry,
                        ),
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-lg"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Serial / batch
                  <input
                    value={part.serialOrBatch ?? ''}
                    onChange={(event) =>
                      onChange(
                        parts.map((entry, position) =>
                          position === index
                            ? { ...entry, serialOrBatch: event.target.value || null }
                            : entry,
                        ),
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}

      {catalogue.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No parts catalogue on this phone. Sync when you have signal.
        </p>
      ) : (
        <div className="mt-3 flex gap-2">
          <select
            aria-label="Part used"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="">Choose a part…</option>
            {catalogue.map((part) => (
              <option key={part.partNumber} value={part.partNumber}>
                {part.partNumber} — {part.description}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={add}
            disabled={!choice}
            className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-900 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}
    </section>
  )
}

function groupChecklist(
  items: TechJobDetail['checklist'],
): Array<{ name: string; items: TechJobDetail['checklist'] }> {
  const bySection = new Map<string, TechJobDetail['checklist']>()
  for (const item of items) {
    const list = bySection.get(item.section) ?? []
    list.push(item)
    bySection.set(item.section, list)
  }
  return [...bySection.entries()].map(([name, list]) => ({ name, items: list }))
}

/** Downscale to something a site phone can upload: 1600px on the long edge, JPEG. */
async function compressImage(file: File): Promise<{
  dataUrl: string
  mimeType: 'image/jpeg'
  sizeBytes: number
}> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No canvas.')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
  return {
    dataUrl,
    mimeType: 'image/jpeg',
    sizeBytes: Math.max(1, Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)),
  }
}
