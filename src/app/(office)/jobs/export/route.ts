import { getAuthContext } from '@/server/auth/context'
import { can } from '@/server/auth/permissions'
import { jobsCsv } from '@/server/jobs/export'
import { getSettings } from '@/server/settings/settings'

/**
 * The job list as a download (brief §8).
 *
 * A route handler rather than a server action, because a download is a GET with a `Content-Disposition`
 * header and the browser has to navigate to it. The filters come straight from the query string, so
 * the link the page renders and the file the office gets are the same request — the screen cannot
 * export something different from what it is showing.
 *
 * Permissions are checked twice on purpose: `jobsCsv` asserts `job.read.all` itself, and the route
 * refuses early with a 403 rather than a redirect to a login page. A role that cannot read the job list
 * gets a sentence, not a CSV.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await getAuthContext()
  if (!context) return new Response('Sign in first.', { status: 401 })
  if (!can(context.role, 'job.read.all')) {
    return new Response('Your role cannot read the job list.', { status: 403 })
  }

  const params = new URL(request.url).searchParams
  const filters = Object.fromEntries(params.entries())

  const settings = await getSettings()
  const csv = await jobsCsv(context, filters, settings.timezone)

  return new Response(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="jobs-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
