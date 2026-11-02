'use server'

import { revalidatePath } from 'next/cache'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { deleteJobFilter, saveJobFilter } from '@/server/jobs/saved-filters'

/**
 * Saved job-list filters. The query is posted as a hidden field holding the current address bar, so
 * saving is "keep this exactly as it is" rather than "keep the filters you ticked" — the two would
 * drift the moment the list gains a filter.
 */

export async function saveJobFilterAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await saveJobFilter(await requireAuth(), formValues(formData))
    revalidatePath('/jobs')
  }, 'Filter saved.')
}

export async function deleteJobFilterAction(filterId: string): Promise<void> {
  await deleteJobFilter(await requireAuth(), filterId)
  revalidatePath('/jobs')
}
