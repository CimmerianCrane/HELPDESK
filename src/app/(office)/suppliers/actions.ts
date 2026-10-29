'use server'

import { revalidatePath } from 'next/cache'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { createSupplier, updateSupplier } from '@/server/inventory/suppliers'

/** The supplier book (slice 27). Thin: form → object → service → revalidate. */

export async function createSupplierAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await createSupplier(await requireAuth(), formValues(formData))
    revalidatePath('/suppliers')
    revalidatePath('/parts/reorder')
  }, 'Supplier added.')
}

export async function updateSupplierAction(
  supplierId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await updateSupplier(await requireAuth(), supplierId, formValues(formData))
    revalidatePath('/suppliers')
    revalidatePath('/parts/reorder')
  }, 'Supplier saved.')
}
