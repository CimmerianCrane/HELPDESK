import { encodeForWire, decodeFromWire, type DocumentKind } from '@/lib/document-wire'
import { env } from '@/lib/env'
import type { ReportPdfInput } from '@/server/documents/render'
import type { ServiceReportPdfInput } from '@/server/documents/service-report'
import type { QuotePdfInput } from '@/server/documents/quote'
import type { DeliveryOrderPdfInput } from '@/server/documents/delivery-order'
import type { InvoicePdfInput } from '@/server/documents/invoice'

/**
 * Renders a document to PDF bytes.
 *
 * On Cloudflare Workers `@react-pdf/renderer` cannot run: its layout engine (`yoga-layout`) compiles
 * WASM at runtime, which workerd forbids. So in production the app does not render at all — it POSTs
 * the input to the document service (`document-service/`) and gets bytes back. Every other
 * environment (next dev, `next start`, Vitest, a Node deploy) renders in-process exactly as before,
 * which is what keeps the render unit tests and the integration suite runnable without a second
 * process.
 *
 * The switch is `DOCUMENT_SERVICE_URL`: set it (Worker, or any split deployment) and rendering is
 * remote; leave it unset and it is local. There is no driver enum — an empty URL is the one honest
 * signal that the renderer is co-located.
 *
 * The renderer modules are imported **lazily**, inside the local branch, on purpose: on the Worker
 * they must never be loaded at all, because merely importing them pulls react-pdf (and its WASM) into
 * the bundle. This file is the only place that knows that.
 *
 * Callers never change: `renderPdf('invoice', input)` returns the same bytes `renderInvoicePdf(input)`
 * used to, so the three PDF routes, report approval and the service-report issue path are untouched
 * beyond the function name.
 */

type Inputs = {
  invoice: InvoicePdfInput
  quote: QuotePdfInput
  'delivery-order': DeliveryOrderPdfInput
  report: ReportPdfInput
  'service-report': ServiceReportPdfInput
}

async function renderLocally<K extends DocumentKind>(kind: K, input: Inputs[K]): Promise<Buffer> {
  // Each branch imports one module; the bundler still sees them, so the Worker build must not reach
  // this function — `env().DOCUMENT_SERVICE_URL` is required there, making this dead code.
  switch (kind) {
    case 'invoice': {
      const { renderInvoicePdf } = await import('@/server/documents/invoice')
      return renderInvoicePdf(input as InvoicePdfInput)
    }
    case 'quote': {
      const { renderQuotePdf } = await import('@/server/documents/quote')
      return renderQuotePdf(input as QuotePdfInput)
    }
    case 'delivery-order': {
      const { renderDeliveryOrderPdf } = await import('@/server/documents/delivery-order')
      return renderDeliveryOrderPdf(input as DeliveryOrderPdfInput)
    }
    case 'report': {
      const { renderReportPdf } = await import('@/server/documents/render')
      return renderReportPdf(input as ReportPdfInput)
    }
    case 'service-report': {
      const { renderServiceReportPdf } = await import('@/server/documents/service-report')
      return renderServiceReportPdf(input as ServiceReportPdfInput)
    }
  }
}

export async function renderPdf<K extends DocumentKind>(
  kind: K,
  input: Inputs[K],
): Promise<Buffer> {
  const base = env().DOCUMENT_SERVICE_URL
  if (!base) return renderLocally(kind, input)

  const response = await fetch(`${base.replace(/\/$/, '')}/render/${kind}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Shared secret: the service is an internal endpoint, but it is still reachable over the
      // network, and an open PDF renderer is a free CPU bill.
      authorization: `Bearer ${env().DOCUMENT_SERVICE_SECRET ?? ''}`,
    },
    body: JSON.stringify(encodeForWire(input)),
  })

  if (!response.ok) {
    throw new Error(
      `Document service failed to render ${kind}: ${response.status} ${await response.text()}`,
    )
  }
  return Buffer.from(await response.arrayBuffer())
}

export { decodeFromWire }
