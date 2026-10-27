import { env } from '@/lib/env'
import { errorMessage } from '@/lib/logger'
import { MAX_UPLOAD_BYTES } from '@/lib/validation/reports'
import { isAppError } from '@/server/auth/errors'
import { completeUpload } from '@/server/storage/files'
import { isSafeStorageKey, storage, verifyUploadToken } from '@/server/storage/storage'

/**
 * The disk driver's storage endpoint, both directions.
 *
 * The signed token is the capability — no session is required, which is the point of a signed URL and
 * what lets this shape match Supabase's in production. The purpose is signed into the token, so an
 * upload grant cannot be replayed as a download grant or the other way round.
 */
export const dynamic = 'force-dynamic'

export async function PUT(request: Request) {
  const url = new URL(request.url)
  const key = url.searchParams.get('key') ?? ''
  const token = url.searchParams.get('token') ?? ''
  const secret = env().AUTH_SECRET

  if (!secret || !isSafeStorageKey(key) || !verifyUploadToken(key, token, secret, Date.now(), 'upload')) {
    return Response.json({ error: 'This upload link is invalid or has expired.' }, { status: 403 })
  }

  if (Number(request.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES) {
    return Response.json({ error: 'Files must be 5 MB or smaller.' }, { status: 413 })
  }

  try {
    const bytes = new Uint8Array(await request.arrayBuffer())
    const contentType = (request.headers.get('content-type') ?? '').split(';')[0]!.trim()
    await completeUpload(key, bytes, contentType)
    return Response.json({ ok: true })
  } catch (error) {
    if (isAppError(error)) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    return Response.json({ error: errorMessage(error) }, { status: 500 })
  }
}

/**
 * The `disk` driver's download counterpart. Only used for a URL handed out by
 * `signedDownloadUrl`, which is why it needs no session and carries the same 15-minute expiry.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const key = url.searchParams.get('key') ?? ''
  const token = url.searchParams.get('token') ?? ''
  const secret = env().AUTH_SECRET

  if (!secret || !isSafeStorageKey(key) || !verifyUploadToken(key, token, secret, Date.now(), 'download')) {
    return Response.json({ error: 'This download link is invalid or has expired.' }, { status: 403 })
  }

  try {
    const bytes = await storage().get(key)
    return new Response(new Uint8Array(bytes).buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'private, max-age=900',
      },
    })
  } catch {
    return Response.json({ error: 'That file is not available.' }, { status: 404 })
  }
}
