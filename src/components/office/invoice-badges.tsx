import { INVOICE_STATUS_LABELS, type InvoiceStatusName } from '@/lib/validation/invoices'

/** The same status chip on the list, the detail page and the job page's section. */
const STYLES: Record<InvoiceStatusName, string> = {
  DRAFT: 'border-slate-300 bg-slate-50 text-slate-700',
  ISSUED: 'border-sky-300 bg-sky-50 text-sky-900',
  PART_PAID: 'border-amber-300 bg-amber-50 text-amber-900',
  PAID: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  VOID: 'border-slate-400 bg-slate-100 text-slate-500 line-through',
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
    <span className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-800">
      Overdue
    </span>
  )
}
