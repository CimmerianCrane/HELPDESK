'use server'

import { revalidatePath } from 'next/cache'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import {
  archiveSchedule,
  createSchedule,
  updateSchedule,
} from '@/server/schedules/schedules'

/**
 * Schedule mutations (slice 12). Thin, as everywhere: form → object → service → revalidate. The
 * `schedule.manage` check lives in the service, so a call from a test gets the same answer.
 */

export async function createScheduleAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    const schedule = await createSchedule(await requireAuth(), formValues(formData))
    revalidatePath(`/cranes/${schedule.crane.id}`)
    revalidatePath('/schedules')
    revalidatePath('/dashboard')
  }, 'Schedule added.')
}

export async function updateScheduleAction(
  scheduleId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    const schedule = await updateSchedule(await requireAuth(), scheduleId, formValues(formData))
    revalidatePath(`/cranes/${schedule.crane.id}`)
    revalidatePath('/schedules')
    revalidatePath('/dashboard')
  }, 'Schedule saved.')
}

/**
 * Archived from the crane page, where the crane id is already known, so both paths are revalidated
 * here rather than the action needing to return the row it just soft-deleted.
 */
export async function archiveScheduleAction(
  scheduleId: string,
  craneId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  void formData

  return runAction(async () => {
    await archiveSchedule(await requireAuth(), scheduleId)
    revalidatePath(`/cranes/${craneId}`)
    revalidatePath('/schedules')
    revalidatePath('/dashboard')
  }, 'Schedule ended. Its history stays in the audit log.')
}
