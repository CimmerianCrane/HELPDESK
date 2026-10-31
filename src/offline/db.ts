'use client'

import Dexie, { type Table } from 'dexie'
import type { ChecklistAnswer, ComponentGrade } from '@/lib/validation/reports'
import type {
  SyncBundle,
  TechChecklistItem,
  TechCrane,
  TechJobDetail,
} from '@/server/tech/my-jobs'

/**
 * The phone's own copy of what the server sent.
 *
 * Two things live here that matter more than the schema. First, the cache is *replaced*, never
 * merged: a job the office moved off this technician must disappear from the phone, and a merge
 * would keep it there for ever. Second, the sync timestamp is stored alongside the data rather than
 * derived from it, so a technician can see "as of 08:14" even when the last sync returned nothing.
 *
 * Types are reused from the service rather than restated. A cache that drifts from the thing it
 * caches is a class of bug worth designing out, and `import type` costs nothing at runtime.
 */

export type CachedJob = TechJobDetail

export interface CachedContact {
  /** `siteId:name` — contacts arrive with a site and a name, not an id the phone ever needs. */
  id: string
  siteId: string
  name: string
  role: string
  phone: string | null
  email: string | null
}

export interface CachedPart {
  partNumber: string
  description: string
  uom: string
  /** Wire rope, hooks, chain: the field must record which one went on the crane (slice 24). */
  trackSerialOrBatch: boolean
}

/** One row of the calibration register. Keyed by serial, because that is what an instrument row names. */
export type CachedCalibrationResource = SyncBundle['calibrationResources'][number]

export interface CachedMeta {
  key: string
  value: string
}

export interface DraftPart {
  partNumber: string
  description: string
  quantity: number
  serialOrBatch: string | null
}

/** Everything one report needs, kept in the same shape whether it is a draft or queued. */
export interface DraftPayload {
  /** Client-generated before the phone has any signal; the server stores it as `Report.id`. */
  id: string
  jobId: string
  craneId: string
  templateId: string
  templateVersion: number
  data: Record<string, unknown>
  checklist: Record<string, ChecklistAnswer>
  /** Service Reports only: the 1–5 condition rating on every checklist line, keyed by item code. */
  grades: Record<string, ComponentGrade>
  parts: DraftPart[]
  /** Local file ids, resolved to server File ids only when the item is flushed. */
  photoIds: string[]
  technicianSignerName: string
  technicianSignatureId: string | null
  customerSignerName: string
  customerSignerDesignation: string
  customerSignatureId: string | null
  customerDeclinedReason: string
}

export interface ReportDraft extends DraftPayload {
  updatedAt: string
}

/**
 * A photo or signature as it exists on the phone. `dataUrl` is the compressed image; it is a Blob in
 * spirit and is kept out of `jobs` so a sync replaces the server data without touching field work.
 */
export interface LocalFile {
  id: string
  jobId: string
  kind: 'PHOTO' | 'SIGNATURE'
  filename: string
  mimeType: string
  sizeBytes: number
  dataUrl: string
  /** Set once the bytes are in storage, so a retry does not upload them again. */
  uploadedAs: string | null
  createdAt: string
}

export interface OutboxItem {
  /** The mutation id: the server's `SyncReceipt` key, which is what makes a replay a no-op. */
  id: string
  kind: 'report.submit'
  jobId: string
  reportId: string
  payload: DraftPayload
  createdAt: string
  attempts: number
  lastError: string | null
}

class TechDatabase extends Dexie {
  jobs!: Table<CachedJob, string>
  cranes!: Table<TechCrane, string>
  checklistItems!: Table<TechChecklistItem, string>
  parts!: Table<CachedPart, string>
  contacts!: Table<CachedContact, string>
  calibrationResources!: Table<CachedCalibrationResource, string>
  meta!: Table<CachedMeta, string>
  drafts!: Table<ReportDraft, string>
  files!: Table<LocalFile, string>
  outbox!: Table<OutboxItem, string>

  constructor() {
    super('cimmerian-tech')
    this.version(1).stores({
      // Only the indexes the screens actually filter on. Storing start dates as ISO strings keeps
      // them sortable as text, which is why the service sends strings rather than dates.
      jobs: 'id, scheduledStart, status',
      cranes: 'assetTag',
      checklistItems: 'code',
      parts: 'partNumber',
      contacts: 'id, siteId',
      meta: 'key',
    })

    // Slice 8: field work that must survive a failed upload, a reload and a closed tab.
    this.version(2).stores({
      drafts: 'id, jobId, craneId, updatedAt',
      files: 'id, jobId, kind',
      outbox: 'id, createdAt',
    })

    // Slice 17: the calibration register, so a load test's instruments can be checked with no signal.
    this.version(3).stores({
      calibrationResources: 'serialNumber',
    })
  }
}

