import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArchiveContactButton,
  ArchiveCustomerButton,
  ContactForm,
  EditCustomerForm,
} from '@/components/office/customer-forms'
import { ContractForm, RetireContractButton } from '@/components/office/contract-forms'
import { SiteForm } from '@/components/office/site-forms'
import { cardClass } from '@/components/office/ui'
import { formatDate } from '@/lib/format'
import { PRIORITIES } from '@/lib/validation/tickets'
import { CONTRACT_TYPE_LABELS } from '@/lib/validation/contracts'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import {
  contractCraneOptions,
  listCustomerContracts,
  type ContractSummary,
} from '@/server/contracts/contracts'
import { getCustomer, listCustomerSites, type CustomerDetail } from '@/server/customers/customers'
import {
  CONTACT_ROLE_LABELS,
  CUSTOMER_STATUS_LABELS,
  PREFERRED_CHANNEL_LABELS,
} from '@/server/customers/labels'
import { getSettings } from '@/server/settings/settings'
import { NotFoundError } from '@/server/auth/errors'
import {
  archiveContactAction,
  archiveCustomerAction,
  createContactAction,
  createContractAction,
  createSiteAction,
  retireContractAction,
  updateContactAction,
  updateContractAction,
  updateCustomerAction,
} from '../actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const context = await requireAuth()
  try {
    const customer = await getCustomer(context, id)
    return { title: `${customer.legalName} — Cimmerian Crane Services` }
  } catch (error) {
    // A title is not worth failing the page over; the page itself renders the not-found state.
    if (error instanceof NotFoundError) return { title: 'Customer — Cimmerian Crane Services' }
    throw error
  }
}

/** "P1 30 / 240 min · P2 120 / 480 min", or the company-wide fallback when nothing is agreed. */
function contractTargetsLabel(contract: ContractSummary): string {
  const rows = PRIORITIES.flatMap((priority) => {
    const target = contract.targets[priority]
    return target ? [`${priority} ${target.responseMinutes} / ${target.resolutionMinutes} min`] : []
  })
  return rows.length === 0 ? 'Company-wide SLA targets' : rows.join(' · ')
}

function addressLines(customer: CustomerDetail): string[] {
  const address = customer.billingAddress
  if (!address) return []
  return [address.line1, address.line2, address.city, address.postcode, address.country].filter(
    (line): line is string => Boolean(line),
  )
}

/**
 * The tabs the plan specifies for this screen. Sections that exist are anchors into this page; the
 * rest stay visible but disabled, so the shape of the screen is legible before it is finished.
 */
