'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { formValuesNested } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { archiveSite, updateSite } from '@/server/sites/sites'

/**
 * Site mutations from the site's own page. Creating a site happens on the customer page, because a
 * site has no meaning without the customer it belongs to.
 */

export async function updateSiteFromSiteAction(
  customerId: string,
  siteId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await updateSite(await requireAuth(), siteId, { ...formValuesNested(formData), customerId })
    revalidatePath(`/sites/${siteId}`)
    revalidatePath(`/customers/${customerId}`)
  }, 'Site saved.')
}

export async function archiveSiteAction(
  customerId: string,
  siteId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  void formData

  const state = await runAction(async () => {
    await archiveSite(await requireAuth(), siteId)
    revalidatePath(`/customers/${customerId}`)
  }, 'Site archived.')

  if (state.ok) redirect(`/customers/${customerId}`)
  return state
}
