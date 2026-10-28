import { db } from '@/lib/db'
import { parseInput } from '@/lib/validation/parse'
import {
  CERTIFICATE_UPLOAD_TYPES,
  certificateUploadSchema,
} from '@/lib/validation/certificates'
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  fileUploadSchema,
  type FileUploadInput,
} from '@/lib/validation/reports'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/auth/errors'
import { assertCan } from '@/server/auth/permissions'
import { craneReadWhere, jobReadWhere } from '@/server/auth/scope'
import type { AuthContext } from '@/server/auth/types'
import { storage } from './storage'

/**
 * Photos, signatures and certificate scans.
 *
 * The phone asks for a URL, uploads the bytes straight to storage, then refers to the File row by id
 * when it submits the report. The id is generated on the client so a retried upload updates the same
 * row rather than leaving an orphan behind. Certificates take the same path from the office, because
 * Vercel caps a function request body at 4.5 MB and a scanned PDF is close to it.
 */

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
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
  // One route, two flavours: a phone report's photograph or signature, and an office certificate
  // scan. They differ in permission, owner and allowed types, so each gets its own schema rather
  // than one schema with every field optional.
  if ((raw as { kind?: unknown } | null)?.kind === 'CERTIFICATE') {
    return requestCertificateUpload(context, raw)
  }

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
 * A scan or photograph of a certificate, uploaded from the office. The File row is owned by the crane
 * (`entity: 'Crane'`) so it survives independently of whichever certificate record refers to it; the
 * certificate write then checks the file really is a certificate for that same crane.
 */
async function requestCertificateUpload(
  context: AuthContext,
  raw: unknown,
): Promise<UploadTicket> {
  assertCan(context, 'certificate.write')
  const input = parseInput(certificateUploadSchema, raw)

  const crane = await db.crane.findFirst({
    where: { id: input.craneId, ...craneReadWhere(context) },
    select: { id: true },
  })
  if (!crane) throw new NotFoundError('No such crane.')

  const extension = EXTENSIONS[input.mimeType]!
  const storageKey = `cranes/${crane.id}/certificates/${input.id}.${extension}`

  const existing = await db.file.findUnique({ where: { id: input.id } })
  if (existing) {
    if (existing.uploadedById !== context.userId || existing.entityId !== input.craneId) {
      throw new ForbiddenError('That upload belongs to somebody else.')
    }
    // Re-uploading with the same id is how a retry and a "chose the wrong file" both work. The key
    // can change here (a PDF replaced by a photograph), so the row follows the new key or the
    // certificate would point at bytes that never arrive.
    await db.file.update({
      where: { id: input.id },
      data: {
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey,
      },
    })
  } else {
    await db.file.create({
      data: {
        id: input.id,
        entity: 'Crane',
        entityId: input.craneId,
        kind: 'CERTIFICATE',
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey,
        uploadedById: context.userId,
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

  const file = await db.file.findFirst({ where: { storageKey: key, deletedAt: null } })
  if (!file) throw new NotFoundError('No such upload.')

  // A certificate is usually a PDF; a report photograph never is. Which set applies is decided by
  // the File row, not by the request, because the client's claimed type is not a trust boundary.
  const allowed: readonly string[] =
    file.kind === 'CERTIFICATE' ? CERTIFICATE_UPLOAD_TYPES : ALLOWED_UPLOAD_TYPES
  if (!allowed.includes(contentType)) {
    throw new ValidationError({ file: ['That file type is not accepted.'] })
  }

  await storage().put(key, bytes, contentType)
  await db.file.update({
    where: { id: file.id },
    data: { sizeBytes: bytes.byteLength, mimeType: contentType },
  })
}

export type { FileUploadInput }
