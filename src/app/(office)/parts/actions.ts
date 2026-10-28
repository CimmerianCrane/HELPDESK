'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { createPart, postStockEntry, transferStock, updatePart } from '@/server/inventory/parts'

/**
 * Thin by design: form to plain object, service, revalidate. Permissions live in the services.
 * The stock entry is posted against a part id, so it revalidates both the part and the book — the
 * on-hand figure moved, and so did the "below reorder" count on the list.
 */

export async function createPartAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  let createdId: string | undefined

  const state = await runAction(async () => {
    const part = await createPart(await requireAuth(), formValues(formData))
    createdId = part.id
    revalidatePath('/parts')
  }, 'Part added.')

  if (state.ok && createdId) redirect(`/parts/${createdId}`)
  return state
}

export async function updatePartAction(
  partId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await updatePart(await requireAuth(), partId, formValues(formData))
    revalidatePath('/parts')
    revalidatePath(`/parts/${partId}`)
  }, 'Saved.')
}

export async function postStockAction(
  partId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await postStockEntry(await requireAuth(), partId, formValues(formData))
    revalidatePath('/parts')
    revalidatePath(`/parts/${partId}`)
  }, 'Stock movement posted.')
}

/** A transfer moves the same total between two shelves, so the book's line count does not change. */
export async function transferStockAction(
  partId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await transferStock(await requireAuth(), partId, formValues(formData))
    revalidatePath('/parts')
    revalidatePath(`/parts/${partId}`)
    revalidatePath('/parts/locations')
  }, 'Stock transferred.')
}
