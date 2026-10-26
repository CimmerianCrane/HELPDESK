import type { ReactNode } from 'react'
import { requireAuth } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'

/**
 * One gate for every administration screen. A page added under `admin/` is protected by existing,
 * rather than by whoever remembers to add the check.
 */
export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const context = await requireAuth()

  if (!can(context.role, 'user.manage')) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <h1 className="font-semibold text-amber-900">Not available for your role</h1>
        <p className="mt-1 text-sm text-amber-900">
          Administration is limited to administrators. You are signed in as a{' '}
          {context.role.toLowerCase()}.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
