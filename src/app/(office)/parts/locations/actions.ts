'use server'

import { revalidatePath } from 'next/cache'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { createLocation, updateLocation } from '@/server/inventory/locations'

/** Location admin (slice 23). Thin: form → object → service → revalidate. */

export async function createLocationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await createLocation(await requireAuth(), formValues(formData))
    revalidatePath('/parts/locations')
  }, 'Location added.')
}

export async function updateLocationAction(
  locationId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await updateLocation(await requireAuth(), locationId, formValues(formData))
    revalidatePath('/parts/locations')
  }, 'Location saved.')
}
