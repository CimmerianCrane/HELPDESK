import type { Metadata } from 'next'
import Link from 'next/link'
import { cardClass } from '@/components/office/ui'
import { formatDateTime } from '@/lib/format'
import { ROLES } from '@/lib/validation/users'
import { requireAuth } from '@/server/auth/context'
import { getSettings } from '@/server/settings/settings'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/server/users/labels'
import { listUsers } from '@/server/users/users'
import { UserCreateForm, type RoleOption } from './user-create-form'

export const metadata: Metadata = { title: 'Users — Cimmerian Crane Services' }
export const dynamic = 'force-dynamic'

const roleOptions: RoleOption[] = ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
  description: ROLE_DESCRIPTIONS[role],
}))

export default async function UsersPage() {
  const context = await requireAuth()
  const [users, settings] = await Promise.all([listUsers(context), getSettings()])

  const activeCount = users.filter((user) => user.isActive).length

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-title font-semibold text-ink">Users</h1>
        <p className="mt-1 text-muted">
          {users.length} {users.length === 1 ? 'account' : 'accounts'}, {activeCount} active.
          Deactivating keeps the account and its history but stops the user signing in.
        </p>
      </div>

      {users.length === 0 ? (
        <p className={cardClass}>No users yet. Create the first one below.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-field">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">User accounts</caption>
            <thead className="border-b border-line bg-sheet text-xs text-muted">
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
            <tbody className="divide-y divide-rule">
              {users.map((user) => (
                <tr key={user.id} className={user.isActive ? '' : 'text-faint'}>
                  <td className="px-4 py-3">
                    <span className="font-medium text-ink">{user.name}</span>
                    {user.id === context.userId ? (
                      <span className="ml-2 rounded bg-raised px-1.5 py-0.5 text-xs text-muted">
                        you
                      </span>
                    ) : null}
                    {user.employeeNo ? (
                      <span className="block text-xs text-muted">#{user.employeeNo}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{ROLE_LABELS[user.role]}</td>
                  <td className="px-4 py-3">
                    <span className="block">{user.email}</span>
                    {user.phone ? (
                      <span className="block text-xs text-muted">{user.phone}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {user.isActive ? (
                      <span className="text-pos">Active</span>
                    ) : (
                      <span className="text-muted">Deactivated</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {formatDateTime(user.lastLoginAt, settings.timezone)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/users/${user.id}`}
                      className="font-medium text-ink underline hover:text-ink"
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
        <h2 className="font-semibold text-ink">Add a user</h2>
        <p className="mt-1 mb-5 text-sm text-muted">
          Creating a technician also creates their technician record, which is what scopes jobs and
          reports to them.
        </p>
        <UserCreateForm roles={roleOptions} />
      </section>
    </div>
  )
}
