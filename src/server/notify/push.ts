import webpush from 'web-push'
import { db, type Tx } from '@/lib/db'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { deletePushSubscriptionSchema, pushSubscriptionSchema } from '@/lib/validation/push'
import { ForbiddenError, ValidationError } from '@/server/auth/errors'
import type { AuthContext } from '@/server/auth/types'

/**
 * Web Push to technicians' tablets (slice 43).
 *
 * The same seam as the email and message adapters: a send returns an outcome rather than throwing,
 * because a tablet that cannot be reached must not roll back a dispatch. Push is off entirely until
 * VAPID is configured, and off is the default — a deployment that never sets the keys behaves as it
 * did before this file existed.
 *
 * Recipients are users, not subscriptions: a technician with the app installed on two tablets gets it
 * on both, which is what they expect. Only technicians are pushed to — a dispatcher works at a desk
 * and the P1 alerts already reach them in-app and by email.
 */

let configured: boolean | undefined

/** Configures VAPID once per process. Returns false when push is not set up. */
function ready(): boolean {
  if (configured !== undefined) return configured
  const { NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env()
  if (!NEXT_PUBLIC_VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    configured = false
    return false
  }
  webpush.setVapidDetails(VAPID_SUBJECT, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  configured = true
  return true
}

/** Whether tablet push is configured — read by the permission card so it never asks for nothing. */
export function pushConfigured(): boolean {
  const { NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env()
  return Boolean(NEXT_PUBLIC_VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT)
}

/**
 * Same-origin and inside `/m/`, which is the only thing a tablet notification may open. Kept here
 * rather than in the worker so the rule is written once; the worker re-checks it because a
 * notification tap leaves the app no chance to validate anything afterwards.
 */
export function isAppLink(link: string): boolean {
  if (!link.startsWith('/') || link.startsWith('//')) return false
  // Resolved, not just prefix-checked: `/m/../dashboard` starts with `/m/` and is the dashboard.
  return new URL(link, 'https://app.invalid').pathname.startsWith('/m/')
}

export interface PushMessage {
  title: string
  body: string
  /** App-relative, e.g. `/m/jobs/<id>`. Validated before it is put in a notification. */
  link: string
  /** Collapses repeats of the same thing — a re-dispatch replaces the first banner, not stacks. */
  tag?: string
}

export interface PushOutcome {
  userId: string
  ok: boolean
  error: string | null
}

/**
 * Sends to every enabled subscription of these users, recording an outcome per subscription.
 *
 * 404 and 410 mean the endpoint is gone — the app was uninstalled, or the browser dropped it. That
 * is not a failure worth retrying and not a reason to fail the dispatch: the row is disabled and the
 * user is simply not reachable on that device any more. Every other failure increments a count and
 * leaves the row enabled, because a push service that is briefly down is not a dead tablet.
 */
export async function sendPushToUsers(
  userIds: string[],
  message: PushMessage,
  client: Tx = db,
): Promise<PushOutcome[]> {
  if (!ready() || userIds.length === 0) return []
  if (!isAppLink(message.link)) {
    // Never open a notification at an origin the app does not own, or at an office route from a
    // technician's notification.
    logger.warn('push.link-refused', { link: message.link })
    return []
  }

  const subscriptions = await client.pushSubscription.findMany({
    where: { userId: { in: userIds }, disabledAt: null },
    select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
  })

  const payload = JSON.stringify(message)
  const outcomes: PushOutcome[] = []

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
        // A notification about a job is only useful for the shift it is about. A push service that
        // has not delivered it in a day is not going to be believed by the technician anyway.
        { TTL: 24 * 60 * 60 },
      )
      await client.pushSubscription.update({
        where: { id: subscription.id },
        data: { lastSeenAt: new Date(), failureCount: 0 },
      })
      outcomes.push({ userId: subscription.userId, ok: true, error: null })
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      const gone = status === 404 || status === 410
      await client.pushSubscription.update({
        where: { id: subscription.id },
        data: gone
          ? { disabledAt: new Date(), failureCount: { increment: 1 } }
          : { failureCount: { increment: 1 } },
      })
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('push.send.failed', { userId: subscription.userId, status, gone, error: message })
      outcomes.push({ userId: subscription.userId, ok: false, error: message })
    }
  }

  return outcomes
}

/**
 * Registers a tablet. The subscription always belongs to the caller: the body carries an endpoint
 * and two keys and nothing that names a user, so there is no id to swap and no way to subscribe
 * somebody else's tablet to your dispatches.
 */
export async function subscribePush(
  context: AuthContext,
  input: unknown,
  client: Tx = db,
): Promise<void> {
  // Push is a technician's channel; an office login has no tablet job list to open.
  if (!context.technicianId) throw new ForbiddenError('Only technicians receive job alerts.')

  const parsed = pushSubscriptionSchema.safeParse(input)
  if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors)

  const { endpoint, keys } = parsed.data
  await client.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId: context.userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: context.userAgent,
    },
    // Reassign on conflict: a shared tablet has a new owner, and the old one must stop getting this
    // device's alerts. Re-enabled, because a returning technician is a live subscription.
    update: {
      userId: context.userId,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: context.userAgent,
      lastSeenAt: new Date(),
      failureCount: 0,
      disabledAt: null,
    },
  })
}

/** Ends this browser's alerts. Scoped to the caller: somebody else's endpoint is not theirs to delete. */
export async function unsubscribePush(
  context: AuthContext,
  input: unknown,
  client: Tx = db,
): Promise<void> {
  const parsed = deletePushSubscriptionSchema.safeParse(input)
  if (!parsed.success) throw new ValidationError({ endpoint: ['A subscription endpoint is required.'] })

  await client.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, userId: context.userId },
  })
}
