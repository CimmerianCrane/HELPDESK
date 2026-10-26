'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { formValues } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import {
  closeTicket,
  createTicket,
  reopenTicket,
  triageTicket,
  updateTicket,
} from '@/server/tickets/tickets'

/**
 * Ticket actions. Thin, as everywhere: form → plain object → service → revalidate. The permission
 * check lives in the service, so it holds for any caller (CLAUDE.md rule 1).
 *
 * `formValues` rather than `formValuesNested`: a ticket is flat. The customer, site and crane are
 * ids, not nested address objects.
 */

export async function createTicketAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  let createdId: string | undefined

  const state = await runAction(async () => {
    const ticket = await createTicket(await requireAuth(), formValues(formData))
    createdId = ticket.id
    revalidatePath('/tickets')
    revalidatePath('/dashboard')
  }, 'Ticket recorded.')

  // Straight to the ticket: whoever took the call usually triages it next, and the P1 alert links
  // here too. Skipped on failure so the form keeps its messages.
  if (state.ok && createdId) redirect(`/tickets/${createdId}`)
  return state
}

export async function triageTicketAction(
  ticketId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await triageTicket(await requireAuth(), ticketId, formValues(formData))
    revalidatePath('/tickets')
    revalidatePath(`/tickets/${ticketId}`)
    revalidatePath('/dashboard')
  }, 'Triage saved.')
}

export async function updateTicketAction(
  ticketId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await updateTicket(await requireAuth(), ticketId, formValues(formData))
    revalidatePath('/tickets')
    revalidatePath(`/tickets/${ticketId}`)
  }, 'Ticket saved.')
}

export async function closeTicketAction(
  ticketId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await closeTicket(await requireAuth(), ticketId, formValues(formData))
    revalidatePath('/tickets')
    revalidatePath(`/tickets/${ticketId}`)
    revalidatePath('/dashboard')
  }, 'Ticket finished.')
}

/**
 * Reopening needs nothing from the form, so it is a plain action rather than a form state: there is
 * nothing to get wrong and nothing to report back. A closed ticket is the only entry point and the
 * page only offers the button when the service will accept it.
 */
export async function reopenTicketAction(ticketId: string): Promise<void> {
  await reopenTicket(await requireAuth(), ticketId)
  revalidatePath('/tickets')
  revalidatePath(`/tickets/${ticketId}`)
  revalidatePath('/dashboard')
}
