import { exportAccounting } from '@/server/accounting/accounting'
import { getAuthContext } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'

/**
 * The accounting export as a download (slice 21).
 *
 * A route handler for the same reason the job export is: a download is a GET with
 * `Content-Disposition`, and the browser has to navigate to it. `?what=payments` switches document;
 * everything else comes from the invoice book's own query string, so the link beside a filtered
 * screen and the file the office gets are the same request.
 *
 * Permission is checked twice on purpose, exactly as `/jobs/export` is: the service asserts
 * `invoice.read` itself, and this refuses early with a sentence rather than a redirect to a login
 * page.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await getAuthContext()
  if (!context) return new Response('Sign in first.', { status: 401 })
  if (!can(context.role, 'invoice.read')) {
    return new Response('Your role cannot read invoices.', { status: 403 })
  }

  const params = new URL(request.url).searchParams
  const { filename, csv } = await exportAccounting(context, Object.fromEntries(params.entries()))

  return new Response(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
