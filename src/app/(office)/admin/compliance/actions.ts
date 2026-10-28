'use server'

import { revalidatePath } from 'next/cache'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { createComplianceRule, updateComplianceRule } from '@/server/compliance/rules'

/**
 * Compliance rule mutations (slice 14). Thin like every other action: the `compliancerule.manage`
 * check and the audit row live in the service, so a test calling it directly gets the same answer.
 */

export async function createComplianceRuleAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await createComplianceRule(await requireAuth(), formValues(formData))
    revalidatePath('/admin/compliance')
  }, 'Rule added.')
}

export async function updateComplianceRuleAction(
  ruleId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await updateComplianceRule(await requireAuth(), ruleId, formValues(formData))
    revalidatePath('/admin/compliance')
  }, 'Rule saved.')
}