const TABS: ReadonlyArray<{ label: string; anchor?: string }> = [
  { label: 'Overview' },
  { label: 'Sites', anchor: 'sites' },
  { label: 'Cranes' },
  { label: 'Jobs' },
  { label: 'Contacts' },
  { label: 'Contracts', anchor: 'contracts' },
  { label: 'Documents' },
  { label: 'Invoices' },
]

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await requireAuth()

  let customer: CustomerDetail
  try {
    customer = await getCustomer(context, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    throw error
  }

  const mayWrite = can(context.role, 'customer.write')
  const maySiteWrite = can(context.role, 'site.write')
  const mayContractWrite = can(context.role, 'sla.manage')

  const [sites, settings, contracts, contractCranes] = await Promise.all([
    listCustomerSites(context, id),
    getSettings(),
    listCustomerContracts(context, id),
    mayContractWrite ? contractCraneOptions(context, id) : Promise.resolve([]),
  ])
  const address = addressLines(customer)

  const primary = customer.contacts.find((contact) => contact.isPrimary)

  return (
    <div className="space-y-8">
      <div>
        <Link href="/customers" className="text-sm text-slate-600 underline hover:text-slate-900">
          ← Customers
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{customer.legalName}</h1>
            <p className="mt-1 text-slate-600">
              {customer.tradingName ? `${customer.tradingName} · ` : ''}
              {CUSTOMER_STATUS_LABELS[customer.status]}
              {customer.uen ? ` · UEN ${customer.uen}` : ''}
            </p>
          </div>
          <p className="text-sm text-slate-500">Customer since {formatDate(customer.createdAt, settings.timezone)}</p>
        </div>
      </div>

      <nav aria-label="Customer sections" className="-mb-2 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((tab) =>
          tab.anchor ? (
            <a
              key={tab.label}
              href={`#${tab.anchor}`}
              className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900"
            >
              {tab.label}
            </a>
          ) : (
            <span
              key={tab.label}
              aria-current={tab.label === 'Overview' ? 'page' : undefined}
              className={
                tab.label === 'Overview'
                  ? 'border-b-2 border-slate-900 px-3 py-2 text-sm font-medium text-slate-900'
                  : 'cursor-not-allowed px-3 py-2 text-sm text-slate-400'
              }
              title={tab.label === 'Overview' ? undefined : `${tab.label} arrives in a later slice`}
            >
              {tab.label}
            </span>
          ),
        )}
      </nav>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className={`${cardClass} lg:col-span-2`}>
          <h2 className="font-semibold text-slate-900">Overview</h2>

          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Primary contact</dt>
              <dd className="mt-1 text-slate-900">
                {primary ? (
                  <>
                    {primary.name}
                    <span className="block text-xs text-slate-500">
                      {CONTACT_ROLE_LABELS[primary.role]}
                      {primary.phone ? ` · ${primary.phone}` : ''}
                      {primary.email ? ` · ${primary.email}` : ''}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-500">None set</span>
                )}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Payment terms</dt>
              <dd className="mt-1 text-slate-900">
                {customer.paymentTerms === null ? 'Not set' : `${customer.paymentTerms} days`}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Billing address</dt>
              <dd className="mt-1 text-slate-900">
                {address.length > 0 ? (
                  address.map((line) => <span key={line} className="block">{line}</span>)
                ) : (
                  <span className="text-slate-500">Not set</span>
                )}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Records</dt>
              <dd className="mt-1 text-slate-900">
                {customer.siteCount} {customer.siteCount === 1 ? 'site' : 'sites'},{' '}
                {customer.contactCount} {customer.contactCount === 1 ? 'contact' : 'contacts'}
              </dd>
            </div>

            {customer.notes ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Notes</dt>
                <dd className="mt-1 whitespace-pre-wrap text-slate-900">{customer.notes}</dd>
              </div>
            ) : null}
          </dl>

          <p className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Cranes, jobs and site history appear here as those screens are built. The customer record
            is the anchor everything else hangs off.
          </p>
        </section>

        <section id="sites" className={cardClass}>
          <h2 className="font-semibold text-slate-900">Sites</h2>
          <p className="mt-1 text-sm text-slate-600">
            {sites.length === 0
              ? 'No sites yet. A crane has to be at a site, so this comes first.'
              : `${sites.length} ${sites.length === 1 ? 'site' : 'sites'}.`}
          </p>
          {sites.length > 0 ? (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {sites.map((site) => (
                <li key={site.id} className="flex items-baseline justify-between gap-3 py-2">
                  <Link
                    href={`/sites/${site.id}`}
                    className="font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                  >
                    {site.name}
                  </Link>
                  <span className="text-xs text-slate-500">
                    {site.craneCount} {site.craneCount === 1 ? 'crane' : 'cranes'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      {maySiteWrite ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Add a site</h2>
          <p className="mt-1 mb-5 text-sm text-slate-600">
            A site is where the cranes are and where a technician has to go. Add the cranes to it
            afterwards.
          </p>
          <details open={sites.length === 0}>
            <summary className="cursor-pointer text-sm font-medium text-slate-900">
              Site details
            </summary>
            <div className="mt-4">
              <SiteForm
                action={createSiteAction.bind(null, customer.id)}
                submitLabel="Add site"
                idPrefix="new-site"
              />
            </div>
          </details>
        </section>
      ) : null}

      <section className={cardClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Contacts</h2>
          <p className="text-sm text-slate-500">
            One primary contact; accounts and decision makers usually belong to the whole company.
          </p>
        </div>

        {customer.contacts.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">
            No contacts yet. Add the person the office actually calls.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {customer.contacts.map((contact) => (
              <li key={contact.id} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900">
                      {contact.name}
                      {contact.isPrimary ? (
                        <span className="ml-2 rounded bg-slate-900 px-1.5 py-0.5 text-xs font-medium text-white">
                          Primary
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-slate-600">
                      {CONTACT_ROLE_LABELS[contact.role]}
                      {contact.siteName ? ` · ${contact.siteName}` : ' · Whole company'}
                      {' · Prefers '}
                      {PREFERRED_CHANNEL_LABELS[contact.preferredChannel]}
                    </p>
                    <p className="text-sm text-slate-600">
                      {[contact.phone, contact.email].filter(Boolean).join(' · ') || 'No contact details'}
                    </p>
                  </div>

                  {mayWrite ? (
                    <ArchiveContactButton
                      action={archiveContactAction.bind(null, customer.id, contact.id)}
                      name={contact.name}
                    />
                  ) : null}
                </div>

                {mayWrite ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-slate-600 underline hover:text-slate-900">
                      Edit {contact.name.split(' ')[0]}
                    </summary>
                    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-4">
                      <ContactForm
                        action={updateContactAction.bind(null, customer.id, contact.id)}
                        value={contact}
                        sites={sites}
                        submitLabel="Save contact"
                        idPrefix={`contact-${contact.id}`}
                      />
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {mayWrite ? (
          <details className="mt-6" open={customer.contacts.length === 0}>
            <summary className="cursor-pointer font-medium text-slate-900">Add a contact</summary>
            <div className="mt-4">
              <ContactForm
                action={createContactAction.bind(null, customer.id)}
                sites={sites}
                submitLabel="Add contact"
                idPrefix="new-contact"
              />
            </div>
          </details>
        ) : null}
      </section>

      <section id="contracts" className={cardClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Contracts</h2>
          <p className="text-sm text-slate-500">
            A contract&apos;s response and resolution targets override the company-wide ones on every
            job raised under it.
          </p>
        </div>

        {contracts.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">
            No contract recorded. Jobs on this customer use the company-wide SLA targets.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {contracts.map((contract) => (
              <li key={contract.id} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900">
                      {CONTRACT_TYPE_LABELS[contract.type]}
                      {contract.reference ? ` · ${contract.reference}` : ''}
                      {contract.renewal === 'overdue' ? (
                        <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">
                          Renewal overdue
                        </span>
                      ) : contract.renewal === 'due' ? (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                          Renewal within 90 days
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {contract.startDate || contract.endDate
                        ? `${formatDate(contract.startDate, settings.timezone)} – ${
                            contract.endDate
                              ? formatDate(contract.endDate, settings.timezone)
                              : 'open-ended'
                          }`
                        : 'No term recorded'}
                      {contract.renewalDate
                        ? ` · renews ${formatDate(contract.renewalDate, settings.timezone)}`
                        : ''}
                      {contract.includedVisits !== null
                        ? ` · ${contract.includedVisits} visits included`
                        : ''}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {contract.coveredCranes.length === 0
                        ? 'Covers the whole account'
                        : `Covers ${contract.coveredCranes.map((crane) => crane.assetTag).join(', ')}`}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {contractTargetsLabel(contract)}
                    </p>
                    {contract.scopeNotes ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                        {contract.scopeNotes}
                      </p>
                    ) : null}
                  </div>

                  {mayContractWrite ? (
                    <RetireContractButton
                      action={retireContractAction.bind(null, customer.id, contract.id)}
                      label={CONTRACT_TYPE_LABELS[contract.type]}
                    />
                  ) : null}
                </div>

                {mayContractWrite ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-slate-600 underline hover:text-slate-900">
                      Edit contract
                    </summary>
                    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-4">
                      <ContractForm
                        action={updateContractAction.bind(null, customer.id, contract.id)}
                        values={contract}
                        cranes={contractCranes}
                        submitLabel="Save contract"
                        idPrefix={`contract-${contract.id}`}
                      />
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {mayContractWrite ? (
          <details className="mt-6" open={contracts.length === 0}>
            <summary className="cursor-pointer font-medium text-slate-900">Add a contract</summary>
            <div className="mt-4">
              <ContractForm
                action={createContractAction.bind(null, customer.id)}
                values={null}
                cranes={contractCranes}
                submitLabel="Add contract"
                idPrefix="new-contract"
              />
            </div>
          </details>
        ) : null}
      </section>

      {mayWrite ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Edit details</h2>
          <p className="mt-1 mb-5 text-sm text-slate-600">
            Every change is written to the audit log with what it was before.
          </p>
          <EditCustomerForm
            customer={customer}
            action={updateCustomerAction.bind(null, customer.id)}
          />
        </section>
      ) : null}

      {mayWrite ? (
        <section className="rounded-lg border border-red-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Archive</h2>
          <div className="mt-3">
            <ArchiveCustomerButton
              action={archiveCustomerAction.bind(null, customer.id)}
              hasHistory={customer.siteCount > 0 || customer.contactCount > 0}
            />
          </div>
        </section>
      ) : null}
    </div>
  )
}
