'use client'

import { techDb, type OutboxItem } from './db'

/**
 * Uploading the queue (slice 8).
 *
 * Order matters and is the whole design: photos and signatures go up first, one at a time, and only
 * then does the report describing them get submitted. A report that names a file the server has
 * never seen is rejected, so the files must be in storage before the payload moves.
 *
 * Every id here was generated on the phone. The upload URL call upserts the same `File` row and the
 * submit call writes a `SyncReceipt`, so an attempt whose answer never made it back is safe to
 * repeat: the second attempt uploads nothing new and creates no second report.
 */

interface UploadTicket {
  fileId: string
  uploadUrl: string
  method: string
}

export interface FlushResult {
  sent: number
  failed: number
  /** Server messages, for the sync banner. The queued work stays on the phone either way. */
  errors: string[]
  /** The session has ended. Saying so is better than a line that reads as "no signal". */
  sessionExpired: boolean
}

const MAX_BATCH = 20

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'The upload failed.'
}

/** An upload the server refused because the session is gone, rather than because of the work. */
class SessionExpiredError extends Error {}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.status === 401 || response.status === 403) {
    throw new SessionExpiredError('Your session has ended. Sign in again to send this report.')
  }
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'The server refused the upload.')
  }
  return data
}

/** Puts one local photo or signature into storage. Already-uploaded bytes are left alone. */
async function uploadFile(id: string): Promise<void> {
  const file = await techDb.files.get(id)
  if (!file) throw new Error('A photo or signature is missing from this phone.')
  if (file.uploadedAs) return

  const ticket = (await postJson('/api/files/upload-url', {
    id: file.id,
    jobId: file.jobId,
    kind: file.kind,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
  })) as unknown as UploadTicket

  const blob = await (await fetch(file.dataUrl)).blob()
  const put = await fetch(ticket.uploadUrl, {
    method: ticket.method,
    headers: { 'content-type': file.mimeType },
    body: blob,
  })
  if (!put.ok) throw new Error('A photo did not upload. It is still on this phone; try again.')

  await techDb.files.update(file.id, { uploadedAs: ticket.fileId })
}

/** The stored draft, in the shape the sync endpoint accepts, with its bytes in storage. */
async function prepare(item: OutboxItem): Promise<unknown> {
  const { payload } = item
  const ids = [
    ...payload.photoIds,
    ...(payload.technicianSignatureId ? [payload.technicianSignatureId] : []),
    ...(payload.customerSignatureId ? [payload.customerSignatureId] : []),
  ]
  for (const id of ids) await uploadFile(id)

  return {
    reportId: payload.id,
    jobId: payload.jobId,
    craneId: payload.craneId,
    templateId: payload.templateId,
    templateVersion: payload.templateVersion,
    data: payload.data,
    checklist: payload.checklist,
    parts: payload.parts.map((part) => ({
      partNumber: part.partNumber,
      quantity: part.quantity,
      serialOrBatch: part.serialOrBatch,
    })),
    photoFileIds: payload.photoIds,
    technicianSignerName: payload.technicianSignerName,
    technicianSignatureFileId: payload.technicianSignatureId,
    customerSignerName: payload.customerSignerName || null,
    customerSignerDesignation: payload.customerSignerDesignation || null,
    customerSignatureFileId: payload.customerSignatureId,
    customerDeclinedReason: payload.customerDeclinedReason || null,
  }
}

async function keepFailed(item: OutboxItem, reason: string): Promise<void> {
  await techDb.outbox.update(item.id, {
    attempts: item.attempts + 1,
    lastError: reason,
  })
}

/** The server has it: the local copies can go. */
async function finish(item: OutboxItem): Promise<void> {
  const ids = [
    ...item.payload.photoIds,
    ...(item.payload.technicianSignatureId ? [item.payload.technicianSignatureId] : []),
    ...(item.payload.customerSignatureId ? [item.payload.customerSignatureId] : []),
  ]
  await techDb.transaction('rw', [techDb.outbox, techDb.drafts, techDb.files], async () => {
    await techDb.outbox.delete(item.id)
    await techDb.drafts.delete(item.reportId)
    if (ids.length > 0) await techDb.files.bulkDelete(ids)
  })
}

/**
 * Sends everything queued. Safe to call when there is no signal — the items simply stay put.
 *
 * Reports go up in date order, which is the order they were filled in and the order the office
 * expects to read them.
 */
let inFlight: Promise<FlushResult> | null = null

export function flushOutbox(): Promise<FlushResult> {
  // The form sends on submit and the provider sends on reconnect; one queue, one sender.
  if (!inFlight) inFlight = run().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function run(): Promise<FlushResult> {
  const items = await techDb.outbox.orderBy('createdAt').toArray()
  const outcome: FlushResult = { sent: 0, failed: 0, errors: [], sessionExpired: false }
  if (items.length === 0) return outcome

  for (let index = 0; index < items.length; index += MAX_BATCH) {
    const batch = items.slice(index, index + MAX_BATCH)
    const prepared: Array<{ item: OutboxItem; payload: unknown }> = []

    // One unphotographed report must not stop the others, so a failed preparation is recorded
    // against that item and the rest of the batch still goes.
    for (const item of batch) {
      try {
        prepared.push({ item, payload: await prepare(item) })
      } catch (error) {
        // A dead session is not this item's fault: the rest of the queue would fail the same way,
        // and burning its retry count would make the report look broken once the technician signs
        // back in. Nothing is counted; the queue stays exactly as it was.
        if (error instanceof SessionExpiredError) return { ...outcome, sessionExpired: true }
        const reason = messageOf(error)
        await keepFailed(item, reason)
        outcome.failed += 1
        outcome.errors.push(reason)
      }
    }
    if (prepared.length === 0) continue

    let applied: Array<{ id: string; ok: boolean; error?: string }>
    try {
      const data = await postJson('/api/tech/sync', {
        items: prepared.map(({ item, payload }) => ({ id: item.id, kind: item.kind, payload })),
      })
      applied = (data.results as typeof applied) ?? []
    } catch (error) {
      if (error instanceof SessionExpiredError) return { ...outcome, sessionExpired: true }
      // The batch never reached the server: leave it queued rather than pretending it failed
      // item by item. The next sync tries the same ids again.
      const reason = messageOf(error)
      for (const { item } of prepared) await keepFailed(item, reason)
      outcome.failed += prepared.length
      outcome.errors.push(reason)
      continue
    }

    for (const result of applied) {
      const entry = prepared.find(({ item }) => item.id === result.id)
      if (!entry) continue
      if (result.ok) {
        await finish(entry.item)
        outcome.sent += 1
      } else {
        const reason = result.error ?? 'The server refused this report.'
        await keepFailed(entry.item, reason)
        outcome.failed += 1
        outcome.errors.push(reason)
      }
    }
  }

  return outcome
}

export async function pendingCount(): Promise<number> {
  return techDb.outbox.count()
}
