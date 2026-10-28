'use server'

import { revalidatePath } from 'next/cache'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import {
  createDeliveryOrder,
  receiveDeliveryOrder,
  returnDeliveryOrder,
} from '@/server/delivery-orders/delivery-orders'

/**
 * Delivery order mutations (slice 18). Thin, as everywhere: form -> object -> service -> revalidate.
 * `deliveryorder.write` is checked in the service, so a test calling it directly gets the same answer.
 */

/**
 * The delivery form posts one group of fields per ticked part, with the same names, so `formValues`
 * arrives as `string | string[]`. This is the one place that turns the columns back into lines — the
 * same shape `convertTicketAction` uses for several jobs.
 */
export async function createDeliveryOrderAction(
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

  const movementIds = column('movementId')
  const chargeTypes = column('chargeType')
  const conditions = column('condition')
  const returnDates = column('expectedReturnDate')

  const lines = movementIds.map((movementId, index) => ({
    movementId,
    chargeType: chargeTypes[index] ?? 'CHARGEABLE',
    condition: conditions[index] ?? '',
    expectedReturnDate: returnDates[index] ?? '',
  }))

  return runAction(async () => {
    await createDeliveryOrder(await requireAuth(), { jobId, lines })
    revalidatePath(`/jobs/${jobId}`)
  }, 'Delivery order raised.')
}

export async function receiveDeliveryOrderAction(
  deliveryOrderId: string,
  jobId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData)

  return runAction(async () => {
    await receiveDeliveryOrder(await requireAuth(), deliveryOrderId, formBody(values))
    revalidatePath(`/jobs/${jobId}`)
  }, 'Receipt recorded.')
}

export async function returnDeliveryOrderAction(
  deliveryOrderId: string,
  jobId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData)

  return runAction(async () => {
    await returnDeliveryOrder(await requireAuth(), deliveryOrderId, formBody(values))
    revalidatePath(`/jobs/${jobId}`)
  }, 'Return recorded.')
}

/**
 * The quantity rows of a receipt or a return. `lineId` and the quantity input share a row order
 * because they are rendered together, which is the same assumption `convertTicketAction` makes.
 */
function formBody(values: Record<string, string | string[]>): Record<string, unknown> {
  const column = (name: string): string[] => {
    const value = values[name]
    if (value === undefined) return []
    return Array.isArray(value) ? value : [value]
  }

  const lineIds = column('lineId')
  const received = column('received')
  const returned = column('returned')

  return {
    receiverName: values.receiverName ?? '',
    signatureFileId: values.signatureFileId ?? '',
    note: values.note ?? '',
    lines: lineIds.map((lineId, index) => ({
      lineId,
      received: received[index] ?? '0',
      returned: returned[index] ?? '0',
    })),
  }
}
