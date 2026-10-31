import { errorMessage, logger } from '@/lib/logger'
import { getAuthContext } from '@/server/auth/context'
import { isAppError } from '@/server/auth/errors'
import { subscribePush, unsubscribePush } from '@/server/notify/push'

/**
 * A tablet's push subscription (slice 43).
 *
 * Thin on purpose: both halves live in `src/server/notify/push.ts`, where the ownership rule is
 * tested against real rows. The handler only supplies the caller.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const context = await getAuthContext()
  if (!context) return Response.json({ error: 'You must sign in to do that.' }, { status: 401 })

  try {
    await subscribePush(context, await request.json().catch(() => null))
    return Response.json({ ok: true })
  } catch (error) {
    if (isAppError(error)) {
      return Response.json(
        { error: error.message, fields: 'fields' in error ? error.fields : undefined },
        { status: error.status },
      )
    }
    logger.error('push.subscribe.failed', { error: errorMessage(error) })
    return Response.json({ error: errorMessage(error) }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const context = await getAuthContext()
  if (!context) return Response.json({ error: 'You must sign in to do that.' }, { status: 401 })

  try {
    await unsubscribePush(context, await request.json().catch(() => null))
    return Response.json({ ok: true })
  } catch (error) {
    if (isAppError(error)) return Response.json({ error: error.message }, { status: error.status })
    logger.error('push.unsubscribe.failed', { error: errorMessage(error) })
    return Response.json({ error: errorMessage(error) }, { status: 500 })
  }
}
