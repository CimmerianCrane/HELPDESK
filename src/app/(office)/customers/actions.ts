'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { formValues, formValuesNested } from '@/lib/validation/parse'
import { runAction, type FormState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import {
  createContract,
  retireContract,
  updateContract,
} from '@/server/contracts/contracts'
import {
  archiveContact,
  archiveCustomer,
  createContact,
  createCustomer,
  updateContact,
  updateCustomer,
} from '@/server/customers/customers'
import { archiveSite, createSite, updateSite } from '@/server/sites/sites'

/**
 * Thin by design: turn the form into a plain object, hand it to the service, revalidate. Every
 * permission check lives inside the service, so it holds no matter who calls it (CLAUDE.md rule 1).
 *
 * `formValuesNested` rather than `formValues` because the billing address arrives as
 * `address.city` and has to reach the schema as one nested object.
 */

export async function createCustomerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  let createdId: string | undefined

  const state = await runAction(async () => {
    const customer = await createCustomer(await requireAuth(), formValuesNested(formData))
    createdId = customer.id
    revalidatePath('/customers')
  }, 'Customer created.')

  // Straight to the new record: the next thing anyone does after creating a customer is add its
  // contacts and sites. Skipped on failure, where the form needs to stay put with its messages.
  if (state.ok && createdId) redirect(`/customers/${createdId}`)
  return state
}

export async function updateCustomerAction(
  customerId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await updateCustomer(await requireAuth(), customerId, formValuesNested(formData))
    revalidatePath('/customers')
    revalidatePath(`/customers/${customerId}`)
  }, 'Saved.')
}

export async function archiveCustomerAction(
  customerId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  void formData

  const state = await runAction(async () => {
    await archiveCustomer(await requireAuth(), customerId)
    revalidatePath('/customers')
  }, 'Customer archived.')

  if (state.ok) redirect('/customers')
  return state
}

export async function createContactAction(
  customerId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await createContact(await requireAuth(), customerId, formValuesNested(formData))
    revalidatePath(`/customers/${customerId}`)
  }, 'Contact added.')
}

export async function updateContactAction(
  customerId: string,
  contactId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await updateContact(await requireAuth(), customerId, contactId, formValuesNested(formData))
    revalidatePath(`/customers/${customerId}`)
    revalidatePath(`/customers/${customerId}/contacts/${contactId}`)
  }, 'Contact saved.')
}

/**
 * Sites are created from the customer page, because a site has no meaning without the customer it
 * belongs to. They are edited from their own page once they exist, where the crane list lives.
 */
export async function createSiteAction(
  customerId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await createSite(await requireAuth(), { ...formValuesNested(formData), customerId })
    revalidatePath(`/customers/${customerId}`)
  }, 'Site added.')
}

export async function updateSiteAction(
  customerId: string,
  siteId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await updateSite(await requireAuth(), siteId, { ...formValuesNested(formData), customerId })
    revalidatePath(`/customers/${customerId}`)
    revalidatePath(`/sites/${siteId}`)
  }, 'Site saved.')
}

export async function archiveSiteAction(
  customerId: string,
  siteId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  void formData

  return runAction(async () => {
    await archiveSite(await requireAuth(), siteId)
    revalidatePath(`/customers/${customerId}`)
  }, 'Site archived.')
}

export async function archiveContactAction(
  customerId: string,
  contactId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  void formData

  return runAction(async () => {
    await archiveContact(await requireAuth(), customerId, contactId)
    revalidatePath(`/customers/${customerId}`)
  }, 'Contact archived.')
}

/**
 * Contracts belong to the customer they were agreed with, so they are created and edited here and
 * never through a screen that would have to name a customer id. `formValues` rather than the nested
 * variant: the SLA fields are flat and the crane checkboxes are a repeated name.
 */
export async function createContractAction(
  customerId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await createContract(await requireAuth(), customerId, formValues(formData))
    revalidatePath(`/customers/${customerId}`)
  }, 'Contract added.')
}

export async function updateContractAction(
  customerId: string,
  contractId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runAction(async () => {
    await updateContract(await requireAuth(), customerId, contractId, formValues(formData))
    revalidatePath(`/customers/${customerId}`)
  }, 'Contract saved.')
}

export async function retireContractAction(
  customerId: string,
  contractId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  void formData

  return runAction(async () => {
    await retireContract(await requireAuth(), customerId, contractId)
    revalidatePath(`/customers/${customerId}`)
  }, 'Contract retired.')
}
