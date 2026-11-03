'use server'

import { revalidatePath } from 'next/cache'
import { formValues } from '@/lib/validation/parse'
import { runAction, toFormState, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { approveServiceReport, saveServiceReport } from '@/server/service-reports/service-reports'

/**
 * The Service Report's two actions (slice 39): save the office's wording, and issue it.
 *
 * The sentences arrive as one textarea per part, in the same order as the crane and component lists
 * the page rendered — the form's shape is the stored content, so a save cannot reorder or drop a part
 * by accident. Everything else (may they, is it still a draft) is the service's.
 */

export async function saveServiceReportAction(
  jobId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData)
  const column = (name: string): string[] => {
    const value = values[name]
    if (value === undefined) return []
    return Array.isArray(value) ? value : [value]
  }

  const craneIds = column('craneId')
  const paragraphCrane = column('paragraphCrane')
  const components = column('component')
  const gradeValues = column('grade')
  const comments = column('comment')
  const texts = column('text')

  // Index-aligned columns, the same trick the delivery-order form uses — HTML has no nested inputs.
  // `paragraphCrane` is the crane's index in `craneId`, repeated on every paragraph of that crane.
  const content = {
    cranes: craneIds.map((craneId, craneIndex) => ({
      craneId,
      // Name and type are filled from the database by the service; a form cannot rename a crane.
      assetTag: '',
      type: null,
      paragraphs: components.flatMap((component, index) => {
        if (Number(paragraphCrane[index] ?? -1) !== craneIndex) return []
        const grade = Number(gradeValues[index] ?? '')
        const text = (texts[index] ?? '').trim()
        if (!text) return []
        return [
          {
            component,
            // A Service Report built before slice 46 may still hold a 5; the office's edit must not
            // blank it. The phone only ever writes 1–4 now.
            grade: Number.isInteger(grade) && grade >= 1 && grade <= 5 ? grade : null,
            comment: (comments[index] ?? '').trim() || null,
            text,
          },
        ]
      }),
    })),
  }

  return runAction(async () => {
    await saveServiceReport(await requireAuth(), jobId, { content })
    revalidatePath(`/jobs/${jobId}`)
  }, 'Service Report saved.')
}

export async function approveServiceReportAction(
  jobId: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  let message = 'Service Report issued.'

  try {
    const result = await approveServiceReport(await requireAuth(), jobId)
    message = `Service Report issued as ${result.documentNumber}.`
    revalidatePath(`/jobs/${jobId}`)
  } catch (error) {
    return toFormState(error)
  }

  return { ok: true, message }
}
