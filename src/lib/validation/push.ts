import { z } from 'zod'

/**
 * A push subscription as the browser hands it over (slice 43).
 *
 * The endpoint is a URL the push service owns, and the two keys are base64url. They are checked for
 * shape rather than length: web-push does the real crypto check when it sends, and a key it cannot
 * use fails loudly there. Everything except the endpoint is required — a subscription with no keys
 * cannot be encrypted to, so accepting it would only defer the failure to dispatch time.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
})

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>

export const deletePushSubscriptionSchema = z.object({ endpoint: z.string().url().max(2048) })
