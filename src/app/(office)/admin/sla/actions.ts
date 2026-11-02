'use server'

import { revalidatePath } from 'next/cache'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { updateCompanySlaTargets } from '@/server/sla/sla'

/**
 * Company-wide SLA targets (slice 30). Thin like every other action: the `sla.manage` check and the
 * audit rows live in the service, so a test calling it directly gets the same answer.
 */
export async function updateCompanySlaAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await updateCompanySlaTargets(await requireAuth(), formValues(formData))
    revalidatePath('/admin/sla')
  }, 'Targets saved.')
}
