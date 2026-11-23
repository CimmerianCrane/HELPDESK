import { createServer } from 'node:http'
import { renderInvoicePdf, type InvoicePdfInput } from '../src/server/documents/invoice'
import { renderQuotePdf, type QuotePdfInput } from '../src/server/documents/quote'
import {
  renderDeliveryOrderPdf,
  type DeliveryOrderPdfInput,
} from '../src/server/documents/delivery-order'
import { renderReportPdf, type ReportPdfInput } from '../src/server/documents/render'
import {
  renderServiceReportPdf,
  type ServiceReportPdfInput,
} from '../src/server/documents/service-report'
import { decodeFromWire, type DocumentKind } from '../src/lib/document-wire'

/**
 * The document service: the only process that runs `@react-pdf/renderer`.
 *
 * The app itself runs on Cloudflare Workers, which cannot compile the WASM that react-pdf's layout
 * engine (`yoga-layout`) needs at runtime. So the renderers stay exactly as they were and this small
 * Node server exposes them over HTTP: one endpoint per document kind, one shared secret, no database,
 * no state.
 *
 * It is deliberately not a second application. Every route is a one-line call to a renderer that
 * already had unit tests — the service adds transport, nothing else, which is what keeps "the same
 * input produces the same bytes" true across the split.
 *
 * Build: `npm run documents:build` bundles this file as ESM with node_modules kept external. That is
 * not cosmetic: react-pdf is ESM-only and loads a subpath (`@react-pdf/hyphenate/en-us`) that a CJS
 * build cannot resolve, so the service must run as ESM with packages resolved by Node itself.
 *
 * Run:   npm run documents
 */

const PORT = Number(process.env.PORT ?? 8788)
const SECRET = process.env.DOCUMENT_SERVICE_SECRET ?? ''

type Renderers = {
  invoice: (input: InvoicePdfInput) => Promise<Buffer>
  quote: (input: QuotePdfInput) => Promise<Buffer>
  'delivery-order': (input: DeliveryOrderPdfInput) => Promise<Buffer>
  report: (input: ReportPdfInput) => Promise<Buffer>
  'service-report': (input: ServiceReportPdfInput) => Promise<Buffer>
}

const renderers: Renderers = {
  invoice: renderInvoicePdf,
  quote: renderQuotePdf,
  'delivery-order': renderDeliveryOrderPdf,
  report: renderReportPdf,
  'service-report': renderServiceReportPdf,
}

function authorised(headers: Record<string, string | string[] | undefined>): boolean {
  // An unset secret is a refusal, not an open door: this endpoint spends CPU on whatever it is given.
  if (!SECRET) return false
  return headers.authorization === `Bearer ${SECRET}`
}

function log(message: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'documents', message, ...detail }))
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`)

  if (url.pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ status: 'ok' }))
    return
  }

  if (!authorised(request.headers)) {
    response.writeHead(401)
    response.end('Unauthorized')
    return
  }

  const match = /^\/render\/([a-z-]+)$/.exec(url.pathname)
  const kind = match?.[1] as DocumentKind | undefined
  const render = kind ? renderers[kind] : undefined
  if (!render) {
    response.writeHead(404)
    response.end('Not found')
    return
  }

  const startedAt = Date.now()
  try {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const input = decodeFromWire(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    // The wire type is `unknown`; the endpoint name selects the input shape, and the client
    // (`render-pdf.ts`) is typed to send the matching one.
    const pdf = await (render as (input: unknown) => Promise<Buffer>)(input)
    log('rendered', { kind, bytes: pdf.byteLength, ms: Date.now() - startedAt })
    response.writeHead(200, { 'Content-Type': 'application/pdf' })
    response.end(pdf)
  } catch (error) {
    // Never return the renderer's message: it can quote customer data from the input.
    log('render-failed', { kind, ms: Date.now() - startedAt, error: (error as Error).message })
    response.writeHead(500)
    response.end('Render failed')
  }
})

server.listen(PORT, () => log('listening', { port: PORT }))
