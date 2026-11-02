import { getAuthContext } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { customerImportTemplate } from '@/server/customers/import'

/**
 * The blank template. Header row only, so it cannot be mistaken for data if someone forgets to fill
 * it in. Prefixed with a BOM because Excel otherwise opens a UTF-8 CSV as ANSI and mangles any
 * non-ASCII names the office adds — `parseCsv` strips it again on the way back in.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const context = await getAuthContext()
  if (!context) return new Response('Sign in first.', { status: 401 })
  if (!can(context.role, 'customer.import')) {
    return new Response('Your role cannot import customers.', { status: 403 })
  }

  return new Response(`﻿${customerImportTemplate()}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="cimmerian-crane-customers.csv"',
      'Cache-Control': 'no-store',
    },
  })
}
