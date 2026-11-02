import { getAuthContext } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { craneImportTemplate } from '@/server/cranes/import'

/**
 * The blank crane register template. BOM-prefixed so Excel opens it as UTF-8; `parseCsv` strips it
 * again on the way back in.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const context = await getAuthContext()
  if (!context) return new Response('Sign in first.', { status: 401 })
  if (!can(context.role, 'crane.import')) {
    return new Response('Your role cannot import cranes.', { status: 403 })
  }

  return new Response(`﻿${craneImportTemplate()}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="cimmerian-crane-register.csv"',
      'Cache-Control': 'no-store',
    },
  })
}
