'use server'

import { revalidatePath } from 'next/cache'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { markAllNotificationsRead, markNotificationRead } from '@/server/notifications/inbox'

/**
 * Inbox mutations (slice 38). Two writes, both of which only ever touch the caller's own rows — the
 * `notification.read` check and the `userId` scope are in the service, so a direct call gets the same
 * answer as a form.
 *
 * The id is bound by the page (`markReadAction.bind(null, row.id)`) so the button is the same
 * `(state, formData)` shape every other action button in the app uses.
 */

export async function markReadAction(
  notificationId: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await markNotificationRead(await requireAuth(), notificationId)
    revalidatePath('/inbox')
  }, 'Marked read.')
}

export async function markAllReadAction(
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await markAllNotificationsRead(await requireAuth())
    revalidatePath('/inbox')
  }, 'All caught up.')
}
