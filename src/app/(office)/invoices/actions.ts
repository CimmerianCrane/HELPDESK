'use server'

import { revalidatePath } from 'next/cache'
import { column } from '@/lib/validation/form-columns'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { pushInvoicesToAccounting } from '@/server/accounting/accounting'
import { requireAuth } from '@/server/auth/context'
import {
  createInvoice,
  recordPayment,
  transitionInvoice,
  updateInvoice,
} from '@/server/invoices/invoices'

/**
 * Invoice mutations (slice 20). Thin, as everywhere: form -> object -> service -> revalidate.
 * `invoice.write` is checked in the service, so a test calling it directly gets the same answer.
 */

/**
 * The invoice form posts one group of fields per line, with the same names, so `formValues` arrives as
 * `string | string[]`. A row with no description is the empty row the form leaves at the bottom.
 */
function lineBody(values: Record<string, string | string[]>): Record<string, unknown> {
  const descriptions = column(values, 'description')
  const quantities = column(values, 'quantity')
  const unitPrices = column(values, 'unitPrice')

  return {
    lines: descriptions
      .map((description, index) => ({
        description: description.trim(),
        quantity: quantities[index] ?? '',
        unitPrice: unitPrices[index] ?? '',
      }))
      .filter((line) => line.description !== ''),
  }
}

export async function createInvoiceAction(
  jobId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const body = lineBody(formValues(formData))

  return runAction(async () => {
    const invoice = await createInvoice(await requireAuth(), { jobId, ...body })
    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoice.id}`)
    revalidatePath(`/jobs/${jobId}`)
  }, 'Invoice raised as a draft.')
}

export async function updateInvoiceAction(
  invoiceId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const body = lineBody(formValues(formData))

  return runAction(async () => {
    const invoice = await updateInvoice(await requireAuth(), invoiceId, body)
    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    if (invoice.job) revalidatePath(`/jobs/${invoice.job.id}`)
  }, 'Invoice updated.')
}

/** Issue or void. The status arrives from a hidden field; the service refuses anything else. */
export async function transitionInvoiceAction(
  invoiceId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData)

  return runAction(async () => {
    const invoice = await transitionInvoice(await requireAuth(), invoiceId, {
      status: values.status,
      reason: values.reason ?? '',
    })
    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    if (invoice.job) revalidatePath(`/jobs/${invoice.job.id}`)
  }, values.status === 'VOID' ? 'Invoice voided.' : 'Invoice issued.')
}

/**
 * Push every billed invoice that is not yet in the accounting system (slice 37). The success message
 * reports what happened, because a partial run — some refused — is the normal case a dead credential
 * or a GST mismatch produces, and `runAction`'s one fixed sentence would hide it.
 */
export async function pushInvoicesAction(
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  const context = await requireAuth()
  const summary = await pushInvoicesToAccounting(context)
  revalidatePath('/invoices')

  const refused = summary.failures.length
  const parts = [`Pushed ${summary.pushed} to ${summary.driver}.`]
  if (summary.alreadyPushed > 0) parts.push(`${summary.alreadyPushed} were already there.`)
  // The first reason only: five identical credential errors read as noise, and the rest are retried.
  if (refused > 0) parts.push(`${refused} refused — ${summary.failures[0]!.error}`)

  return { ok: refused === 0, message: parts.join(' ') }
}

export async function recordPaymentAction(
  invoiceId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData)

  return runAction(async () => {
    const invoice = await recordPayment(await requireAuth(), invoiceId, {
      amount: values.amount ?? '',
      method: values.method ?? 'BANK_TRANSFER',
      reference: values.reference ?? '',
      paidAt: values.paidAt ?? '',
    })
    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    if (invoice.job) revalidatePath(`/jobs/${invoice.job.id}`)
  }, 'Payment recorded.')
}
