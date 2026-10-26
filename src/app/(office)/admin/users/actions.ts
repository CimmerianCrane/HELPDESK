'use server'

import { revalidatePath } from 'next/cache'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { createUser, setUserPassword, updateUser } from '@/server/users/users'

/**
 * Thin by design: turn the form into a plain object, hand it to the service, revalidate. The
 * permission check lives inside the service, so it cannot be skipped by calling the service from
 * somewhere else later.
 */

export async function createUserAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return runAction(async () => {
    await createUser(await requireAuth(), formValues(formData))
    revalidatePath('/admin/users')
  }, 'User created.')
}

export async function updateUserAction(
  userId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await updateUser(await requireAuth(), userId, formValues(formData))
    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${userId}`)
  }, 'Saved.')
}

export async function setUserPasswordAction(
  userId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await setUserPassword(await requireAuth(), userId, formValues(formData))
  }, 'Password set. Pass it on and ask them to change it after signing in.')
}
