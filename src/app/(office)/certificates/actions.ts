'use server'

import { revalidatePath } from 'next/cache'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import {
  archiveCertificate,
  createCertificate,
  updateCertificate,
} from '@/server/certificates/certificates'

/**
 * Certificate mutations (slice 13). Thin as everywhere: form → object → service → revalidate. The
 * `certificate.write` check lives in the service, so a test calling it directly gets the same answer.
 */

export async function createCertificateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    const certificate = await createCertificate(await requireAuth(), formValues(formData))
    revalidatePath(`/cranes/${certificate.crane.id}`)
    revalidatePath('/certificates')
    revalidatePath('/dashboard')
  }, 'Certificate added.')
}

export async function updateCertificateAction(
  certificateId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    const certificate = await updateCertificate(
      await requireAuth(),
      certificateId,
      formValues(formData),
    )
    revalidatePath(`/cranes/${certificate.crane.id}`)
    revalidatePath('/certificates')
    revalidatePath('/dashboard')
  }, 'Certificate saved.')
}

/**
 * Taken from the crane page, where the crane id is already known, so both pages are revalidated here
 * rather than the action returning a row it has just archived.
 */
export async function archiveCertificateAction(
  certificateId: string,
  craneId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  void formData

  return runAction(async () => {
    await archiveCertificate(await requireAuth(), certificateId)
    revalidatePath(`/cranes/${craneId}`)
    revalidatePath('/certificates')
    revalidatePath('/dashboard')
  }, 'Certificate archived. Its record, file and audit trail stay.')
}
