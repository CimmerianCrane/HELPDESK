import { env } from '@/lib/env'
import { errorMessage } from '@/lib/logger'
import { MAX_UPLOAD_BYTES } from '@/lib/validation/reports'
import { isAppError } from '@/server/auth/errors'
import { completeUpload } from '@/server/storage/files'
import { isSafeStorageKey, verifyUploadToken } from '@/server/storage/storage'

/**
 * The disk driver's upload endpoint. The signed token is the capability — no session is required,
 * which is the point of a signed URL and what lets this shape match Supabase's in production.
 */
export const dynamic = 'force-dynamic'

export async function PUT(request: Request) {
  const url = new URL(request.url)
  const key = url.searchParams.get('key') ?? ''
  const token = url.searchParams.get('token') ?? ''
  const secret = env().AUTH_SECRET

  if (!secret || !isSafeStorageKey(key) || !verifyUploadToken(key, token, secret)) {
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
