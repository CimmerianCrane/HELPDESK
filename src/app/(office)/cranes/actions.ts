'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { formValuesNested } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import {
  acknowledgeReregistration,
  archiveCrane,
  createCrane,
  restrictCrane,
  unrestrictCrane,
  updateCrane,
} from '@/server/cranes/cranes'

/**
 * Crane mutations. As everywhere else, the permission check is inside the service: these functions
 * only turn a form into an object, call the service, and revalidate.
 */

export async function createCraneAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  let createdId: string | undefined

  const state = await runAction(async () => {
    const crane = await createCrane(await requireAuth(), formValuesNested(formData))
    createdId = crane.id
    revalidatePath('/cranes')
    revalidatePath(`/sites/${crane.site.id}`)
  }, 'Crane added.')

  // The crane now has a QR sticker to print, so go where that lives.
  if (state.ok && createdId) redirect(`/cranes/${createdId}`)
  return state
}

export async function updateCraneAction(
  craneId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    const crane = await updateCrane(await requireAuth(), craneId, formValuesNested(formData))
    revalidatePath('/cranes')
    revalidatePath(`/cranes/${craneId}`)
    revalidatePath(`/sites/${crane.site.id}`)
  }, 'Crane saved.')
}

export async function restrictCraneAction(
  craneId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await restrictCrane(await requireAuth(), craneId, formValuesNested(formData))
    revalidatePath('/cranes')
    revalidatePath(`/cranes/${craneId}`)
  }, 'Crane restricted. It is now marked do not operate.')
}

export async function unrestrictCraneAction(
  craneId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await unrestrictCrane(await requireAuth(), craneId, formValuesNested(formData))
    revalidatePath('/cranes')
    revalidatePath(`/cranes/${craneId}`)
  }, 'Restriction cleared. The crane is back in service.')
}

export async function acknowledgeReregistrationAction(
  craneId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  void formData

  return runAction(async () => {
    await acknowledgeReregistration(await requireAuth(), craneId)
    revalidatePath(`/cranes/${craneId}`)
    revalidatePath('/cranes')
  }, 'Recorded. The check is in the audit log.')
}

export async function archiveCraneAction(
  craneId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  void formData

  const state = await runAction(async () => {
    await archiveCrane(await requireAuth(), craneId)
    revalidatePath('/cranes')
  }, 'Crane archived.')

  if (state.ok) redirect('/cranes')
  return state
}
