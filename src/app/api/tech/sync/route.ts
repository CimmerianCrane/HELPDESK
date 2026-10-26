import { errorMessage } from '@/lib/logger'
import { getAuthContext } from '@/server/auth/context'
import { isAppError } from '@/server/auth/errors'
import { syncBundle } from '@/server/tech/my-jobs'

/**
 * One call that fills a technician's phone.
 *
 * The app shell and the data are cached separately on purpose. The service worker keeps the pages
 * so the app opens in a basement; this keeps the *content* those pages show, and it is the only
 * place the phone learns anything from the server, so the authorization check is here or nowhere.
 *
 * Never cached by any layer — a stale bundle served from a proxy would be indistinguishable from a
 * successful sync, which is exactly the failure the technician would never notice.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const context = await getAuthContext()
  if (!context) {
    return Response.json({ error: 'You must sign in to sync.' }, { status: 401 })
  }

  try {
    const bundle = await syncBundle(context)
    return Response.json(bundle, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    if (isAppError(error)) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status })
    }
    return Response.json({ error: errorMessage(error) }, { status: 500 })
  }
}
