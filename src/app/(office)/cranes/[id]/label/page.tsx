import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { env } from '@/lib/env'
import { requireAuth } from '@/server/auth/context'
import { NotFoundError } from '@/server/auth/errors'
import { getCrane } from '@/server/cranes/cranes'
import { CRANE_TYPE_LABELS } from '@/lib/cranes/labels'
import { qrSvg } from '@/server/cranes/qr-image'
import { craneQrPayload } from '@/server/cranes/qr'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  try {
    const crane = await getCrane(await requireAuth(), id)
    return { title: `Label — ${crane.assetTag}` }
  } catch (error) {
    if (error instanceof NotFoundError) return { title: 'Label — Cimmerian Crane Services' }
    throw error
  }
}

/**
 * The printable sticker.
 *
 * Print styles are inline rather than Tailwind utilities because this page exists to be printed: the
 * page chrome disappears, the label stays, and the size is a real physical one — roughly 70 × 45 mm,
 * which fits the common label sheets the office already uses.
 *
 * The QR code is rendered as inline SVG on the server, so printing does not depend on JavaScript,
 * a network round-trip to an image service, or a font that happens to be installed.
 */
export default async function CraneLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await requireAuth()

  let crane
  try {
    crane = await getCrane(context, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    throw error
  }

  const payload = craneQrPayload(crane.qrValue, env().APP_BASE_URL)
  const svg = await qrSvg(payload, 180)

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          @page { margin: 12mm; }
        }
        .crane-label { width: 70mm; height: 45mm; }
      `}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/cranes/${crane.id}`} className="text-sm text-slate-600 underline hover:text-slate-900">
            ← {crane.assetTag}
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Label for {crane.assetTag}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Print at 100% — do not use “fit to page”, which changes the size and can blur the code.
          </p>
        </div>
        <p className="text-xs break-all text-slate-500">{payload}</p>
      </div>

      <div className="crane-label flex border border-slate-900 bg-white">
        <div className="flex w-[30mm] items-center justify-center p-1">
          {/* Server-rendered SVG markup, not user content: the payload is a generated token. */}
          <div dangerouslySetInnerHTML={{ __html: svg }} className="h-full w-full [&>svg]:h-full [&>svg]:w-full" />
        </div>
        <div className="flex flex-1 flex-col justify-between border-l border-slate-300 p-2">
          <div>
            <p className="text-[11pt] leading-tight font-bold text-black">{crane.assetTag}</p>
            <p className="text-[7pt] leading-tight text-black">{CRANE_TYPE_LABELS[crane.type]}</p>
            <p className="text-[7pt] leading-tight text-black">
              SWL {crane.swlKg.toLocaleString()} kg
            </p>
          </div>
          <div>
            <p className="text-[6.5pt] leading-tight text-black">{crane.site.customerName}</p>
            <p className="text-[6.5pt] leading-tight text-black">{crane.site.name}</p>
            <p className="text-[6pt] leading-tight text-black">Cimmerian Crane Services</p>
          </div>
        </div>
      </div>
    </div>
  )
}
