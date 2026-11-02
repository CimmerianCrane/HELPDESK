import { QUOTE_STATUS_LABELS, type QuoteStatusName } from '@/lib/validation/quotes'

/** The same status chip on the list, the detail page and the job page's section. */
const STYLES: Record<QuoteStatusName, string> = {
  DRAFT: 'border-line bg-sheet text-ink',
  SENT: 'border-info/40 bg-info/10 text-info',
  ACCEPTED: 'border-pos/40 bg-pos/10 text-pos',
  DECLINED: 'border-neg/40 bg-neg/10 text-neg',
  EXPIRED: 'border-warn/40 bg-warn/10 text-warn',
}

export function QuoteStatusBadge({ status }: { status: QuoteStatusName }) {
  return (
    <span className={`rounded border px-2 py-0.5 text-xs ${STYLES[status]}`}>
      {QUOTE_STATUS_LABELS[status]}
    </span>
  )
}
