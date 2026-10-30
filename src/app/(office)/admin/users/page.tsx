import type { Metadata } from 'next'
import Link from 'next/link'
import { cardClass } from '@/components/office/ui'
import { formatDateTime } from '@/lib/format'
import { ROLES } from '@/lib/validation/users'
import { requireAuth } from '@/server/auth/context'
import { getSettings } from '@/server/settings/settings'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/server/users/labels'
import { listCustomers } from '@/server/customers/customers'
import { listUsers } from '@/server/users/users'
import { UserCreateForm, type CustomerOption, type RoleOption } from './user-create-form'

export const metadata: Metadata = { title: 'Users — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

const roleOptions: RoleOption[] = ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
  description: ROLE_DESCRIPTIONS[role],
}))

export default async function UsersPage() {
  const context = await requireAuth()
  const [users, settings, customers] = await Promise.all([
    listUsers(context),
    getSettings(),
    // Offered to the form for a portal login's customer picker (slice 31). Admin holds
    // `customer.read`, so this is the same list the customers screen shows.
    listCustomers(context),
  ])

  const customerOptions: CustomerOption[] = customers.map((customer) => ({
    id: customer.id,
    name: customer.tradingName ?? customer.legalName,
  }))

  const activeCount = users.filter((user) => user.isActive).length

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
        <p className="mt-1 text-slate-600">
          {users.length} {users.length === 1 ? 'account' : 'accounts'}, {activeCount} active.
          Deactivating keeps the account and its history but stops the user signing in.
        </p>
      </div>

      {users.length === 0 ? (
        <p className={cardClass}>No users yet. Create the first one below.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">User accounts</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Name</th>
                <th scope="col" className="px-4 py-3 font-medium">Role</th>
                <th scope="col" className="px-4 py-3 font-medium">Contact</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Last sign-in</th>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => (
                <tr key={user.id} className={user.isActive ? '' : 'text-slate-400'}>
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">{user.name}</span>
                    {user.id === context.userId ? (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        you
                      </span>
                    ) : null}
                    {user.employeeNo ? (
                      <span className="block text-xs text-slate-500">#{user.employeeNo}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {ROLE_LABELS[user.role]}
                    {user.customerName ? (
                      <span className="block text-xs text-slate-500">{user.customerName}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className="block">{user.email}</span>
                    {user.phone ? (
                      <span className="block text-xs text-slate-500">{user.phone}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {user.isActive ? (
                      <span className="text-emerald-700">Active</span>
                    ) : (
                      <span className="text-slate-500">Deactivated</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDateTime(user.lastLoginAt, settings.timezone)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/users/${user.id}`}
                      className="font-medium text-slate-700 underline hover:text-slate-900"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Add a user</h2>
        <p className="mt-1 mb-5 text-sm text-slate-600">
          Creating a technician also creates their technician record, which is what scopes jobs and
          reports to them. A Customer login is scoped to the one customer chosen here, and sees only
          that account in the portal.
        </p>
        <UserCreateForm roles={roleOptions} customers={customerOptions} />
      </section>
    </div>
  )
}
