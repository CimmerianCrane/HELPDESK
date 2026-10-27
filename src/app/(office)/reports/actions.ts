'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { formValues } from '@/lib/validation/parse'
import { runAction, toFormState, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import {
  amendReport,
  approveReport,
  returnReport,
  submitAmendment,
} from '@/server/reports/approval'

/**
 * The report queue's actions: form → service → revalidate. Every rule, including who may decide, is
 * in the service (CLAUDE.md rule 1).
 */

export async function approveReportAction(
  reportId: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  let message = 'Report approved and issued.'

  try {
    const result = await approveReport(await requireAuth(), reportId)
    message = result.emailedToCustomerAt
      ? `Issued as ${result.documentNumber} and emailed to the customer.`
      : `Issued as ${result.documentNumber}. ${result.emailSkippedReason ?? ''}`.trim()
    revalidatePath('/reports')
    revalidatePath(`/reports/${reportId}`)
  } catch (error) {
    return toFormState(error)
  }

  return { ok: true, message }
}

export async function returnReportAction(
  reportId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData)

  const state = await runAction(async () => {
    await returnReport(await requireAuth(), reportId, { reason: values.reason })
    revalidatePath('/reports')
    revalidatePath(`/reports/${reportId}`)
  }, 'Report sent back for correction.')

  if (state.ok) redirect(`/reports/${reportId}`)
  return state
}

export async function amendReportAction(
  reportId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData)
  let amendmentId: string | undefined

  const state = await runAction(async () => {
    const result = await amendReport(await requireAuth(), {
      reportId,
      reason: values.reason,
    })
    amendmentId = result.amendmentId
    revalidatePath(`/reports/${reportId}`)
  }, 'Amendment started.')

  if (state.ok && amendmentId) redirect(`/reports/${amendmentId}`)
  return state
}

export async function submitAmendmentAction(
  reportId: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await submitAmendment(await requireAuth(), reportId)
    revalidatePath('/reports')
    revalidatePath(`/reports/${reportId}`)
  }, 'Amendment submitted for approval.')
}
