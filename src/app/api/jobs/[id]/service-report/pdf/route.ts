import { getAuthContext } from '@/server/auth/context'
import { serviceReportPdfUrl } from '@/server/service-reports/service-reports'

/**
 * The issued Service Report as a download (slice 39).
 *
 * A redirect rather than a stream: the PDF is stored when the document is approved, and the record is
 * that stored file — re-rendering it here would be a second way to produce the same document, free to
 * drift from the one that was issued. A draft has nothing to redirect to.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await getAuthContext()
  if (!context) return new Response('Sign in first.', { status: 401 })

  const url = await serviceReportPdfUrl(context, id)
  if (!url) return new Response('No issued Service Report for this job.', { status: 404 })
  return Response.redirect(url, 303)
}
