import { db } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  fileUploadSchema,
  type FileUploadInput,
} from '@/lib/validation/reports'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { jobReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { storage } from './storage'

/**
 * Photos and signatures.
 *
 * The phone asks for a URL, uploads the bytes straight to storage, then refers to the File row by id
 * when it submits the report. The id is generated on the phone so a retried upload updates the same
 * row rather than leaving an orphan behind.
 */

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export interface UploadTicket {
  fileId: string
  uploadUrl: string
  method: 'PUT'
}

export async function requestUpload(
  context: AuthContext,
  raw: unknown,
): Promise<UploadTicket> {
  assertCan(context, 'report.submit')
  const input = parseInput(fileUploadSchema, raw)

  // A signature is drawn on a canvas, so PNG is the only honest type for it.
  if (input.kind === 'SIGNATURE' && input.mimeType !== 'image/png') {
    throw new ValidationError({ mimeType: ['A signature must be a PNG image.'] })
  }

  const job = await db.job.findFirst({
    where: { id: input.jobId, ...jobReadWhere(context) },
    select: { id: true },
  })
  if (!job) throw new NotFoundError('No such job.')

  const extension = EXTENSIONS[input.mimeType]
  const storageKey = `jobs/${input.jobId}/${input.id}.${extension}`

  const existing = await db.file.findUnique({ where: { id: input.id } })
  if (existing) {
    if (existing.uploadedById !== context.userId || existing.jobId !== input.jobId) {
      throw new ForbiddenError('That upload belongs to somebody else.')
    }
  } else {
    await db.file.create({
      data: {
        id: input.id,
        // Files are attached to the job while the report is still a draft. The report refers to
        // them when it is submitted; the job owns the bytes either way.
        entity: 'Job',
        entityId: input.jobId,
        kind: input.kind,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey,
        uploadedById: context.userId,
        jobId: input.jobId,
      },
    })
  }

  const ticket = await storage().signedUploadUrl(storageKey, input.mimeType)
  return { fileId: input.id, uploadUrl: ticket.url, method: ticket.method }
}

/**
 * The disk driver's upload endpoint calls this after the bytes arrive. Size and type are checked
 * again here because the client is not a trust boundary — the declared values in the File row are
 * only what the phone claimed.
 */
export async function completeUpload(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  if (bytes.byteLength === 0) throw new ValidationError({ file: ['The file is empty.'] })
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new ValidationError({ file: ['Files must be 5 MB or smaller.'] })
  }
  if (!ALLOWED_UPLOAD_TYPES.includes(contentType as (typeof ALLOWED_UPLOAD_TYPES)[number])) {
    throw new ValidationError({ file: ['That file type is not accepted.'] })
  }

  const file = await db.file.findFirst({ where: { storageKey: key, deletedAt: null } })
  if (!file) throw new NotFoundError('No such upload.')

  await storage().put(key, bytes, contentType)
  await db.file.update({
    where: { id: file.id },
    data: { sizeBytes: bytes.byteLength, mimeType: contentType },
  })
}

export type { FileUploadInput }
