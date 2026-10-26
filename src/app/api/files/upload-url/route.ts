import { errorMessage } from '@/lib/logger'
import { getAuthContext } from '@/server/auth/context'
import { isAppError } from '@/server/auth/errors'
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
    return Response.json({ error: errorMessage(error) }, { status: 500 })
  }
}
