'use server'

import { revalidatePath } from 'next/cache'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { createResource, updateResource } from '@/server/calibrations/calibrations'

/**
 * Calibration register mutations (slice 34). Thin: form → object → service → revalidate, the way
 * every action here is. The `resource.write` check lives in the service, so a direct call gets the
 * same answer as the form.
 */

export async function createResourceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await createResource(await requireAuth(), formValues(formData))
    revalidatePath('/calibrations')
    revalidatePath('/schedule/roster')
  }, 'Equipment added.')
}

export async function updateResourceAction(
  resourceId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await updateResource(await requireAuth(), resourceId, formValues(formData))
    revalidatePath('/calibrations')
    revalidatePath('/schedule/roster')
  }, 'Calibration saved.')
}
