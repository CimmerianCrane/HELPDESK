import { getAuthContext } from '@/server/auth/context'
import { NotFoundError } from '@/server/auth/errors'
import { renderInvoice } from '@/server/invoices/invoices'

/**
 * A tax invoice as a downloadable PDF (slice 20). A route handler for the same reason the quote's is:
 * a download is a GET with `Content-Disposition`, and the browser has to navigate to it. Permission is
 * enforced by the service; this refuses early with a sentence rather than a redirect.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await getAuthContext()
  if (!context) return new Response('Sign in first.', { status: 401 })

  try {
    const { filename, bytes } = await renderInvoice(context, id)
    return new Response(new Uint8Array(bytes).buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof NotFoundError) {
      return new Response('No such invoice.', { status: 404 })
    }
    throw error
  }
}
