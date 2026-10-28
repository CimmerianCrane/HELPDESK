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
import {
  acknowledgeDecline,
  createFollowUpJob,
  updateFindingStatus,
} from '@/server/findings/findings'

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

/**
 * The findings on a report (slice 16). Each form knows its own finding, and every door revalidates
 * the report the finding was read from as well as the job a follow-up may have raised.
 */
function revalidateFinding(reportId: string, jobId?: string) {
  revalidatePath('/reports')
  revalidatePath(`/reports/${reportId}`)
  revalidatePath('/cranes')
  if (jobId) {
    revalidatePath('/jobs')
    revalidatePath(`/jobs/${jobId}`)
  }
}

export async function updateFindingStatusAction(
  findingId: string,
  reportId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await updateFindingStatus(await requireAuth(), findingId, formValues(formData))
    revalidateFinding(reportId)
  }, 'Finding updated.')
}

export async function acknowledgeDeclineAction(
  findingId: string,
  reportId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await acknowledgeDecline(await requireAuth(), findingId, formValues(formData))
    revalidateFinding(reportId)
  }, 'Decline recorded, with the customer’s signature.')
}

/**
 * One click, then straight to the job it raised. The office has already said what kind of work and
 * how urgent on the form; the finding decides the crane and drafts the description.
 */
export async function createFollowUpJobAction(
  findingId: string,
  reportId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  let jobId: string | undefined

  const state = await runAction(async () => {
    const result = await createFollowUpJob(await requireAuth(), {
      ...formValues(formData),
      findingId,
    })
    jobId = result.jobId
    revalidateFinding(reportId, result.jobId)
  }, 'Follow-up job raised.')

  if (state.ok && jobId) redirect(`/jobs/${jobId}`)
  return state
}
