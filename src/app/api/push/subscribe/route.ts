import { getAuthContext } from '@/server/auth/context'
import { internalError, isAppError } from '@/server/auth/errors'
import { API_LIMITS, throttle } from '@/server/auth/rate-limit'
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

  const limited = await throttle(context, API_LIMITS.pushSubscribe)
  if (limited) return limited

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
    return internalError(error)
  }
}

export async function DELETE(request: Request) {
  const context = await getAuthContext()
  if (!context) return Response.json({ error: 'You must sign in to do that.' }, { status: 401 })

  const limited = await throttle(context, API_LIMITS.pushSubscribe)
  if (limited) return limited

  try {
    await unsubscribePush(context, await request.json().catch(() => null))
    return Response.json({ ok: true })
  } catch (error) {
    if (isAppError(error)) return Response.json({ error: error.message }, { status: error.status })
    return internalError(error)
  }
}