/**
 * One database per browser, shared by every technician who signs in on that phone — so signing out
 * has to clear it. See `clearCache`.
 */
export const techDb = new TechDatabase()

export const LAST_SYNCED_KEY = 'lastSyncedAt'
export const TIMEZONE_KEY = 'timeZone'
export const TECHNICIAN_NAME_KEY = 'technicianName'

/**
 * Replaces the cache in one transaction.
 *
 * Dexie runs this as a single transaction across the cached tables: either the whole bundle lands or
 * none of it does. A half-written cache would show a job whose access notes had been deleted.
 */
export async function storeBundle(bundle: SyncBundle): Promise<void> {
  await techDb.transaction(
    'rw',
    [
      techDb.jobs,
      techDb.cranes,
      techDb.checklistItems,
      techDb.parts,
      techDb.contacts,
      techDb.calibrationResources,
      techDb.meta,
    ],
    async () => {
      await Promise.all([
        techDb.jobs.clear(),
        techDb.cranes.clear(),
        techDb.checklistItems.clear(),
        techDb.parts.clear(),
        techDb.contacts.clear(),
        techDb.calibrationResources.clear(),
      ])

      await Promise.all([
        techDb.jobs.bulkPut(bundle.jobs),
        techDb.cranes.bulkPut(bundle.cranes),
        techDb.checklistItems.bulkPut(bundle.checklistItems),
        techDb.parts.bulkPut(bundle.parts),
        techDb.contacts.bulkPut(
          bundle.contacts.map((contact) => ({
            id: `${contact.siteId}:${contact.name}`,
            ...contact,
          })),
        ),
        techDb.calibrationResources.bulkPut(bundle.calibrationResources),
      ])

      await techDb.meta.bulkPut([
        { key: LAST_SYNCED_KEY, value: bundle.generatedAt },
        { key: TIMEZONE_KEY, value: bundle.timeZone },
        // Kept so a report signed offline carries the name the server would have put on it.
        { key: TECHNICIAN_NAME_KEY, value: bundle.technicianName },
      ])
    },
  )
}

/** Everything the phone knows about one visit, or `undefined` if it has never been synced. */
export async function cachedJob(jobId: string): Promise<CachedJob | undefined> {
  return techDb.jobs.get(jobId)
}

/** Soonest first, the same order the server sends. Undated work goes last. */
export async function cachedJobs(): Promise<CachedJob[]> {
  const jobs = await techDb.jobs.toArray()
  return jobs.sort((a, b) => {
    if (!a.scheduledStart && !b.scheduledStart) return a.number.localeCompare(b.number)
    if (!a.scheduledStart) return 1
    if (!b.scheduledStart) return -1
    return a.scheduledStart.localeCompare(b.scheduledStart)
  })
}

export async function lastSyncedAt(): Promise<Date | null> {
  const row = await techDb.meta.get(LAST_SYNCED_KEY)
  return row?.value ? new Date(row.value) : null
}

/** The operating zone the bundle was built in, so a cached page formats dates as the office does. */
export async function cachedTimeZone(): Promise<string | null> {
  const row = await techDb.meta.get(TIMEZONE_KEY)
  return row?.value || null
}

/**
 * Signing out has to take the data with it. The cache is scoped to a technician by the server when
 * it is written, but there is nothing stopping the next person to sign in on this phone reading
 * what the last one synced — and on a shared site phone that is the normal case, not an edge one.
 */
export async function clearCache(): Promise<void> {
  await techDb.transaction(
    'rw',
    [
      techDb.jobs,
      techDb.cranes,
      techDb.checklistItems,
      techDb.parts,
      techDb.contacts,
      techDb.calibrationResources,
      techDb.meta,
      techDb.drafts,
      techDb.files,
      techDb.outbox,
    ],
    async () => {
      await Promise.all([
        techDb.jobs.clear(),
        techDb.cranes.clear(),
        techDb.checklistItems.clear(),
        techDb.parts.clear(),
        techDb.contacts.clear(),
        techDb.calibrationResources.clear(),
        techDb.meta.clear(),
        techDb.drafts.clear(),
        techDb.files.clear(),
        techDb.outbox.clear(),
      ])
    },
  )
}
