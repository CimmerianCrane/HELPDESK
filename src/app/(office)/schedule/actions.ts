'use server'

import { revalidatePath } from 'next/cache'
import { formValues } from '@/lib/validation/parse'
import { runAction, toFormState, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { dispatchJob } from '@/server/schedule/dispatch'
import {
  bookResource,
  createOnCallShift,
  createUnavailability,
  deleteOnCallShift,
  deleteUnavailability,
  releaseResource,
} from '@/server/schedule/roster'
import {
  assignTechnician,
  bumpScheduledJob,
  moveJobCard,
  rescheduleJob,
  unassignTechnician,
} from '@/server/schedule/scheduling'

/**
 * Schedule actions. Thin, as everywhere: form → plain object → service → revalidate. The rules —
 * competency, clashes, the bump reason — are the service's, so a test or a route gets the same answer.
 *
 * Every action revalidates the job as well as the board, because assigning or rescheduling changes
 * what the job screen says about itself.
 */

function refreshBoard(jobId?: string) {
  revalidatePath('/schedule')
  revalidatePath('/jobs')
  revalidatePath('/dashboard')
  if (jobId) revalidatePath(`/jobs/${jobId}`)
}

export async function assignTechnicianAction(
  jobId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  // Written out rather than through `runAction` because a successful override needs a different
  // message, not a different outcome: the assignment happened, and the form should say what it went
  // past rather than pretend the warning never existed.
  try {
    const result = await assignTechnician(await requireAuth(), jobId, formValues(formData))
    refreshBoard(jobId)
    return {
      ok: true,
      message:
        result.warnings.length > 0
          ? `Assigned, over the warning: ${result.warnings.join(' ')}`
          : 'Technician assigned.',
    }
  } catch (error) {
    return toFormState(error)
  }
}

export async function unassignTechnicianAction(
  jobId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await unassignTechnician(await requireAuth(), jobId, formValues(formData))
    refreshBoard(jobId)
  }, 'Technician taken off the job.')
}

export async function rescheduleJobAction(
  jobId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await rescheduleJob(await requireAuth(), jobId, formValues(formData))
    refreshBoard(jobId)
  }, 'Visit moved.')
}

/**
 * A card dragged on the board.
 *
 * It returns a `FormState` rather than a richer result because the board is a client component that
 * only needs to know whether to refresh and what to say. A refused drop names the clash in the same
 * words the assignment form would have used.
 */
export async function moveJobCardAction(
  jobId: string,
  into: { technicianId: string | null; day: string | null },
): Promise<FormState> {
  try {
    const result = await moveJobCard(await requireAuth(), jobId, {
      technicianId: into.technicianId ?? '',
      day: into.day ?? '',
    })
    refreshBoard(jobId)
    return {
      ok: true,
      message:
        result.warnings.length > 0
          ? `Moved, over the warning: ${result.warnings.join(' ')}`
          : 'Moved.',
    }
  } catch (error) {
    return toFormState(error)
  }
}

export async function bumpJobAction(
  displacedJobId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await bumpScheduledJob(await requireAuth(), displacedJobId, formValues(formData))
    refreshBoard(displacedJobId)
  }, 'Visit displaced. The job is back to Approved and needs a new date.')
}

/**
 * The job screen's dispatch button. A plain `<form action>` takes FormData and returns nothing, so
 * this wrapper exists for that shape.
 *
 * It returns a `FormState` like every other form button: a refused dispatch is an expected failure —
 * the job is not scheduled yet, or nobody is on it — and the person needs to read why. Letting a
 * `RuleError` escape here showed the error boundary instead, so the one sentence that said what to
 * do next was replaced by "Something went wrong" and a reference number.
 */
export async function dispatchJobFormAction(jobId: string): Promise<FormState> {
  return runAction(async () => {
    await dispatchJob(await requireAuth(), jobId)
    refreshBoard(jobId)
  }, 'Sent to the crew.')
}

export async function createLeaveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await createUnavailability(await requireAuth(), formValues(formData))
    refreshBoard()
  }, 'Leave recorded.')
}

export async function deleteLeaveAction(leaveId: string): Promise<void> {
  await deleteUnavailability(await requireAuth(), leaveId)
  refreshBoard()
}

export async function createOnCallAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await createOnCallShift(await requireAuth(), formValues(formData))
    refreshBoard()
  }, 'On-call shift added.')
}

export async function deleteOnCallAction(shiftId: string): Promise<void> {
  await deleteOnCallShift(await requireAuth(), shiftId)
  refreshBoard()
}

export async function bookResourceAction(
  jobId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await bookResource(await requireAuth(), jobId, formValues(formData))
    refreshBoard(jobId)
  }, 'Resource booked.')
}

export async function releaseResourceAction(jobId: string, resourceId: string): Promise<void> {
  await releaseResource(await requireAuth(), jobId, resourceId)
  refreshBoard(jobId)
}
