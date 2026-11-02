import { getAuthContext } from '@/server/auth/context'
import { internalError, isAppError } from '@/server/auth/errors'
import { API_LIMITS, throttle } from '@/server/auth/rate-limit'
import { requestUpload } from '@/server/storage/files'

/**
 * Issues a short-lived URL the phone uploads one photo or signature to.
 *
 * The bytes never pass through this handler in production: the URL points at Supabase Storage.
 * Locally it points at `/api/files/store`, which is the same flow against the disk.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const context = await getAuthContext()
  if (!context) {
    return Response.json({ error: 'You must sign in to upload.' }, { status: 401 })
  }

  const limited = await throttle(context, API_LIMITS.uploadUrl)
  if (limited) return limited

  try {
    const ticket = await requestUpload(context, await request.json())
    return Response.json(ticket)
  } catch (error) {
    if (isAppError(error)) {
      return Response.json(
        { error: error.message, code: error.code, fields: 'fields' in error ? error.fields : undefined },
        { status: error.status },
      )
    }
    return internalError(error)
  }
}
