'use server'

import { revalidatePath } from 'next/cache'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { createQuote, transitionQuote, updateQuote } from '@/server/quotes/quotes'

/**
 * Quote mutations (slice 19). Thin, as everywhere: form -> object -> service -> revalidate.
 * `quote.write` is checked in the service, so a test calling it directly gets the same answer.
 */

/**
 * The quote form posts one group of fields per line, with the same names, so `formValues` arrives as
 * `string | string[]`. A row whose description was left blank is not a line — the form always leaves
 * one empty row at the bottom for the next item.
 */
function lineBody(values: Record<string, string | string[]>): Record<string, unknown> {
  const column = (name: string): string[] => {
    const value = values[name]
    if (value === undefined) return []
    return Array.isArray(value) ? value : [value]
  }

  const descriptions = column('description')
  const quantities = column('quantity')
  const unitPrices = column('unitPrice')
  const variations = column('isVariation')

  return {
    validUntil: values.validUntil ?? '',
    notes: values.notes ?? '',
    lines: descriptions
      .map((description, index) => ({
        description: description.trim(),
        quantity: quantities[index] ?? '',
        unitPrice: unitPrices[index] ?? '',
        isVariation: variations[index] ?? 'no',
      }))
      .filter((line) => line.description !== ''),
  }
}

export async function createQuoteAction(
  jobId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const body = lineBody(formValues(formData))

  return runAction(async () => {
    const quote = await createQuote(await requireAuth(), { jobId, ...body })
    revalidatePath('/quotes')
    revalidatePath(`/quotes/${quote.id}`)
    revalidatePath(`/jobs/${jobId}`)
  }, 'Quote raised as a draft.')
}

export async function updateQuoteAction(
  quoteId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const body = lineBody(formValues(formData))

  return runAction(async () => {
    const quote = await updateQuote(await requireAuth(), quoteId, body)
    revalidatePath('/quotes')
    revalidatePath(`/quotes/${quoteId}`)
    if (quote.job) revalidatePath(`/jobs/${quote.job.id}`)
  }, 'Quote updated.')
}

/** Send, accept or decline. The status arrives from a hidden field; the schema refuses anything else. */
export async function transitionQuoteAction(
  quoteId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData)

  return runAction(async () => {
    const quote = await transitionQuote(await requireAuth(), quoteId, {
      status: values.status,
      note: values.note ?? '',
    })
    revalidatePath('/quotes')
    revalidatePath(`/quotes/${quoteId}`)
    if (quote.job) revalidatePath(`/jobs/${quote.job.id}`)
  }, 'Quote updated.')
}
