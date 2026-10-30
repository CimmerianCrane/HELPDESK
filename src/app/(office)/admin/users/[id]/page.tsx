import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cardClass } from '@/components/office/ui'
import { formatDateTime } from '@/lib/format'
import { ROLES } from '@/lib/validation/users'
import { auditTrail } from '@/server/audit/audit'
import { requireAuth } from '@/server/auth/context'
import { NotFoundError } from '@/server/auth/errors'
import { getSettings } from '@/server/settings/settings'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/server/users/labels'
import { listCustomers } from '@/server/customers/customers'
import { getUser } from '@/server/users/users'
import { PasswordResetForm } from './password-reset-form'
import { UserEditForm } from './user-edit-form'
import type { CustomerOption, RoleOption } from '../user-create-form'

export const metadata: Metadata = { title: 'Edit user — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

const roleOptions: RoleOption[] = ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
  description: ROLE_DESCRIPTIONS[role],
}))

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await requireAuth()

  const user = await getUser(context, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()
    throw error
  })

  const [settings, history, customers] = await Promise.all([
    getSettings(),
    auditTrail(context, 'User', id, 20),
    listCustomers(context),
  ])

  const customerOptions: CustomerOption[] = customers.map((customer) => ({
    id: customer.id,
    name: customer.tradingName ?? customer.legalName,
  }))

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/users" className="text-sm text-slate-600 underline hover:text-slate-900">
          ← Users
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{user.name}</h1>
        <p className="mt-1 text-slate-600">
          {user.email} · {ROLE_LABELS[user.role]} · created{' '}
          {formatDateTime(user.createdAt, settings.timezone)}
        </p>
      </div>

      <section className={cardClass}>
        <h2 className="mb-5 font-semibold text-slate-900">Account</h2>
        <UserEditForm
          userId={user.id}
          user={{
            name: user.name,
            role: user.role,
            phone: user.phone,
            isActive: user.isActive,
            customerId: user.customerId,
          }}
          roles={roleOptions}
          customers={customerOptions}
          isSelf={user.id === context.userId}
        />
      </section>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Reset password</h2>
        <p className="mt-1 mb-5 text-sm text-slate-600">
          For when someone is locked out. There is no self-service reset: this is an internal system
          with no email delivery to staff.
        </p>
        <PasswordResetForm userId={user.id} />
      </section>

      <section>
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
          History
        </h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No recorded changes.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {history.map((entry) => (
              <li key={entry.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                <p className="text-slate-900">
                  <span className="font-medium">{entry.action}</span> by{' '}
                  {entry.user?.name ?? 'system'} on{' '}
                  {formatDateTime(entry.createdAt, settings.timezone)}
                </p>
                {entry.after ? (
                  <pre className="mt-2 overflow-x-auto text-xs text-slate-600">
                    {JSON.stringify(entry.after, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
