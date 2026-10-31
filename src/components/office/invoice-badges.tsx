import { INVOICE_STATUS_LABELS, type InvoiceStatusName } from '@/lib/validation/invoices'

/** The same status chip on the list, the detail page and the job page's section. */
const STYLES: Record<InvoiceStatusName, string> = {
  DRAFT: 'border-line bg-sheet text-ink',
  ISSUED: 'border-info/40 bg-info/10 text-info',
  PART_PAID: 'border-warn/40 bg-warn/10 text-warn',
  PAID: 'border-pos/40 bg-pos/10 text-pos',
  VOID: 'border-faint bg-raised text-muted line-through',
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatusName }) {
  return (
    <span className={`rounded border px-2 py-0.5 text-xs ${STYLES[status]}`}>
      {INVOICE_STATUS_LABELS[status]}
    </span>
  )
}

/** Past its due date and still owing — the one thing finance scans the list for. */
export function OverdueBadge() {
  return (
    <span className="rounded border border-neg/40 bg-neg/10 px-2 py-0.5 text-xs text-neg">
      Overdue
    </span>
  )
}
