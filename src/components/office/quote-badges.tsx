import { QUOTE_STATUS_LABELS, type QuoteStatusName } from '@/lib/validation/quotes'

/** The same status chip on the list, the detail page and the job page's section. */
const STYLES: Record<QuoteStatusName, string> = {
  DRAFT: 'border-slate-300 bg-slate-50 text-slate-700',
  SENT: 'border-sky-300 bg-sky-50 text-sky-900',
  ACCEPTED: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  DECLINED: 'border-red-300 bg-red-50 text-red-800',
  EXPIRED: 'border-amber-300 bg-amber-50 text-amber-900',
}

export function QuoteStatusBadge({ status }: { status: QuoteStatusName }) {
  return (
    <span className={`rounded border px-2 py-0.5 text-xs ${STYLES[status]}`}>
      {QUOTE_STATUS_LABELS[status]}
    </span>
  )
}
