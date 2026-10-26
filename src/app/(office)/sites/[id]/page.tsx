import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CraneForm } from '@/components/office/crane-forms'
import { ArchiveSiteButton, SiteForm } from '@/components/office/site-forms'
import { cardClass } from '@/components/office/ui'
import { requireAuth } from '@/server/auth/context'
import { NotFoundError } from '@/server/auth/errors'
import { can } from '@/server/auth/permissions'
import { CRANE_STATUS_LABELS, CRANE_TYPE_LABELS } from '@/lib/cranes/labels'
import { listCranes } from '@/server/cranes/cranes'
import { listSites, getSite, type SiteAddress } from '@/server/sites/sites'
import { archiveSiteAction, updateSiteFromSiteAction } from './actions'
import { createCraneAction } from '../../cranes/actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  try {
    const site = await getSite(await requireAuth(), id)
    return { title: `${site.name} — Cimmerian Crane Services` }
  } catch (error) {
    if (error instanceof NotFoundError) return { title: 'Site — Cimmerian Crane Services' }
    throw error
  }
}

function addressLines(site: { address: SiteAddress | null }): string[] {
  if (!site.address) return []
  return [
    site.address.line1,
    site.address.line2,
    site.address.city,
    site.address.postcode,
    site.address.country,
  ].filter((line): line is string => Boolean(line))
}

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await requireAuth()

  let site
  try {
    site = await getSite(context, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    throw error
  }

  const [cranes, customerSites] = await Promise.all([
    listCranes(context, { siteId: id }),
    listSites(context, { customerId: site.customerId }),
  ])

  const mayWrite = can(context.role, 'site.write')
  const mayWriteCrane = can(context.role, 'crane.write')
  const address = addressLines(site)
  // Only this customer's sites can receive this customer's crane.
  const siteOptions = customerSites.map((row) => ({ id: row.id, name: row.name }))

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/customers/${site.customerId}`} className="text-sm text-slate-600 underline hover:text-slate-900">
          ← {site.customerName}
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{site.name}</h1>
            <p className="mt-1 text-slate-600">
              {address.length > 0 ? address.join(', ') : 'No address recorded'}
            </p>
          </div>
          <p className="text-sm text-slate-500">
            {cranes.length} {cranes.length === 1 ? 'crane' : 'cranes'}
          </p>
        </div>
      </div>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Cranes at this site</h2>

        {cranes.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            No cranes here yet. A crane is added to a site, not to a customer directly.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Cranes at {site.name}</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Asset tag</th>
                  <th scope="col" className="px-4 py-3 font-medium">Type</th>
                  <th scope="col" className="px-4 py-3 font-medium">Location</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">SWL</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cranes.map((crane) => (
                  <tr key={crane.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/cranes/${crane.id}`}
                        className="font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
                      >
                        {crane.assetTag}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{CRANE_TYPE_LABELS[crane.type]}</td>
                    <td className="px-4 py-3 text-slate-600">{crane.locationOnSite ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{crane.swlKg.toLocaleString()} kg</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          crane.status === 'IN_SERVICE'
                            ? 'text-emerald-800'
                            : crane.status === 'RESTRICTED'
                              ? 'font-medium text-red-800'
                              : 'text-slate-600'
                        }
                      >
                        {CRANE_STATUS_LABELS[crane.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {mayWriteCrane ? (
          <details className="mt-6" open={cranes.length === 0}>
            <summary className="cursor-pointer font-medium text-slate-900">Add a crane here</summary>
            <div className="mt-4">
              <CraneForm
                action={createCraneAction}
                sites={siteOptions}
                customerId={site.customerId}
                submitLabel="Add crane"
                idPrefix="new-crane"
              />
            </div>
          </details>
        ) : null}
      </section>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Site details</h2>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Access notes</dt>
            <dd className="mt-1 whitespace-pre-wrap text-slate-900">
              {site.accessNotes ?? <span className="text-slate-500">Not recorded</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Induction</dt>
            <dd className="mt-1 whitespace-pre-wrap text-slate-900">
              {site.inductionRequirements ?? <span className="text-slate-500">None recorded</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Operating hours</dt>
            <dd className="mt-1 text-slate-900">
              {site.operatingHours ?? <span className="text-slate-500">Not recorded</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Coordinates</dt>
            <dd className="mt-1 text-slate-900">
              {site.latitude !== null && site.longitude !== null
                ? `${site.latitude}, ${site.longitude}`
                : <span className="text-slate-500">Not recorded</span>}
            </dd>
          </div>
        </dl>
      </section>

      {mayWrite ? (
        <section className={cardClass}>
          <h2 className="font-semibold text-slate-900">Edit this site</h2>
          <p className="mt-1 mb-5 text-sm text-slate-600">
            The access notes are what a technician reads on the way in. Keep them current.
          </p>
          <SiteForm
            action={updateSiteFromSiteAction.bind(null, site.customerId, site.id)}
            value={site}
            submitLabel="Save site"
            idPrefix="edit-site"
          />
        </section>
      ) : null}

      {mayWrite ? (
        <section className="rounded-lg border border-red-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Archive</h2>
          <div className="mt-3">
            <ArchiveSiteButton
              action={archiveSiteAction.bind(null, site.customerId, site.id)}
              name={site.name}
              craneCount={cranes.length}
            />
          </div>
        </section>
      ) : null}
    </div>
  )
}
