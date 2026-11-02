import { getAuthContext } from '@/server/auth/context'
import { NotFoundError } from '@/server/auth/errors'
import { renderDeliveryOrder } from '@/server/delivery-orders/delivery-orders'

/**
 * A delivery order as a downloadable PDF (brief §6.5, slice 18).
 *
 * A route handler rather than a server action, for the same reason the jobs CSV is: a download is a
 * GET with `Content-Disposition`, and the browser has to navigate to it. Permission is enforced by
 * the service; the route refuses early with a sentence rather than a redirect, because a role that
 * cannot read the job should get a 403 and not a sign-in page.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await getAuthContext()
  if (!context) return new Response('Sign in first.', { status: 401 })

  try {
    const { filename, bytes } = await renderDeliveryOrder(context, id)
    return new Response(new Uint8Array(bytes).buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof NotFoundError) {
      return new Response('No such delivery order.', { status: 404 })
    }
    throw error
  }
}
