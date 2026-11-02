'use server'

import { revalidatePath } from 'next/cache'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { raisePurchaseOrder, receivePurchaseOrder } from '@/server/inventory/purchase-orders'

/**
 * Reorder and receipt mutations (slice 25). Thin, as everywhere: form -> object -> service ->
 * revalidate. `purchaseorder.write` is checked in the service, so a test calling it directly gets the
 * same refusal.
 */

function column(values: Record<string, string | string[]>, name: string): string[] {
  const value = values[name]
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * One row per part on the supplier's group form. `partId` and `quantity` share a row order because
 * they are rendered together — the same assumption the delivery-order forms make.
 */
export async function raisePurchaseOrderAction(
  supplierId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData)
  const partIds = column(values, 'partId')
  const quantities = column(values, 'quantity')

  const lines = partIds.map((partId, index) => ({
    partId,
    quantity: quantities[index] ?? '',
  }))

  return runAction(async () => {
    await raisePurchaseOrder(await requireAuth(), supplierId, {
      expectedAt: column(values, 'expectedAt')[0] ?? '',
      lines,
    })
    revalidatePath('/parts/reorder')
    revalidatePath('/parts')
  }, 'Purchase order raised.')
}

/** One row per line on the PO's receipt form; a zero is a line that did not arrive. */
export async function receivePurchaseOrderAction(
  purchaseOrderId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData)
  const lineIds = column(values, 'lineId')
  const received = column(values, 'received')
  const serials = column(values, 'serialOrBatch')

  const lines = lineIds.map((lineId, index) => ({
    lineId,
    received: received[index] ?? '0',
    serialOrBatch: serials[index] ?? '',
  }))

  return runAction(async () => {
    await receivePurchaseOrder(await requireAuth(), purchaseOrderId, {
      locationId: column(values, 'locationId')[0] ?? '',
      lines,
    })
    revalidatePath('/parts/reorder')
    revalidatePath('/parts')
  }, 'Receipt posted.')
}
