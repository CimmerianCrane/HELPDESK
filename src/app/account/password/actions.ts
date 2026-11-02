'use server'

import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { changeOwnPassword } from '@/server/users/users'

/**
 * A user changing their own password. The identity comes from the session, never from the form, and
 * the service verifies the current password before writing — so a form left open on a shared tablet
 * cannot be used to take the account over.
 */
export async function changePasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await changeOwnPassword(await requireAuth(), formValues(formData))
  }, 'Password changed. Every other device signed in with the old one has been signed out.')
}
