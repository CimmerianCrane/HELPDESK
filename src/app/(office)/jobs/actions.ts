'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { convertTicketToJobs, createJob, transitionJob, updateJob } from '@/server/jobs/jobs'

/**
 * Job actions: form → plain object → service → revalidate. Permissions are the service's business
 * (CLAUDE.md rule 1), so a route or a test calling the service gets the same answer as this form.
 */

export async function createJobAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  let createdId: string | undefined

  const state = await runAction(async () => {
    const job = await createJob(await requireAuth(), formValues(formData))
    createdId = job.id
    revalidatePath('/jobs')
    revalidatePath('/dashboard')
  }, 'Job created.')

  if (state.ok && createdId) redirect(`/jobs/${createdId}`)
  return state
}

export async function transitionJobAction(
  jobId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await transitionJob(await requireAuth(), jobId, formValues(formData))
    revalidatePath('/jobs')
    revalidatePath(`/jobs/${jobId}`)
    revalidatePath('/dashboard')
  }, 'Job moved.')
}

export async function updateJobAction(
  jobId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await updateJob(await requireAuth(), jobId, formValues(formData))
    revalidatePath('/jobs')
    revalidatePath(`/jobs/${jobId}`)
  }, 'Job saved.')
}

/**
 * Converts a ticket. The form posts one group of fields per job with the same names, so `formValues`
 * arrives as `string | string[]`; this is the one place that turns the columns back into rows.
 */
export async function convertTicketAction(
  ticketId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData)
  const column = (name: string): string[] => {
    const value = values[name]
    if (value === undefined) return []
    return Array.isArray(value) ? value : [value]
  }

  const jobTypeIds = column('jobTypeId')
  const priorities = column('priority')
  const descriptions = column('description')
  const jobs = jobTypeIds.map((jobTypeId, index) => ({
    jobTypeId,
    priority: priorities[index] ?? 'P3',
    description: descriptions[index] ?? '',
  }))

  const state = await runAction(async () => {
    await convertTicketToJobs(await requireAuth(), ticketId, { jobs })
    revalidatePath('/tickets')
    revalidatePath(`/tickets/${ticketId}`)
    revalidatePath('/jobs')
    revalidatePath('/dashboard')
  }, 'Jobs created.')

  return state
}
