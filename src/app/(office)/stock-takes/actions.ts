'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { formValues } from '@/lib/validation/parse'
import { runAction, toFormState, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import {
  approveStockTake,
  cancelStockTake,
  createStockTake,
  recordCounts,
} from '@/server/inventory/stock-takes'

/**
 * The stock take's mutations (slice 26). Thin, as everywhere: form -> object -> service -> revalidate.
 * `stock.move` and `stocktake.approve` are checked in the services, so a test calling them directly
 * gets the same refusal.
 */

function column(values: Record<string, string | string[]>, name: string): string[] {
  const value = values[name]
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

export async function createStockTakeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  let createdId: string | undefined

  const state = await runAction(async () => {
    const created = await createStockTake(await requireAuth(), formValues(formData))
    createdId = created.id
    revalidatePath('/stock-takes')
  }, 'Count opened.')

  if (state.ok && createdId) redirect(`/stock-takes/${createdId}`)
  return state
}

/** One row per line; `lineId`, `counted` and `reasonCode` share a row order because they render together. */
export async function recordCountsAction(
  stockTakeId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData)
  const lineIds = column(values, 'lineId')
  const counted = column(values, 'counted')
  const reasons = column(values, 'reasonCode')

  const lines = lineIds.map((lineId, index) => ({
    lineId,
    counted: counted[index] ?? '',
    reasonCode: reasons[index] ?? '',
  }))

  return runAction(async () => {
    await recordCounts(await requireAuth(), stockTakeId, { lines })
    revalidatePath('/stock-takes')
    revalidatePath(`/stock-takes/${stockTakeId}`)
  }, 'Counts saved.')
}

export async function approveStockTakeAction(
  stockTakeId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { posted } = await approveStockTake(await requireAuth(), stockTakeId, formValues(formData))
    revalidatePath('/stock-takes')
    revalidatePath(`/stock-takes/${stockTakeId}`)
    // A count moves the shelf, so the book it is read from and the reorder list built from it both moved.
    revalidatePath('/parts')
    revalidatePath('/parts/reorder')
    return {
      ok: true,
      message:
        posted === 0
          ? 'Approved — every line already matched the books.'
          : `Approved, ${posted} correction${posted === 1 ? '' : 's'} posted.`,
    }
  } catch (error) {
    return toFormState(error)
  }
}

export async function cancelStockTakeAction(
  stockTakeId: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await cancelStockTake(await requireAuth(), stockTakeId)
    revalidatePath('/stock-takes')
    revalidatePath(`/stock-takes/${stockTakeId}`)
  }, 'Count cancelled.')
}
