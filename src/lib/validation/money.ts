/**
 * Money arithmetic for a priced document — a quote or an invoice (slices 19 and 20).
 *
 * Kept in one place because the rule is the same for both and the two must not drift: a customer
 * comparing a quote with the invoice that followed it is reading the same arithmetic twice.
 */

export interface DocumentTotals {
  /** Per line, in cents, in the same order as the input. */
  lineTotalsCents: number[]
  subtotalCents: number
  gstCents: number
  totalCents: number
}

/**
 * Line totals, subtotal, GST and total, all in integer cents.
 *
 * Each line is rounded before it is summed — the total a customer can add up by hand — and GST is
 * charged on the rounded subtotal. Doing it in cents keeps a half-cent from appearing in a document.
 */
export function documentTotals(
  lines: readonly { quantity: number; unitPrice: number }[],
  gstRate: number,
): DocumentTotals {
  const lineTotalsCents = lines.map((line) => Math.round(line.quantity * line.unitPrice * 100))
  const subtotalCents = lineTotalsCents.reduce((sum, value) => sum + value, 0)
  const gstCents = Math.round(subtotalCents * gstRate)
  return { lineTotalsCents, subtotalCents, gstCents, totalCents: subtotalCents + gstCents }
}

/** Cents to the decimal string Prisma stores, so no float ever reaches a `Decimal(12,2)` column. */
export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** The prices as the columns store them: money to cents, quantity to its three decimals. */
export function pricedLines(
  lines: readonly { description: string; quantity: number; unitPrice: number }[],
) {
  return lines.map((line) => ({
    description: line.description,
    quantity: Math.round(line.quantity * 1000) / 1000,
    // Round to cents first: a third decimal on a price would make the stored price and the stored
    // line total disagree by a fraction of a cent on the customer's copy.
    unitPrice: Math.round(line.unitPrice * 100) / 100,
  }))
}
